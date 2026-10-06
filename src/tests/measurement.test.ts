import { describe, it, expect, beforeEach } from 'vitest';
import prisma from '../lib/db';
import { calculateMeasurementMetrics } from '../core/measurement';
import { POST as measurementRoute, GET as getMeasurementRoute } from '../app/api/measurements/route';
import { NextRequest } from 'next/server';

describe('Measurement & Outcome Reconciliation Engine (Step 5)', () => {
  let testMerchantId: string;
  let testGoalId: string;
  let testOpportunityId: string;
  let testActionId: string;

  beforeEach(async () => {
    // Synthetic test fixture setup
    const merchant = await prisma.merchant.create({
      data: {
        name: 'ShopNova Measurement Test Merchant',
        email: `merchant_meas_${Date.now()}_${Math.random()}@shopnova.in`,
        isSynthetic: true,
      },
    });
    testMerchantId = merchant.id;

    const goal = await prisma.goal.create({
      data: {
        merchantId: merchant.id,
        targetRevenue: 50000,
        timeframeDays: 30,
        status: 'ACTIVE',
      },
    });
    testGoalId = goal.id;

    const opportunity = await prisma.opportunity.create({
      data: {
        goalId: goal.id,
        type: 'WINBACK_CAMPAIGN',
        title: 'Win-Back Measurement Opportunity [TEST]',
        description: 'Test offer for outcome measurement',
        targetSegment: 'DORMANT_HIGH_LTV',
        eligibleCustomers: 350,
        acceptanceProbability: 0.22,
        incrementalRevenuePerCustomer: 780,
        incentiveCostPerCustomer: 76,
        expectedNetValue: 54208,
        projectedMarginPct: 28.5,
        projectedDiscountPct: 8.0,
        inventoryImpact: 40,
        status: 'ELIGIBLE',
        isRecommended: true,
      },
    });
    testOpportunityId = opportunity.id;

    const action = await prisma.campaignAction.create({
      data: {
        opportunityId: opportunity.id,
        status: 'COMPLETED',
        approvedAt: new Date(),
        approvedBy: 'merchant_admin',
      },
    });
    testActionId = action.id;

    // Seed successful execution
    await prisma.execution.create({
      data: {
        actionId: action.id,
        gateway: 'RAZORPAY_TEST',
        batchId: 'plink_meas_test_batch_001',
        status: 'SUCCESS',
        linksCreated: 350,
      },
    });
  });

  // --------------------------------------------------------------------------
  // 1. Pure Deterministic Measurement Metrics
  // --------------------------------------------------------------------------
  describe('1. Measurement Pure Logic (src/core/measurement.ts)', () => {
    it('calculates predicted vs actual metrics using integer paise precision', () => {
      // Predicted Net: ₹54,208, Actual Net: ₹51,900
      // Net Delta: 51,900 - 54,208 = -2,308
      // Predicted Rev: ₹60,060, Actual Rev: ₹57,500
      // Rev Delta: 57,500 - 60,060 = -2,560
      const metrics = calculateMeasurementMetrics({
        predictedRevenue: 60060,
        actualRevenue: 57500,
        predictedNetValue: 54208,
        actualNetValue: 51900,
        targetRevenue: 50000,
        conversionsCount: 74,
      });

      expect(metrics.predictedRevenue).toBe(60060);
      expect(metrics.actualRevenue).toBe(57500);
      expect(metrics.revenueDelta).toBe(-2560);
      expect(metrics.predictedNetValue).toBe(54208);
      expect(metrics.actualNetValue).toBe(51900);
      expect(metrics.netValueDelta).toBe(-2308);

      // Prediction accuracy: 100 - (2,308 / 54,208)*100 = 95.7%
      expect(metrics.predictionAccuracyPct).toBe(95.7);

      // Goal progress: 57,500 / 50,000 = 115.0%
      expect(metrics.goalProgressPct).toBe(115.0);
      expect(metrics.isGoalAchieved).toBe(true);
    });

    it('handles zero target revenue gracefully', () => {
      const metrics = calculateMeasurementMetrics({
        predictedRevenue: 10000,
        actualRevenue: 8000,
        predictedNetValue: 8000,
        actualNetValue: 6400,
        targetRevenue: 0,
      });

      expect(metrics.goalProgressPct).toBe(0);
      expect(metrics.predictionAccuracyPct).toBe(80.0);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Measurement API Governance
  // --------------------------------------------------------------------------
  describe('2. Measurement API Governance (/api/measurements)', () => {
    it('records measurement successfully when action has COMPLETED execution', async () => {
      const req = new NextRequest('http://localhost:3000/api/measurements', {
        method: 'POST',
        body: JSON.stringify({
          actionId: testActionId,
          syntheticActualRevenue: 57500,
          syntheticActualNetValue: 51900,
        }),
      });

      const res = await measurementRoute(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.metrics.predictionAccuracyPct).toBe(95.7);
      expect(data.metrics.actualNetValue).toBe(51900);
      expect(data.environment).toBe('SYNTHETIC DEMO MEASUREMENT');

      // Verify DB record
      const dbMeas = await prisma.measurement.findUnique({ where: { actionId: testActionId } });
      expect(dbMeas).toBeDefined();
      expect(dbMeas?.actualNetValue).toBe(51900);

      // Verify Goal attained
      const dbGoal = await prisma.goal.findUnique({ where: { id: testGoalId } });
      expect(dbGoal?.status).toBe('ACHIEVED');
      expect(dbGoal?.achievedRevenue).toBe(57500);

      // Verify Audit Event logged
      const audit = await prisma.auditEvent.findFirst({
        where: { eventType: 'MEASUREMENT_RECORDED', entityId: dbMeas?.id },
      });
      expect(audit).toBeDefined();
      expect(audit?.summary).toContain('95.7% accuracy');
    });

    it('STRICTLY BLOCKS measurement if action has NOT been completed', async () => {
      // Create pending action
      const pendingAction = await prisma.campaignAction.create({
        data: {
          opportunityId: testOpportunityId,
          status: 'PENDING_APPROVAL',
        },
      });

      const req = new NextRequest('http://localhost:3000/api/measurements', {
        method: 'POST',
        body: JSON.stringify({ actionId: pendingAction.id }),
      });

      const res = await measurementRoute(req);
      expect(res.status).toBe(403);

      const data = await res.json();
      expect(data.error).toBe('Measurement Unavailable');
      expect(data.message).toContain('must be successfully executed first');
    });

    it('STRICTLY BLOCKS measurement if execution FAILED', async () => {
      // Action is FAILED
      const failedAction = await prisma.campaignAction.create({
        data: {
          opportunityId: testOpportunityId,
          status: 'FAILED',
          approvedAt: new Date(),
        },
      });
      await prisma.execution.create({
        data: {
          actionId: failedAction.id,
          gateway: 'RAZORPAY_TEST',
          status: 'FAILED',
          errorMessage: 'Gateway error',
        },
      });

      const req = new NextRequest('http://localhost:3000/api/measurements', {
        method: 'POST',
        body: JSON.stringify({ actionId: failedAction.id }),
      });

      const res = await measurementRoute(req);
      expect(res.status).toBe(403);

      const data = await res.json();
      expect(data.error).toBe('Measurement Unavailable');
    });

    it('safely handles idempotent duplicate measurement requests', async () => {
      // First measurement
      const req1 = new NextRequest('http://localhost:3000/api/measurements', {
        method: 'POST',
        body: JSON.stringify({ actionId: testActionId }),
      });
      await measurementRoute(req1);

      // Duplicate measurement request
      const req2 = new NextRequest('http://localhost:3000/api/measurements', {
        method: 'POST',
        body: JSON.stringify({ actionId: testActionId }),
      });
      const res2 = await measurementRoute(req2);
      expect(res2.status).toBe(200);

      const data2 = await res2.json();
      expect(data2.isIdempotent).toBe(true);
      expect(data2.message).toContain('Returned existing outcome measurement');

      // Verify no duplicate records in DB
      const count = await prisma.measurement.count({ where: { actionId: testActionId } });
      expect(count).toBe(1);
    });

    it('retrieves measurement via GET endpoint', async () => {
      // Record measurement first
      const postReq = new NextRequest('http://localhost:3000/api/measurements', {
        method: 'POST',
        body: JSON.stringify({ actionId: testActionId }),
      });
      await measurementRoute(postReq);

      // Fetch via GET
      const getReq = new NextRequest(`http://localhost:3000/api/measurements?actionId=${testActionId}`);
      const getRes = await getMeasurementRoute(getReq);
      expect(getRes.status).toBe(200);

      const getData = await getRes.json();
      expect(getData.actionId).toBe(testActionId);
      expect(getData.metrics.actualNetValue).toBeDefined();
    });
  });
});
