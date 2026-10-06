// ==============================================================================
// Revenue Lift — Razorpay Test Mode Execution API Route
// ==============================================================================
// POST /api/actions/execute
// Executes an approved action via Razorpay test mode infrastructure.
// Strictly checks that the action is APPROVED before triggering the gateway.
// ==============================================================================

import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../lib/db';
import { executeRazorpayCampaignAction } from '../../../../lib/razorpay';
import { validateStateTransition } from '../../../../core/stateMachine';
import { logAuditEvent } from '../../../../core/auditLogger';
import { IllegalStateTransitionError } from '../../../../core/errors';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body || !body.actionId || typeof body.actionId !== 'string') {
      return NextResponse.json(
        { error: 'Bad Request', message: 'A valid actionId is required.' },
        { status: 400 }
      );
    }

    const { actionId, forceFailure } = body;

    // 1. Fetch action with opportunity and past executions
    const action = await prisma.campaignAction.findUnique({
      where: { id: actionId },
      include: {
        opportunity: {
          include: { goal: true },
        },
        executions: {
          orderBy: { executedAt: 'desc' },
        },
      },
    });

    if (!action) {
      return NextResponse.json(
        { error: 'Not Found', message: `CampaignAction '${actionId}' does not exist.` },
        { status: 404 }
      );
    }

    const merchantId = action.opportunity.goal.merchantId;

    // 2. Idempotency Check: Has execution already succeeded or been initiated?
    const existingExecution = action.executions.find((e) =>
      e.status === 'SUCCESS' || e.status === 'INITIATED'
    );
    if (existingExecution) {
      const mode = existingExecution.isSimulated
        ? 'DEMO'
        : (process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test_') ? 'TEST' : 'LIVE');
      return NextResponse.json({
        success: true,
        isIdempotent: true,
        actionId: action.id,
        executionId: existingExecution.id,
        status: existingExecution.status === 'SUCCESS' ? 'COMPLETED' : 'INITIATED',
        mode,
        simulated: existingExecution.isSimulated,
        providerReferenceId: existingExecution.providerReferenceId ?? existingExecution.batchId,
        provider: existingExecution.provider ?? existingExecution.gateway,
        linksCreated: existingExecution.linksCreated,
        message: 'Returned existing execution record. Action already successfully executed.',
      });
    }

    // 3. CRITICAL GOVERNANCE CHECK: Is merchant approval present?
    // Consequential execution strictly requires merchant approval.
    // An action in FAILED status can be safely retried as long as it was previously approved.
    if ((action.status !== 'APPROVED' && action.status !== 'FAILED') || !action.approvedAt) {
      // Log blocked attempt to audit trail
      await logAuditEvent({
        merchantId,
        actor: 'SYSTEM',
        eventType: 'EXECUTION_FAILED',
        entityType: 'CampaignAction',
        entityId: action.id,
        previousState: action.status,
        newState: action.status,
        summary: `Execution BLOCKED: Attempted to execute action '${action.opportunity.title}' without explicit merchant approval.`,
        metadata: {
          currentStatus: action.status,
          approvedAt: action.approvedAt,
          reason: 'Consequential Razorpay actions strictly require prior merchant approval',
        },
      });

      return NextResponse.json(
        {
          error: 'Execution Blocked',
          message: `Action '${actionId}' cannot be executed because it has not been approved by the merchant (current status: '${action.status}').`,
        },
        { status: 403 }
      );
    }

    // 4. Validate State Transition to INITIATED
    const fromState = action.status === 'FAILED' ? 'ACTION_FAILED' : 'ACTION_APPROVED';
    validateStateTransition({
      entityId: action.id,
      fromState,
      toState: 'ACTION_INITIATED',
      actor: 'SYSTEM',
    });

    // Mark action as INITIATED in DB
    await prisma.campaignAction.update({
      where: { id: action.id },
      data: { status: 'INITIATED' },
    });

    await logAuditEvent({
      merchantId,
      actor: 'SYSTEM',
      eventType: 'EXECUTION_INITIATED',
      entityType: 'CampaignAction',
      entityId: action.id,
      previousState: action.status,
      newState: 'INITIATED',
      summary: action.status === 'FAILED'
        ? `Retrying Razorpay test-mode execution for previously failed action '${action.opportunity.title}'...`
        : `Initiating Razorpay test-mode execution for action '${action.opportunity.title}'...`,
    });

    // 5. Call Razorpay Execution Service
    const executionResult = await executeRazorpayCampaignAction({
      actionId: action.id,
      opportunityId: action.opportunity.id,
      opportunityType: action.opportunity.type,
      title: action.opportunity.title,
      targetSegment: action.opportunity.targetSegment,
      eligibleCustomers: action.opportunity.eligibleCustomers,
      incrementalRevenuePerCustomer: action.opportunity.incrementalRevenuePerCustomer,
      incentiveCostPerCustomer: action.opportunity.incentiveCostPerCustomer,
      forceFailure,
    });

    // 6. Persist execution record in database
    const savedExecution = await prisma.execution.create({
      data: {
        actionId: action.id,
        gateway: executionResult.provider,
        provider: executionResult.provider,
        batchId: executionResult.providerReferenceId,
        providerReferenceId: executionResult.providerReferenceId,
        status: executionResult.status,
        linksCreated: executionResult.paymentLinksCreated,
        payloadSent: executionResult.payloadSent ? JSON.stringify(executionResult.payloadSent) : null,
        responseReceived: executionResult.responseReceived
          ? JSON.stringify(executionResult.responseReceived)
          : null,
        errorMessage: executionResult.errorMessage || null,
        errorCode: executionResult.errorCode || null,
        isSimulated: executionResult.isSimulated,
        executedAt: executionResult.createdAt,
      },
    });

    // 7. Update CampaignAction state and record audit log based on execution outcome

      // Determine new status for CampaignAction based on execution result
      let actionNewStatus: string;
      if (executionResult.success) {
        // Successful execution: DEMO mode completes, real mode stays initiated until webhook confirms payment
        actionNewStatus = executionResult.isSimulated ? 'COMPLETED' : 'INITIATED';
      } else {
        // Failure simulation or real failure should mark the action as FAILED
        actionNewStatus = 'FAILED';
      }
      await prisma.campaignAction.update({
        where: { id: action.id },
        data: { status: actionNewStatus },
      });
      const newStatus = actionNewStatus;

      // Audit the execution outcome
      await logAuditEvent({
        merchantId,
        actor: 'SYSTEM',
        eventType: executionResult.success ? 'EXECUTION_SUCCESS' : 'EXECUTION_FAILED',
        entityType: 'Execution',
        entityId: savedExecution.id,
        previousState: 'INITIATED',
        newState: newStatus,
        summary: executionResult.success
          ? `Razorpay ${executionResult.isSimulated ? 'simulated' : 'live'} execution successful for '${action.opportunity.title}'.`
          : `Razorpay ${executionResult.isSimulated ? 'simulated' : 'live'} execution FAILED: ${executionResult.errorMessage}`,
      });

      // Determine response mode string
      const mode = executionResult.isSimulated
        ? 'DEMO'
        : (process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test_') ? 'TEST' : 'LIVE');

      const responseBody = {
        success: executionResult.success,
        actionId: action.id,
        executionId: savedExecution.id,
        status: newStatus,
        mode,
        simulated: executionResult.isSimulated,
        providerReferenceId: executionResult.providerReferenceId,
        provider: executionResult.provider,
        linksCreated: executionResult.paymentLinksCreated,
        errorCode: executionResult.errorCode,
        message: executionResult.success
          ? 'Success'
          : (executionResult.errorMessage?.includes('Execution failed. No customer was notified or charged.')
              ? 'Execution failed. No customer was notified or charged.'
              : (executionResult.errorMessage || 'Execution failed.')),
      };
      const statusCode = executionResult.success ? 200 : 502;
      return NextResponse.json(responseBody, { status: statusCode });





  } catch (error: any) {
    console.error('Execution API error:', error);
    return NextResponse.json(
      {
        error: 'Execution Error',
        message: error?.message || 'Unexpected error during action execution.',
      },
      { status: 500 }
    );
  }
}
