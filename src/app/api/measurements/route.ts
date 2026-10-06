// ==============================================================================
// Revenue Lift — Measurement & Outcome Reconciliation API Route
// ==============================================================================
// POST /api/measurements
// Reconciles predicted Expected Net Value against actual merchant outcomes.
// Enforces: Action MUST be successfully executed before measurement is unlocked.
// ==============================================================================

import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../lib/db';
import { calculateMeasurementMetrics } from '../../../core/measurement';
import { logAuditEvent } from '../../../core/auditLogger';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body || !body.actionId || typeof body.actionId !== 'string') {
      return NextResponse.json(
        { error: 'Bad Request', message: 'A valid actionId is required.' },
        { status: 400 }
      );
    }

    const { actionId, syntheticActualRevenue, syntheticActualNetValue, syntheticConversions } = body;

    // 1. Fetch action with linked opportunity, goal, and executions
    const action = await prisma.campaignAction.findUnique({
      where: { id: actionId },
      include: {
        opportunity: {
          include: { goal: true },
        },
        executions: {
          orderBy: { executedAt: 'desc' },
        },
        measurement: true,
      },
    });

    if (!action) {
      return NextResponse.json(
        { error: 'Not Found', message: `CampaignAction '${actionId}' does not exist.` },
        { status: 404 }
      );
    }

    // 2. CRITICAL GOVERNANCE CHECK: Action MUST be COMPLETED
    if (action.status !== 'COMPLETED') {
      return NextResponse.json(
        {
          error: 'Measurement Unavailable',
          message: `Measurement cannot be recorded because action is in '${action.status}' status. Action must be successfully executed first.`,
        },
        { status: 403 }
      );
    }

    // 3. Verify a successful execution exists
    const successfulExecution = action.executions.find((e) => e.status === 'SUCCESS');
    if (!successfulExecution) {
      return NextResponse.json(
        {
          error: 'Execution Incomplete',
          message: 'Measurement unavailable: No successful Razorpay test execution found for this action.',
        },
        { status: 403 }
      );
    }

    // 4. Idempotency Check: Return existing measurement if already recorded
    if (action.measurement) {
      const existing = action.measurement;
      const metrics = calculateMeasurementMetrics({
        predictedRevenue: existing.predictedRevenue,
        actualRevenue: existing.actualRevenue,
        predictedNetValue: existing.predictedNetValue,
        actualNetValue: existing.actualNetValue,
        targetRevenue: action.opportunity.goal.targetRevenue,
        conversionsCount: existing.conversionsCount,
      });

      return NextResponse.json({
        success: true,
        isIdempotent: true,
        measurementId: existing.id,
        actionId: action.id,
        metrics,
        environment: 'SYNTHETIC DEMO MEASUREMENT',
        message: 'Returned existing outcome measurement.',
      });
    }

    // 5. Determine Actuals (Deterministic synthetic demo outcome)
    const opp = action.opportunity;
    const predictedRevenue = opp.incrementalRevenuePerCustomer * opp.eligibleCustomers * opp.acceptanceProbability;
    const predictedNetValue = opp.expectedNetValue;

    // Standard demo measurement outcome (Close to prediction: ~95.7% accuracy, goal achieved: 115%)
    // Actual Incremental Revenue: ₹57,500 | Actual Net Value: ₹51,900 | Delta: -₹2,308
    const actualRevenue = syntheticActualRevenue ?? 57500;
    const actualNetValue = syntheticActualNetValue ?? 51900;
    const conversionsCount = syntheticConversions ?? Math.round(opp.eligibleCustomers * opp.acceptanceProbability * 0.98);

    // 6. Calculate deterministic metrics using integer paise engine
    const metrics = calculateMeasurementMetrics({
      predictedRevenue,
      actualRevenue,
      predictedNetValue,
      actualNetValue,
      targetRevenue: opp.goal.targetRevenue,
      conversionsCount,
    });

    // 7. Persist measurement to database
    const savedMeasurement = await prisma.measurement.create({
      data: {
        actionId: action.id,
        predictedRevenue: metrics.predictedRevenue,
        actualRevenue: metrics.actualRevenue,
        predictedNetValue: metrics.predictedNetValue,
        actualNetValue: metrics.actualNetValue,
        conversionsCount: metrics.conversionsCount,
        goalAttainmentRate: metrics.goalProgressPct,
      },
    });

    // 8. Update Goal progress in database
    await prisma.goal.update({
      where: { id: opp.goal.id },
      data: {
        achievedRevenue: metrics.actualRevenue,
        status: metrics.isGoalAchieved ? 'ACHIEVED' : 'ACTIVE',
      },
    });

    // 9. Log MEASUREMENT_RECORDED audit event
    await logAuditEvent({
      merchantId: opp.goal.merchantId,
      actor: 'SYSTEM',
      eventType: 'MEASUREMENT_RECORDED',
      entityType: 'Measurement',
      entityId: savedMeasurement.id,
      summary: `Measurement recorded for '${opp.title}': Predicted ₹${metrics.predictedNetValue.toLocaleString(
        'en-IN'
      )} vs Actual ₹${metrics.actualNetValue.toLocaleString('en-IN')} (${metrics.predictionAccuracyPct}% accuracy). Goal Progress: ${metrics.goalProgressPct}%.`,
      metadata: {
        predictedNetValue: metrics.predictedNetValue,
        actualNetValue: metrics.actualNetValue,
        netValueDelta: metrics.netValueDelta,
        accuracyPct: metrics.predictionAccuracyPct,
        goalProgressPct: metrics.goalProgressPct,
        isGoalAchieved: metrics.isGoalAchieved,
      },
    });

    return NextResponse.json({
      success: true,
      measurementId: savedMeasurement.id,
      actionId: action.id,
      metrics,
      environment: 'SYNTHETIC DEMO MEASUREMENT',
      message: `Outcome reconciled successfully! Goal is ${metrics.goalProgressPct}% achieved.`,
    });
  } catch (error: any) {
    console.error('Measurement API error:', error);
    return NextResponse.json(
      {
        error: 'Measurement Error',
        message: error?.message || 'Failed to record outcome measurement.',
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const actionId = searchParams.get('actionId');

    if (!actionId) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'actionId parameter is required' },
        { status: 400 }
      );
    }

    const measurement = await prisma.measurement.findUnique({
      where: { actionId },
      include: {
        action: {
          include: { opportunity: { include: { goal: true } } },
        },
      },
    });

    if (!measurement) {
      return NextResponse.json(
        { error: 'Not Found', message: 'No measurement recorded for this action.' },
        { status: 404 }
      );
    }

    const metrics = calculateMeasurementMetrics({
      predictedRevenue: measurement.predictedRevenue,
      actualRevenue: measurement.actualRevenue,
      predictedNetValue: measurement.predictedNetValue,
      actualNetValue: measurement.actualNetValue,
      targetRevenue: measurement.action.opportunity.goal.targetRevenue,
      conversionsCount: measurement.conversionsCount,
    });

    return NextResponse.json({
      measurementId: measurement.id,
      actionId: measurement.actionId,
      metrics,
      measuredAt: measurement.measuredAt,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Internal Error', message: error?.message },
      { status: 500 }
    );
  }
}
