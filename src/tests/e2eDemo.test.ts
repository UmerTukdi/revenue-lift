// ==============================================================================
// Revenue Lift — End-to-End QA & Demo Verification Test Suite (Step 6)
// ==============================================================================
// Validates:
// 1. Complete Happy Path (Goal -> Constraints -> Scoring -> Winner -> Approve -> Execute -> Measure)
// 2. Failure Path (Simulated gateway timeout -> FAILED -> Measurement locked -> Safe retry)
// 3. No Eligible Opportunity Path (Extreme constraints -> All rejected -> No winner/approval)
// 4. Approval Bypass Security (POST /api/actions/execute rejected with 403 without approval)
// 5. Duplicate Execution Idempotency
// 6. Duplicate Measurement Idempotency
// 7. AI Fallback in DEMO_MODE
// 8. Metric Consistency Audit (Actual Incremental Revenue vs Actual Net Value)
// 9. State Machine Integrity & Anti-Spoofing
// ==============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import prisma from '../lib/db';
import { POST as approveActionRoute } from '../app/api/actions/approve/route';
import { POST as executeActionRoute } from '../app/api/actions/execute/route';
import { POST as measurementRoute } from '../app/api/measurements/route';
import { DEMO_OPPORTUNITY_CANDIDATES } from '../opportunities/demoCandidates';
import { evaluateOpportunities } from '../core/evaluator';
import { calculateMeasurementMetrics } from '../core/measurement';
import { validateStateTransition } from '../core/stateMachine';
import { IllegalStateTransitionError } from '../core/errors';
import { MockAIProvider } from '../agent/provider';

