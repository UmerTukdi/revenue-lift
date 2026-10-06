import { describe, it, expect, beforeEach } from 'vitest';
import prisma from '../lib/db';
import { executeRazorpayCampaignAction } from '../lib/razorpay';
import { POST as approveActionRoute } from '../app/api/actions/approve/route';
import { POST as executeActionRoute } from '../app/api/actions/execute/route';
import { NextRequest } from 'next/server';

describe('Razorpay Test-Mode Execution & Governance (Step 4)', () => {
  let testMerchantId: string;
  let testGoalId: string;
  let testOpportunityId: string;
  let testActionId: string;

  beforeEach(async () => {
    // Set up clean synthetic test records for each test run
    const merchant = await prisma.merchant.create({
      data: {
        name: 'ShopNova Governance Test Merchant',
        email: `test_merchant_${Date.now()}_${Math.random()}@shopnova.in`,
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
        title: 'Governance Win-Back Campaign [SYNTHETIC TEST]',
        description: 'Test offer for governance validation',
        targetSegment: 'DORMANT_HIGH_LTV',
        eligibleCustomers: 200,
        acceptanceProbability: 0.2,
        incrementalRevenuePerCustomer: 800,
        incentiveCostPerCustomer: 50,
        expectedNetValue: 30000,
        projectedMarginPct: 28.0,
        projectedDiscountPct: 6.25,
        inventoryImpact: 20,
        status: 'ELIGIBLE',
        isRecommended: true,
      },
    });
    testOpportunityId = opportunity.id;

    const action = await prisma.campaignAction.create({
      data: {
        opportunityId: opportunity.id,
        status: 'PENDING_APPROVAL',
      },
    });
    testActionId = action.id;
  });

  // --------------------------------------------------------------------------
  // 1. Approval Governance API Tests
  // --------------------------------------------------------------------------
  describe('1. Merchant Approval API (/api/actions/approve)', () => {
    it('approves a valid pending action and records merchant approval timestamp', async () => {
      const req = new NextRequest('http://localhost:3000/api/actions/approve', {
        method: 'POST',
        body: JSON.stringify({ actionId: testActionId }),
      });

      const res = await approveActionRoute(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.status).toBe('APPROVED');
      expect(data.approvedBy).toBe('merchant_admin');
      expect(data.approvedAt).toBeDefined();

      // Verify DB record
      const dbAction = await prisma.campaignAction.findUnique({ where: { id: testActionId } });
      expect(dbAction?.status).toBe('APPROVED');
      expect(dbAction?.approvedAt).not.toBeNull();
    });

    it('creates an immutable MERCHANT_APPROVED audit event with actor = MERCHANT', async () => {
      const req = new NextRequest('http://localhost:3000/api/actions/approve', {
        method: 'POST',
        body: JSON.stringify({ actionId: testActionId }),
      });

      await approveActionRoute(req);

      const auditEvent = await prisma.auditEvent.findFirst({
        where: {
          entityId: testActionId,
          eventType: 'MERCHANT_APPROVED',
        },
      });

      expect(auditEvent).toBeDefined();
      expect(auditEvent?.actor).toBe('MERCHANT');
      expect(auditEvent?.summary).toContain('Merchant explicitly approved action');
    });

    it('rejects approval if action is not in PENDING_APPROVAL status (prevents double approval)', async () => {
      // First approval
      await prisma.campaignAction.update({
        where: { id: testActionId },
        data: { status: 'APPROVED', approvedAt: new Date() },
      });

      const req = new NextRequest('http://localhost:3000/api/actions/approve', {
        method: 'POST',
        body: JSON.stringify({ actionId: testActionId }),
      });

      const res = await approveActionRoute(req);
      expect(res.status).toBe(409); // Conflict

      const data = await res.json();
      expect(data.error).toBe('Conflict');
      expect(data.message).toContain('must be PENDING_APPROVAL');
    });

    it('rejects invalid or missing actionId with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/actions/approve', {
        method: 'POST',
        body: JSON.stringify({ actionId: '' }),
      });

      const res = await approveActionRoute(req);
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent action ID', async () => {
      const req = new NextRequest('http://localhost:3000/api/actions/approve', {
        method: 'POST',
        body: JSON.stringify({ actionId: 'non_existent_action_cuid_999' }),
      });

      const res = await approveActionRoute(req);
      expect(res.status).toBe(404);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Execution Governance API Tests
  // --------------------------------------------------------------------------
  describe('2. Razorpay Execution API (/api/actions/execute)', () => {
    it('STRICTLY BLOCKS execution if merchant approval is missing', async () => {
      // Action is still PENDING_APPROVAL
      const req = new NextRequest('http://localhost:3000/api/actions/execute', {
        method: 'POST',
        body: JSON.stringify({ actionId: testActionId }),
      });

      const res = await executeActionRoute(req);
      expect(res.status).toBe(403); // Forbidden

      const data = await res.json();
      expect(data.error).toBe('Execution Blocked');
      expect(data.message).toContain('has not been approved by the merchant');

      // Verify action was NOT executed and remained PENDING_APPROVAL
      const dbAction = await prisma.campaignAction.findUnique({ where: { id: testActionId } });
      expect(dbAction?.status).toBe('PENDING_APPROVAL');

      // Verify audit trail captured the blocked attempt
      const auditEvent = await prisma.auditEvent.findFirst({
        where: {
          entityId: testActionId,
          eventType: 'EXECUTION_FAILED',
        },
      });
      expect(auditEvent?.summary).toContain('Execution BLOCKED');
    });

    it('executes successfully via Razorpay test mode when merchant approval is present', async () => {
      // 1. Explicitly approve first
      await prisma.campaignAction.update({
        where: { id: testActionId },
        data: { status: 'APPROVED', approvedAt: new Date(), approvedBy: 'merchant_admin' },
      });

      // 2. Execute
      const req = new NextRequest('http://localhost:3000/api/actions/execute', {
        method: 'POST',
        body: JSON.stringify({ actionId: testActionId }),
      });

      const res = await executeActionRoute(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.status).toBe('COMPLETED');
      expect(data.provider).toBeDefined();
      expect(data.linksCreated).toBe(200);

      // Verify Execution record created in database
      const execution = await prisma.execution.findFirst({
        where: { actionId: testActionId },
      });
      expect(execution).toBeDefined();
      expect(execution?.status).toBe('SUCCESS');
      expect(execution?.linksCreated).toBe(200);

      // Verify action moved to COMPLETED
      const dbAction = await prisma.campaignAction.findUnique({ where: { id: testActionId } });
      expect(dbAction?.status).toBe('COMPLETED');
    });

    it('enforces idempotency and prevents duplicate execution', async () => {
      // Approve and mark completed with existing execution
      await prisma.campaignAction.update({
        where: { id: testActionId },
        data: { status: 'COMPLETED', approvedAt: new Date() },
      });
      const initialExecution = await prisma.execution.create({
        data: {
          actionId: testActionId,
          gateway: 'RAZORPAY_SIMULATED',
          batchId: 'plink_existing_batch_123',
          status: 'SUCCESS',
          linksCreated: 200,
        },
      });

      // Attempt duplicate execution
      const req = new NextRequest('http://localhost:3000/api/actions/execute', {
        method: 'POST',
        body: JSON.stringify({ actionId: testActionId }),
      });

      const res = await executeActionRoute(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.isIdempotent).toBe(true);
      expect(data.message).toContain('already successfully executed');
      expect(data.executionId).toBe(initialExecution.id);

      // Verify no extra Execution record was created
      const count = await prisma.execution.count({ where: { actionId: testActionId } });
      expect(count).toBe(1);
    });

    it('executes failure simulation cleanly without claiming success', async () => {
      // Approve
      await prisma.campaignAction.update({
        where: { id: testActionId },
        data: { status: 'APPROVED', approvedAt: new Date() },
      });

      // Execute with forceFailure = true
      const req = new NextRequest('http://localhost:3000/api/actions/execute', {
        method: 'POST',
        body: JSON.stringify({ actionId: testActionId, forceFailure: true }),
      });

      const res = await executeActionRoute(req);
      expect(res.status).toBe(502);

      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.status).toBe('FAILED');
      expect(data.errorCode).toBe('DEMO_GATEWAY_TIMEOUT');
      expect(data.message).toContain('Execution failed. No customer was notified or charged.');

      // Verify DB action status preserved as FAILED
      const dbAction = await prisma.campaignAction.findUnique({ where: { id: testActionId } });
      expect(dbAction?.status).toBe('FAILED');

      // Verify execution record marked as FAILED
      const execution = await prisma.execution.findFirst({
        where: { actionId: testActionId },
      });
      expect(execution?.status).toBe('FAILED');
      expect(execution?.errorMessage).toContain('DEMO FAILURE SIMULATION');
    });

    it('guarantees secrets never appear in audit events or execution records', async () => {
      // Approve and execute
      await prisma.campaignAction.update({
        where: { id: testActionId },
        data: { status: 'APPROVED', approvedAt: new Date() },
      });

      const req = new NextRequest('http://localhost:3000/api/actions/execute', {
        method: 'POST',
        body: JSON.stringify({ actionId: testActionId }),
      });
      await executeActionRoute(req);

      // Inspect all audit events and execution records
      const audits = await prisma.auditEvent.findMany({ where: { merchantId: testMerchantId } });
      for (const a of audits) {
        expect(a.summary).not.toContain('rzp_test_mock_secret');
        expect(a.detailsJson || '').not.toContain('rzp_test_mock_secret');
        expect(a.summary).not.toContain('RAZORPAY_KEY_SECRET');
      }

      const execution = await prisma.execution.findFirst({ where: { actionId: testActionId } });
      expect(execution?.payloadSent || '').not.toContain('rzp_test_mock_secret');
      expect(execution?.responseReceived || '').not.toContain('rzp_test_mock_secret');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Razorpay Service Module Tests
  // --------------------------------------------------------------------------
  describe('3. Razorpay Service Unit Tests (src/lib/razorpay.ts)', () => {
    it('executes in simulated test mode when forceFailure is false', async () => {
      const result = await executeRazorpayCampaignAction({
        actionId: 'act_test_unit_1',
        opportunityId: 'opp_test_1',
        opportunityType: 'WINBACK_CAMPAIGN',
        title: 'Win-Back Unit Test',
        targetSegment: 'DORMANT_HIGH_LTV',
        eligibleCustomers: 150,
        incrementalRevenuePerCustomer: 900,
        incentiveCostPerCustomer: 75,
        forceFailure: false,
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('SUCCESS');
      expect(result.provider).toBe('RAZORPAY_SIMULATED');
      expect(result.paymentLinksCreated).toBe(150);
      expect(result.providerReferenceId).toContain('plink_test_batch_');
    });

    it('returns simulated failure with DEMO_GATEWAY_TIMEOUT when forceFailure is true', async () => {
      const result = await executeRazorpayCampaignAction({
        actionId: 'act_test_unit_2',
        opportunityId: 'opp_test_2',
        opportunityType: 'TARGETED_DISCOUNT',
        title: 'Failure Unit Test',
        targetSegment: 'PRICE_SENSITIVE',
        eligibleCustomers: 80,
        incrementalRevenuePerCustomer: 600,
        incentiveCostPerCustomer: 90,
        forceFailure: true,
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('FAILED');
      expect(result.errorCode).toBe('DEMO_GATEWAY_TIMEOUT');
      expect(result.paymentLinksCreated).toBe(0);
    });
  });
});
