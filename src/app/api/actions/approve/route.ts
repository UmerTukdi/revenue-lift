// ==============================================================================
// Revenue Lift — Merchant Approval API Route
// ==============================================================================
// POST /api/actions/approve
// Explicitly authorizes a consequential growth action.
// Enforces human-in-the-loop governance: Never allows autonomous execution.
// ==============================================================================

import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../lib/db';
import { validateStateTransition } from '../../../../core/stateMachine';
import { logAuditEvent } from '../../../../core/auditLogger';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body || !body.actionId || typeof body.actionId !== 'string') {
      return NextResponse.json(
        { error: 'Bad Request', message: 'A valid actionId is required.' },
        { status: 400 }
      );
    }

    const { actionId } = body;

    // 1. Fetch action with linked opportunity
    const action = await prisma.campaignAction.findUnique({
      where: { id: actionId },
      include: {
        opportunity: {
          include: { goal: true },
        },
      },
    });

    if (!action) {
      return NextResponse.json(
        { error: 'Not Found', message: `CampaignAction with ID '${actionId}' does not exist.` },
        { status: 404 }
      );
    }

    // 2. Validate current state: Must be in PENDING_APPROVAL
    if (action.status !== 'PENDING_APPROVAL') {
      return NextResponse.json(
        {
          error: 'Conflict',
          message: `Action '${actionId}' cannot be approved because it is in '${action.status}' status (must be PENDING_APPROVAL).`,
        },
        { status: 409 }
      );
    }

    // 3. Enforce State Machine Transition Gate
    validateStateTransition({
      entityId: action.id,
      fromState: 'DECISION_AWAITING_APPROVAL',
      toState: 'ACTION_APPROVED',
      isMerchantApproved: true,
      actor: 'MERCHANT',
      rationale: body.approvalNote || 'Merchant explicitly clicked Authorize in UI',
    });

    const approvedAt = new Date();

    // 4. Update action state in database
    const updatedAction = await prisma.campaignAction.update({
      where: { id: action.id },
      data: {
        status: 'APPROVED',
        approvedAt,
        approvedBy: 'merchant_admin',
      },
    });

    // 5. Create immutable audit event
    await logAuditEvent({
      merchantId: action.opportunity.goal.merchantId,
      actor: 'MERCHANT',
      eventType: 'MERCHANT_APPROVED',
      entityType: 'CampaignAction',
      entityId: action.id,
      previousState: 'PENDING_APPROVAL',
      newState: 'APPROVED',
      summary: `Merchant explicitly approved action '${action.opportunity.title}' (Expected Net Value: ₹${action.opportunity.expectedNetValue.toLocaleString(
        'en-IN'
      )}) for Razorpay test execution.`,
      metadata: {
        actionId: action.id,
        opportunityId: action.opportunity.id,
        expectedNetValue: action.opportunity.expectedNetValue,
        approvedBy: 'merchant_admin',
      },
    });

    return NextResponse.json({
      success: true,
      actionId: updatedAction.id,
      opportunityId: action.opportunity.id,
      status: updatedAction.status,
      approvedAt: updatedAction.approvedAt,
      approvedBy: updatedAction.approvedBy,
      message: `Action '${action.opportunity.title}' successfully approved. Ready for execution.`,
    });
  } catch (error: any) {
    console.error('Action approval error:', error);
    return NextResponse.json(
      {
        error: 'Approval Failed',
        message: error?.message || 'Failed to approve consequential action.',
      },
      { status: error?.statusCode || 500 }
    );
  }
}