describe('Step 6 Final QA: End-to-End Demo & Governance Verification', () => {
  let merchantId: string;
  let happyGoalId: string;
  let happyOppId: string;
  let happyActionId: string;

  beforeAll(async () => {
    // Setup isolated test merchant tenant
    const merchant = await prisma.merchant.create({
      data: {
        name: 'Step 6 QA Test Merchant [SYNTHETIC DEMO]',
        email: 'qa-demo@revenue-lift.test',
        currency: 'INR',
        baseMarginPct: 35.0,
        isSynthetic: true,
      },
    });
    merchantId = merchant.id;

    // Create Goal with standard constraints: ₹50,000 target, margin >= 25%, discount <= 10%
    const goal = await prisma.goal.create({
      data: {
        merchantId,
        targetRevenue: 50000,
        timeframeDays: 30,
        status: 'ACTIVE',
      },
    });
    happyGoalId = goal.id;
  });

  afterAll(async () => {
    // Clean up test records scoped to this test merchant
    await prisma.auditEvent.deleteMany({ where: { merchantId } });
    await prisma.measurement.deleteMany({
      where: { action: { opportunity: { goal: { merchantId } } } },
    });
    await prisma.execution.deleteMany({
      where: { action: { opportunity: { goal: { merchantId } } } },
    });
    await prisma.campaignAction.deleteMany({
      where: { opportunity: { goal: { merchantId } } },
    });
    await prisma.opportunity.deleteMany({
      where: { goal: { merchantId } },
    });
    await prisma.goal.deleteMany({ where: { merchantId } });
    await prisma.merchant.deleteMany({ where: { id: merchantId } });
  });

  // ----------------------------------------------------------------------------
  // 1. Complete Happy Path Demo Flow
  // ----------------------------------------------------------------------------
  it('1. Complete Happy Path: Goal -> Constraints -> Ranking -> Approve -> Execute -> Measure', async () => {
    // Step A: Evaluate opportunities with standard constraints
    const constraints = [
      { type: 'MARGIN_FLOOR' as const, operator: 'GTE' as const, thresholdValue: 25.0, unit: 'PERCENT' as const, isHard: true },
      { type: 'DISCOUNT_CAP' as const, operator: 'LTE' as const, thresholdValue: 10.0, unit: 'PERCENT' as const, isHard: true },
      { type: 'INVENTORY_MIN' as const, operator: 'GTE' as const, thresholdValue: 15.0, unit: 'UNITS' as const, isHard: true },
      { type: 'DUPLICATE_WINDOW_DAYS' as const, operator: 'GTE' as const, thresholdValue: 14.0, unit: 'DAYS' as const, isHard: true },
    ];

    const report = evaluateOpportunities(DEMO_OPPORTUNITY_CANDIDATES, constraints, happyGoalId);

    // Verify Disqualification of Nominal Leader (Aggressive 15% Clearance)
    const clearanceOpp = report.allOpportunities.find((o) => o.id === 'opp_demo_case_a_rejected');
    expect(clearanceOpp).toBeDefined();
    expect(clearanceOpp?.status).toBe('REJECTED');
    expect(clearanceOpp?.isWinner).toBe(false);

    // Verify High-LTV Dormant Win-Back is the recommended winner
    const winner = report.winner;
    expect(winner).toBeDefined();
    expect(winner?.id).toBe('opp_demo_case_b_winner');
    expect(winner?.scoring.expectedNetValue).toBe(54208);

    // Persist winner opportunity and action in DB
    const dbOpp = await prisma.opportunity.create({
      data: {
        id: `e2e-${winner!.id}-${Date.now()}`,
        goalId: happyGoalId,
        type: winner!.type,
        title: winner!.title,
        description: winner!.description,
        targetSegment: winner!.targetSegment,
        eligibleCustomers: winner!.scoring.eligibleCustomers,
        acceptanceProbability: winner!.scoring.acceptanceProbability,
        incrementalRevenuePerCustomer: winner!.scoring.incrementalRevenuePerCustomer,
        incentiveCostPerCustomer: winner!.scoring.incentiveCostPerCustomer,
        expectedNetValue: winner!.scoring.expectedNetValue,
        projectedMarginPct: winner!.projectedMarginPct,
        projectedDiscountPct: winner!.projectedDiscountPct,
        status: 'ELIGIBLE',
        isRecommended: true,
      },
    });
    happyOppId = dbOpp.id;

    const dbAction = await prisma.campaignAction.create({
      data: {
        opportunityId: dbOpp.id,
        status: 'PENDING_APPROVAL',
      },
    });
    happyActionId = dbAction.id;

    // Step B: Merchant Approves Action
    const approveReq = new NextRequest('http://localhost:3000/api/actions/approve', {
      method: 'POST',
      body: JSON.stringify({ actionId: happyActionId, approvalNote: 'Approved for Step 6 E2E Test' }),
    });
    const approveRes = await approveActionRoute(approveReq);
    expect(approveRes.status).toBe(200);

    const approvedData = await approveRes.json();
    expect(approvedData.status).toBe('APPROVED');
    expect(approvedData.approvedAt).toBeDefined();

    // Step C: Execute Action via Razorpay Test Mode
    const execReq = new NextRequest('http://localhost:3000/api/actions/execute', {
      method: 'POST',
      body: JSON.stringify({ actionId: happyActionId, forceFailure: false }),
    });
    const execRes = await executeActionRoute(execReq);
    expect(execRes.status).toBe(200);

    const execData = await execRes.json();
    expect(execData.success).toBe(true);
    expect(execData.status).toBe('COMPLETED');
    expect(execData.linksCreated).toBeGreaterThan(0);

    // Step D: Merchant Records Measurement
    const measReq = new NextRequest('http://localhost:3000/api/measurements', {
      method: 'POST',
      body: JSON.stringify({
        actionId: happyActionId,
        syntheticActualRevenue: 57500,
        syntheticActualNetValue: 51900,
      }),
    });
    const measRes = await measurementRoute(measReq);
    expect(measRes.status).toBe(200);

    const measData = await measRes.json();
    expect(measData.success).toBe(true);
    expect(measData.metrics.predictedNetValue).toBe(54208);
    expect(measData.metrics.actualNetValue).toBe(51900);
    expect(measData.metrics.actualRevenue).toBe(57500);
    expect(measData.metrics.netValueDelta).toBe(-2308);
    expect(measData.metrics.predictionAccuracyPct).toBe(95.7);
    expect(measData.metrics.goalProgressPct).toBe(115.0);
    expect(measData.environment).toBe('SYNTHETIC DEMO MEASUREMENT');
  });

  // ----------------------------------------------------------------------------
  // 2. Failure Demonstration Path & Safe Retry
  // ----------------------------------------------------------------------------
  it('2. Failure Simulation: Fails safely -> Blocks measurement -> Allows safe retry', async () => {
    // Create new action for failure test
    const failOpp = await prisma.opportunity.create({
      data: {
        goalId: happyGoalId,
        type: 'CART_RECOVERY',
        title: 'Failure Demo Test Opp',
        description: 'Test failure simulation handling',
        targetSegment: 'FAILED_CHECKOUT',
        eligibleCustomers: 20,
        acceptanceProbability: 0.25,
        incrementalRevenuePerCustomer: 1500,
        incentiveCostPerCustomer: 100,
        expectedNetValue: 7000,
        projectedMarginPct: 32.0,
        projectedDiscountPct: 6.0,
        status: 'ELIGIBLE',
      },
    });

    const failAction = await prisma.campaignAction.create({
      data: {
        opportunityId: failOpp.id,
        status: 'PENDING_APPROVAL',
      },
    });

    // Merchant Approves
    await approveActionRoute(
      new NextRequest('http://localhost:3000/api/actions/approve', {
        method: 'POST',
        body: JSON.stringify({ actionId: failAction.id }),
      })
    );

    // Trigger Failure Simulation
    const failExecReq = new NextRequest('http://localhost:3000/api/actions/execute', {
      method: 'POST',
      body: JSON.stringify({ actionId: failAction.id, forceFailure: true }),
    });
    const failExecRes = await executeActionRoute(failExecReq);
    expect(failExecRes.status).toBe(502);

    const failExecData = await failExecRes.json();
    expect(failExecData.success).toBe(false);
    expect(failExecData.status).toBe('FAILED');
    expect(failExecData.message).toBe('Execution failed. No customer was notified or charged.');

    // Verify Action in DB is FAILED
    const dbActionAfterFail = await prisma.campaignAction.findUnique({ where: { id: failAction.id } });
    expect(dbActionAfterFail?.status).toBe('FAILED');

    // Verify Measurement is Strictly Blocked
    const blockedMeasReq = new NextRequest('http://localhost:3000/api/measurements', {
      method: 'POST',
      body: JSON.stringify({ actionId: failAction.id }),
    });
    const blockedMeasRes = await measurementRoute(blockedMeasReq);
    expect(blockedMeasRes.status).toBe(403);

    // Safe Retry Execution
    const retryReq = new NextRequest('http://localhost:3000/api/actions/execute', {
      method: 'POST',
      body: JSON.stringify({ actionId: failAction.id, forceFailure: false }),
    });
    const retryRes = await executeActionRoute(retryReq);
    expect(retryRes.status).toBe(200);

    const retryData = await retryRes.json();
    expect(retryData.success).toBe(true);
    expect(retryData.status).toBe('COMPLETED');

    // Measurement is now unlocked
    const unlockMeasReq = new NextRequest('http://localhost:3000/api/measurements', {
      method: 'POST',
      body: JSON.stringify({ actionId: failAction.id, syntheticActualRevenue: 7500, syntheticActualNetValue: 6900 }),
    });
    const unlockMeasRes = await measurementRoute(unlockMeasReq);
    expect(unlockMeasRes.status).toBe(200);
  });

  // ----------------------------------------------------------------------------
  // 3. No-Eligible-Opportunity Scenario
  // ----------------------------------------------------------------------------
  it('3. No-Eligible-Opportunity: Strict guardrails reject all -> No winner, no approval', () => {
    // Unrealistic 60% Margin Floor and 2% Discount Cap
    const impossibleConstraints = [
      { type: 'MARGIN_FLOOR' as const, operator: 'GTE' as const, thresholdValue: 60.0, unit: 'PERCENT' as const, isHard: true },
      { type: 'DISCOUNT_CAP' as const, operator: 'LTE' as const, thresholdValue: 2.0, unit: 'PERCENT' as const, isHard: true },
    ];

    const report = evaluateOpportunities(DEMO_OPPORTUNITY_CANDIDATES, impossibleConstraints, happyGoalId);

    // Every single candidate must be rejected
    expect(report.eligibleCount).toBe(0);
    expect(report.rejectedCount).toBe(report.allOpportunities.length);
    expect(report.winner).toBeNull();

    for (const opp of report.allOpportunities) {
      expect(opp.status).toBe('REJECTED');
      expect(opp.isWinner).toBe(false);
      expect(opp.rejectionReasons.length).toBeGreaterThan(0);
    }
  });

  // ----------------------------------------------------------------------------
  // 4. Approval Bypass Test
  // ----------------------------------------------------------------------------
  it('4. Approval Bypass Security: Calling execute on unapproved action strictly returns 403', async () => {
    const unapprovedOpp = await prisma.opportunity.create({
      data: {
        goalId: happyGoalId,
        type: 'PRICE_DROP_CAMPAIGN',
        title: 'Unapproved Bypass Test',
        description: 'Verifies authorization gate',
        targetSegment: 'PRICE_SENSITIVE',
        eligibleCustomers: 10,
        acceptanceProbability: 0.1,
        incrementalRevenuePerCustomer: 500,
        incentiveCostPerCustomer: 50,
        expectedNetValue: 450,
        projectedMarginPct: 28.0,
        projectedDiscountPct: 7.0,
        status: 'ELIGIBLE',
      },
    });

    const unapprovedAction = await prisma.campaignAction.create({
      data: {
        opportunityId: unapprovedOpp.id,
        status: 'PENDING_APPROVAL',
        approvedAt: null,
      },
    });

    // Attempt to execute directly without approval
    const bypassReq = new NextRequest('http://localhost:3000/api/actions/execute', {
      method: 'POST',
      body: JSON.stringify({ actionId: unapprovedAction.id }),
    });
    const bypassRes = await executeActionRoute(bypassReq);

    expect(bypassRes.status).toBe(403);
    const bypassData = await bypassRes.json();
    expect(bypassData.error).toBe('Execution Blocked');

    // Verify DB state remains PENDING_APPROVAL
    const dbAction = await prisma.campaignAction.findUnique({ where: { id: unapprovedAction.id } });
    expect(dbAction?.status).toBe('PENDING_APPROVAL');
    expect(dbAction?.approvedAt).toBeNull();
  });

  // ----------------------------------------------------------------------------
  // 5. Duplicate Execution Idempotency Test
  // ----------------------------------------------------------------------------
  it('5. Duplicate Execution Idempotency: Repeated execution returns existing record', async () => {
    const repeatReq = new NextRequest('http://localhost:3000/api/actions/execute', {
      method: 'POST',
      body: JSON.stringify({ actionId: happyActionId }),
    });
    const repeatRes = await executeActionRoute(repeatReq);
    expect(repeatRes.status).toBe(200);

    const repeatData = await repeatRes.json();
    expect(repeatData.isIdempotent).toBe(true);
    expect(repeatData.message).toContain('Returned existing execution record');
  });

  // ----------------------------------------------------------------------------
  // 6. Duplicate Measurement Idempotency Test
  // ----------------------------------------------------------------------------
  it('6. Duplicate Measurement Idempotency: Repeated measurement returns existing record', async () => {
    const repeatMeasReq = new NextRequest('http://localhost:3000/api/measurements', {
      method: 'POST',
      body: JSON.stringify({ actionId: happyActionId }),
    });
    const repeatMeasRes = await measurementRoute(repeatMeasReq);
    expect(repeatMeasRes.status).toBe(200);

    const repeatMeasData = await repeatMeasRes.json();
    expect(repeatMeasData.isIdempotent).toBe(true);
    expect(repeatMeasData.message).toContain('Returned existing outcome measurement');
  });

  // ----------------------------------------------------------------------------
  // 7. AI Provider Fallback Test
  // ----------------------------------------------------------------------------
  it('7. AI Provider Fallback: Mock provider operates deterministically without external keys', async () => {
    const mock = new MockAIProvider();
    const result = await mock.parseGoal(
      'I want ₹50,000 additional revenue this month. Keep margin above 25% and discount below 10%.'
    );

    expect(result.targetRevenue).toBe(50000);
    expect(result.timeframeDays).toBe(30);
    expect(result.marginFloorPct).toBe(25);
    expect(result.discountCapPct).toBe(10);
  });

  // ----------------------------------------------------------------------------
  // 8. Metric Consistency Audit
  // ----------------------------------------------------------------------------
  it('8. Metric Consistency Audit: Distinguishes Actual Incremental Revenue from Actual Net Value', () => {
    const metrics = calculateMeasurementMetrics({
      predictedRevenue: 60000,
      actualRevenue: 57500, // Actual Incremental Revenue
      predictedNetValue: 54208, // Predicted Expected Net Value
      actualNetValue: 51900, // Actual Net Value
      targetRevenue: 50000, // Target Revenue
    });

    // Metric 1: Actual Incremental Revenue
    expect(metrics.actualRevenue).toBe(57500);
    // Metric 2: Net Value Variance (-₹2,308)
    expect(metrics.netValueDelta).toBe(-2308);
    // Metric 3: Prediction Accuracy (95.7%)
    expect(metrics.predictionAccuracyPct).toBe(95.7);
    // Metric 4: Goal Progress (115.0%)
    expect(metrics.goalProgressPct).toBe(115.0);
    // Metric 5: Revenue strictly differs from Net Value
    expect(metrics.actualRevenue).not.toBe(metrics.actualNetValue);
    expect(metrics.actualRevenue - metrics.actualNetValue).toBe(5600); // 57,500 - 51,900 = 5,600 (incentives)
  });

  // ----------------------------------------------------------------------------
  // 9. State Machine Integrity & Anti-Spoofing
  // ----------------------------------------------------------------------------
  it('9. State Machine Integrity: Prevents skipping stages or unauthorized jumps', () => {
    // Attempt to jump directly from CANDIDATE_DISCOVERED to ACTION_INITIATED
    expect(() =>
      validateStateTransition({
        entityId: 'test-entity',
        fromState: 'CANDIDATE_DISCOVERED',
        toState: 'ACTION_INITIATED',
        actor: 'AGENT',
      })
    ).toThrow(IllegalStateTransitionError);

    // Attempt to approve without actor = MERCHANT
    expect(() =>
      validateStateTransition({
        entityId: 'test-entity',
        fromState: 'DECISION_AWAITING_APPROVAL',
        toState: 'ACTION_APPROVED',
        isMerchantApproved: true,
        actor: 'AGENT', // Only MERCHANT can approve
      })
    ).toThrow(IllegalStateTransitionError);
  });
});
