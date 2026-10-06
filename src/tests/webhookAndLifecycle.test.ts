// ==============================================================================
// Revenue Lift — Webhooks, Goal Lifecycle, & Governance Tests
// ==============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import prisma from '../lib/db';
import { POST as webhookRoute } from '../app/api/webhooks/razorpay/route';
import { setMerchantGoal, discoverAndEvaluateOpportunities } from '../agent/tools';
import { verifyRazorpaySignature, getPaymentProvider } from '../lib/razorpay';

describe('Webhooks, Goal Lifecycle, & Governance Suite', () => {
  let testMerchantId: string;
  let testGoalId: string;
  let testOppId: string;
  let testActionId: string;
  const webhookSecret = 'test_webhook_secret_key_12345';

  beforeAll(async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

    // Create isolated test merchant
    const merchant = await prisma.merchant.create({
      data: {
        name: 'Webhook & Lifecycle QA Merchant [TEST]',
        email: 'webhook-qa@shopnova.test',
        currency: 'INR',
        baseMarginPct: 35.0,
        isSynthetic: true,
      },
    });
    testMerchantId = merchant.id;

    // Create initial goal
    const goalRes = await setMerchantGoal({
      merchantId: testMerchantId,
      targetRevenue: 50000,
      timeframeDays: 30,
      marginFloorPct: 25.0,
      discountCapPct: 10.0,
    });
    testGoalId = goalRes.goalId;

    // Create opportunity & campaign action
    const opp = await prisma.opportunity.create({
      data: {
        goalId: testGoalId,
        type: 'FAILED_PAYMENT_RECOVERY',
        title: 'Webhook Test Recovery Link',
        description: 'Testing webhook payment completion',
        targetSegment: 'FAILED_CHECKOUT',
        eligibleCustomers: 20,
        acceptanceProbability: 0.35,
        incrementalRevenuePerCustomer: 1500,
        incentiveCostPerCustomer: 6,
        expectedNetValue: 10458,
        projectedMarginPct: 35.0,
        projectedDiscountPct: 0.0,
        status: 'ELIGIBLE',
      },
    });
    testOppId = opp.id;

    const action = await prisma.campaignAction.create({
      data: {
        opportunityId: opp.id,
        status: 'INITIATED',
        decisionRationale: 'Awaiting webhook confirmation',
      },
    });
    testActionId = action.id;

    // Create execution record referencing a known payment link id
    await prisma.execution.create({
      data: {
        actionId: action.id,
        gateway: 'RAZORPAY_TEST',
        provider: 'RAZORPAY',
        providerReferenceId: 'plink_webhook_qa_98765',
        batchId: 'plink_webhook_qa_98765',
        status: 'INITIATED',
        linksCreated: 1,
        isSimulated: false,
      },
    });
  });

  afterAll(async () => {
    // Cleanup records
    await prisma.webhookEvent.deleteMany({
      where: {
        OR: [
          { actionId: testActionId },
          { eventId: { contains: 'test_evt' } },
        ],
      },
    });
    await prisma.payment.deleteMany({
      where: { razorpayOrderId: 'order_webhook_qa_test' },
    });
    await prisma.execution.deleteMany({ where: { actionId: testActionId } });
    await prisma.campaignAction.deleteMany({ where: { opportunityId: testOppId } });
    await prisma.opportunity.deleteMany({ where: { goalId: testGoalId } });
    await prisma.goal.deleteMany({ where: { merchantId: testMerchantId } });
    await prisma.merchant.deleteMany({ where: { id: testMerchantId } });
  });

  // --------------------------------------------------------------------------
  // 1. Goal Lifecycle Management
  // --------------------------------------------------------------------------
  describe('1. Goal Lifecycle Management', () => {
    it('creates and activates a goal, setting previous goals to CANCELLED', async () => {
      // Create a second goal with new revenue and constraints
      const newGoalRes = await setMerchantGoal({
        merchantId: testMerchantId,
        targetRevenue: 100000,
        timeframeDays: 60,
        marginFloorPct: 35.0,
        discountCapPct: 5.0,
      });

      expect(newGoalRes.goalId).toBeDefined();
      expect(newGoalRes.targetRevenue).toBe(100000);

      // Verify previous goal was deactivated (not silently reused)
      const previousGoal = await prisma.goal.findUnique({
        where: { id: testGoalId },
      });
      expect(previousGoal?.status).toBe('CANCELLED');

      // Verify active goal has new constraints
      const currentGoal = await prisma.goal.findUnique({
        where: { id: newGoalRes.goalId },
        include: { constraints: true },
      });
      expect(currentGoal?.status).toBe('ACTIVE');
      expect(currentGoal?.targetRevenue).toBe(100000);

      const marginConstraint = currentGoal?.constraints.find(
        (c) => c.type === 'MARGIN_FLOOR'
      );
      expect(marginConstraint?.thresholdValue).toBe(35.0);
    });
  });

  // --------------------------------------------------------------------------
  // 2. CampaignAction Idempotency on Re-Evaluation
  // --------------------------------------------------------------------------
  describe('2. CampaignAction Idempotency', () => {
    it('does not create duplicate CampaignAction records when discovery runs repeatedly', async () => {
      // Run evaluation twice
      await discoverAndEvaluateOpportunities({
        goalId: testGoalId,
        merchantId: testMerchantId,
      });

      const actionsCountFirst = await prisma.campaignAction.count({
        where: { opportunity: { goalId: testGoalId } },
      });

      await discoverAndEvaluateOpportunities({
        goalId: testGoalId,
        merchantId: testMerchantId,
      });

      const actionsCountSecond = await prisma.campaignAction.count({
        where: { opportunity: { goalId: testGoalId } },
      });

      expect(actionsCountSecond).toBe(actionsCountFirst);
    });
  });

  // --------------------------------------------------------------------------
  // 3. PaymentProvider Abstraction
  // --------------------------------------------------------------------------
  describe('3. PaymentProvider Abstraction', () => {
    it('returns DemoPaymentProvider in demo mode and RazorpayPaymentProvider in live/test mode', () => {
      const demoProvider = getPaymentProvider(true);
      expect(demoProvider.name).toBe('RAZORPAY_SIMULATED');
      expect(demoProvider.isSimulated).toBe(true);

      const liveProvider = getPaymentProvider(false);
      expect(liveProvider.name).toBe('RAZORPAY');
      expect(liveProvider.isSimulated).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Webhook Signature Verification
  // --------------------------------------------------------------------------
  describe('4. Razorpay Webhook Signature Verification', () => {
    it('verifies valid HMAC SHA256 signatures correctly', () => {
      const payload = JSON.stringify({ event: 'payment.captured', id: 'test_evt_1' });
      const validSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(payload)
        .digest('hex');

      expect(verifyRazorpaySignature(payload, validSignature)).toBe(true);
    });

    it('rejects tampered or invalid signatures', () => {
      const payload = JSON.stringify({ event: 'payment.captured', id: 'test_evt_1' });
      const invalidSignature = 'invalid_tampered_signature_hex_value_12345678';

      expect(verifyRazorpaySignature(payload, invalidSignature)).toBe(false);
    });

    it('rejects requests with missing or invalid signature header with 400', async () => {
      const req = new NextRequest('http://localhost:3000/api/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ event: 'payment.captured' }),
      });

      const res = await webhookRoute(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toContain('x-razorpay-signature');
    });
  });

  // --------------------------------------------------------------------------
  // 5. Successful Payment Webhook & Action Attribution
  // --------------------------------------------------------------------------
  describe('5. Payment Attribution & State Transition', () => {
    it('processes payment_link.paid webhook, marks action COMPLETED, and records payment', async () => {
      const eventId = `test_evt_paid_${Date.now()}`;
      const payload = {
        id: eventId,
        event: 'payment_link.paid',
        payload: {
          payment_link: {
            entity: {
              id: 'plink_webhook_qa_98765',
              amount: 150000, // 1500 INR in paise
              status: 'paid',
              order_id: 'order_webhook_qa_test',
              notes: {
                actionId: testActionId,
              },
            },
          },
          payment: {
            entity: {
              id: `pay_qa_test_${Date.now()}`,
              amount: 150000,
              currency: 'INR',
              status: 'captured',
              order_id: 'order_webhook_qa_test',
            },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      const req = new NextRequest('http://localhost:3000/api/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': signature,
        },
        body: rawBody,
      });

      const res = await webhookRoute(req);
      expect(res.status).toBe(200);

      const resData = await res.json();
      expect(resData.received).toBe(true);
      expect(resData.mapped).toBe(true);
      expect(resData.actionId).toBe(testActionId);

      // Verify DB CampaignAction state is COMPLETED
      const actionInDb = await prisma.campaignAction.findUnique({
        where: { id: testActionId },
      });
      expect(actionInDb?.status).toBe('COMPLETED');

      // Verify DB Execution record is SUCCESS
      const executionInDb = await prisma.execution.findFirst({
        where: { actionId: testActionId },
      });
      expect(executionInDb?.status).toBe('SUCCESS');
    });

    it('handles duplicate webhook delivery idempotently without creating duplicate records', async () => {
      const eventId = `test_evt_duplicate_${Date.now()}`;
      const payload = {
        id: eventId,
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: `pay_qa_duplicate_${Date.now()}`,
              amount: 200000,
              currency: 'INR',
              status: 'captured',
              notes: { actionId: testActionId },
            },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      // First webhook post
      const req1 = new NextRequest('http://localhost:3000/api/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': signature,
        },
        body: rawBody,
      });
      const res1 = await webhookRoute(req1);
      expect(res1.status).toBe(200);

      // Second webhook post (duplicate)
      const req2 = new NextRequest('http://localhost:3000/api/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': signature,
        },
        body: rawBody,
      });
      const res2 = await webhookRoute(req2);
      expect(res2.status).toBe(200);

      const res2Data = await res2.json();
      expect(res2Data.idempotent).toBe(true);
      expect(res2Data.message).toContain('already processed');
    });

    it('handles payment.failed webhook safely by updating action state to FAILED', async () => {
      // Create a fresh action in INITIATED state to test failure webhook
      const failAction = await prisma.campaignAction.create({
        data: {
          opportunityId: testOppId,
          status: 'INITIATED',
          decisionRationale: 'Testing failure webhook',
        },
      });

      const eventId = `test_evt_failed_${Date.now()}`;
      const payload = {
        id: eventId,
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: `pay_qa_fail_${Date.now()}`,
              amount: 150000,
              currency: 'INR',
              status: 'failed',
              error_code: 'BAD_REQUEST_ERROR',
              error_description: 'Card declined by issuing bank',
              notes: { actionId: failAction.id },
            },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      const req = new NextRequest('http://localhost:3000/api/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': signature,
        },
        body: rawBody,
      });

      const res = await webhookRoute(req);
      expect(res.status).toBe(200);

      const resData = await res.json();
      expect(resData.received).toBe(true);

      // Verify Action status is marked FAILED
      const dbAction = await prisma.campaignAction.findUnique({
        where: { id: failAction.id },
      });
      expect(dbAction?.status).toBe('FAILED');
    });

    it('handles unmapped references gracefully without throwing 500', async () => {
      const eventId = `test_evt_unmapped_${Date.now()}`;
      const payload = {
        id: eventId,
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: `pay_unmapped_${Date.now()}`,
              amount: 50000,
              currency: 'INR',
              status: 'captured',
            },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      const req = new NextRequest('http://localhost:3000/api/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': signature,
        },
        body: rawBody,
      });

      const res = await webhookRoute(req);
      expect(res.status).toBe(200);

      const resData = await res.json();
      expect(resData.received).toBe(true);
      expect(resData.mapped).toBe(false);
    });
  });
});
