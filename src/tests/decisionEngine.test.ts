import { describe, it, expect } from 'vitest';
import { calculateExpectedNetValue, inrToPaise, paiseToInr } from '../core/scoring';
import { evaluateHardConstraints, HardConstraintRule } from '../core/constraints';
import { evaluateOpportunities, OpportunityCandidate } from '../core/evaluator';
import { validateStateTransition } from '../core/stateMachine';
import { createAuditRecord } from '../core/auditLogger';
import { evaluateDedupeInterval } from '../core/dedupe';
import { IllegalStateTransitionError } from '../core/errors';
import { DEMO_OPPORTUNITY_CANDIDATES } from '../opportunities/demoCandidates';

describe('Deterministic Revenue Decision Engine (Step 2)', () => {
  // Standard hard constraints fixture matching merchant's goal
  const standardConstraints: HardConstraintRule[] = [
    { type: 'MARGIN_FLOOR', operator: 'GTE', thresholdValue: 25.0, unit: 'PERCENT', isHard: true },
    { type: 'DISCOUNT_CAP', operator: 'LTE', thresholdValue: 10.0, unit: 'PERCENT', isHard: true },
    { type: 'INVENTORY_MIN', operator: 'GTE', thresholdValue: 15.0, unit: 'UNITS', isHard: true },
    { type: 'DUPLICATE_WINDOW_DAYS', operator: 'GTE', thresholdValue: 14.0, unit: 'DAYS', isHard: true },
  ];

  // --------------------------------------------------------------------------
  // 1. Scoring Engine & Expected Net Value Tests
  // --------------------------------------------------------------------------
  describe('1. Expected Net Value Scoring (src/core/scoring.ts)', () => {
    it('calculates Expected Net Value with non-zero incentive cost using integer paise precision', () => {
      // 500 customers * 20% conversion = 100 conversions
      // 100 * ₹800 revenue = ₹80,000
      // 100 * ₹50 incentive cost = ₹5,000
      // Expected Net Value = ₹75,000
      const res = calculateExpectedNetValue({
        eligibleCustomers: 500,
        acceptanceProbability: 0.20,
        incrementalRevenuePerCustomer: 800,
        incentiveCostPerCustomer: 50,
      });

      expect(res.expectedConversions).toBe(100);
      expect(res.incrementalRevenue).toBe(80000);
      expect(res.expectedIncentiveCost).toBe(5000);
      expect(res.expectedNetValue).toBe(75000);
      expect(res.expectedNetValuePaise).toBe(7500000); // 75,000 * 100 paise
    });

    it('calculates Expected Net Value with zero incentive cost', () => {
      const res = calculateExpectedNetValue({
        eligibleCustomers: 100,
        acceptanceProbability: 0.30,
        incrementalRevenuePerCustomer: 1200,
        incentiveCostPerCustomer: 0,
      });

      expect(res.expectedConversions).toBe(30);
      expect(res.incrementalRevenue).toBe(36000);
      expect(res.expectedIncentiveCost).toBe(0);
      expect(res.expectedNetValue).toBe(36000);
      expect(res.expectedNetValuePaise).toBe(3600000);
    });

    it('handles zero eligible customers gracefully', () => {
      const res = calculateExpectedNetValue({
        eligibleCustomers: 0,
        acceptanceProbability: 0.50,
        incrementalRevenuePerCustomer: 1500,
        incentiveCostPerCustomer: 100,
      });

      expect(res.expectedConversions).toBe(0);
      expect(res.incrementalRevenue).toBe(0);
      expect(res.expectedIncentiveCost).toBe(0);
      expect(res.expectedNetValue).toBe(0);
    });

    it('handles zero acceptance probability gracefully', () => {
      const res = calculateExpectedNetValue({
        eligibleCustomers: 1000,
        acceptanceProbability: 0,
        incrementalRevenuePerCustomer: 500,
        incentiveCostPerCustomer: 50,
      });

      expect(res.expectedConversions).toBe(0);
      expect(res.expectedNetValue).toBe(0);
    });

    it('throws error on out-of-bounds probability or negative inputs', () => {
      expect(() =>
        calculateExpectedNetValue({
          eligibleCustomers: 100,
          acceptanceProbability: 1.5, // Invalid > 1.0
          incrementalRevenuePerCustomer: 500,
          incentiveCostPerCustomer: 50,
        })
      ).toThrow('Acceptance probability (P) must be between 0.0 and 1.0');

      expect(() =>
        calculateExpectedNetValue({
          eligibleCustomers: -10, // Invalid negative
          acceptanceProbability: 0.5,
          incrementalRevenuePerCustomer: 500,
          incentiveCostPerCustomer: 50,
        })
      ).toThrow('Eligible customers count (N) must be non-negative');
    });

    it('converts correctly between INR and Paise', () => {
      expect(inrToPaise(1499.50)).toBe(149950);
      expect(paiseToInr(149950)).toBe(1499.50);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Hard Constraint Engine Tests
  // --------------------------------------------------------------------------
  describe('2. Hard Constraint Filters (src/core/constraints.ts)', () => {
    it('passes when margin is strictly above margin floor', () => {
      const summary = evaluateHardConstraints(
        {
          projectedMarginPct: 28.0,
          projectedDiscountPct: 5.0,
          projectedInventoryRemaining: 25,
          targetSegment: 'DORMANT_HIGH_LTV',
        },
        standardConstraints
      );

      expect(summary.isEligible).toBe(true);
      expect(summary.failedCount).toBe(0);
      const marginCheck = summary.checks.find((c) => c.type === 'MARGIN_FLOOR');
      expect(marginCheck?.passed).toBe(true);
    });

    it('rejects when margin falls below margin floor (e.g. 21% < 25%)', () => {
      const summary = evaluateHardConstraints(
        {
          projectedMarginPct: 21.0, // Fails 25% floor
          projectedDiscountPct: 8.0,
          projectedInventoryRemaining: 25,
          targetSegment: 'PRICE_SENSITIVE',
        },
        standardConstraints
      );

      expect(summary.isEligible).toBe(false);
      expect(summary.failedCount).toBe(1);
      expect(summary.rejectionReasons[0]).toContain('violates minimum margin floor of 25.0%');
    });

    it('passes when discount is within discount cap (e.g. 8% <= 10%)', () => {
      const summary = evaluateHardConstraints(
        {
          projectedMarginPct: 30.0,
          projectedDiscountPct: 8.0,
          projectedInventoryRemaining: 50,
          targetSegment: 'REGULAR',
        },
        standardConstraints
      );

      const discountCheck = summary.checks.find((c) => c.type === 'DISCOUNT_CAP');
      expect(discountCheck?.passed).toBe(true);
    });

    it('rejects when discount exceeds cap (e.g. 15% > 10%)', () => {
      const summary = evaluateHardConstraints(
        {
          projectedMarginPct: 30.0,
          projectedDiscountPct: 15.0, // Exceeds 10% cap
          projectedInventoryRemaining: 50,
          targetSegment: 'PRICE_SENSITIVE',
        },
        standardConstraints
      );

      expect(summary.isEligible).toBe(false);
      expect(summary.rejectionReasons[0]).toContain('exceeds maximum cap of 10.0%');
    });

    it('rejects when inventory falls below minimum buffer threshold', () => {
      const summary = evaluateHardConstraints(
        {
          projectedMarginPct: 30.0,
          projectedDiscountPct: 5.0,
          projectedInventoryRemaining: 8, // < 15 units min
          targetSegment: 'REGULAR',
        },
        standardConstraints
      );

      expect(summary.isEligible).toBe(false);
      const invCheck = summary.checks.find((c) => c.type === 'INVENTORY_MIN');
      expect(invCheck?.passed).toBe(false);
      expect(summary.rejectionReasons[0]).toContain('falls below minimum safe threshold of 15 units');
    });

    it('rejects when target segment is restricted', () => {
      const segmentRule: HardConstraintRule[] = [
        { type: 'SEGMENT_FILTER', operator: 'EQ', thresholdValue: 0, unit: 'UNITS', isHard: true },
      ];

      const summary = evaluateHardConstraints(
        {
          projectedMarginPct: 30.0,
          projectedDiscountPct: 5.0,
          projectedInventoryRemaining: 50,
          targetSegment: 'VIP_RESTRICTED',
          restrictedSegments: ['VIP_RESTRICTED', 'INTERNAL_TEST'],
        },
        segmentRule
      );

      expect(summary.isEligible).toBe(false);
      expect(summary.rejectionReasons[0]).toContain("Target segment 'VIP_RESTRICTED' is restricted");
    });

    it('records multiple simultaneous constraint failures', () => {
      const summary = evaluateHardConstraints(
        {
          projectedMarginPct: 18.0, // Fails 25% floor
          projectedDiscountPct: 20.0, // Fails 10% cap
          projectedInventoryRemaining: 5, // Fails 15 units
          targetSegment: 'PRICE_SENSITIVE',
        },
        standardConstraints
      );

      expect(summary.isEligible).toBe(false);
      expect(summary.failedCount).toBe(3);
      expect(summary.rejectionReasons.length).toBe(3);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Dedupe Protection Tests
  // --------------------------------------------------------------------------
  describe('3. Duplicate Action Prevention (src/core/dedupe.ts)', () => {
    it('passes when audience has never been contacted or exceeds duplicate window', () => {
      const res = evaluateDedupeInterval(30, 14, 'DORMANT_HIGH_LTV');
      expect(res.isDuplicate).toBe(false);
      expect(res.rejectionReason).toBeUndefined();

      const neverContacted = evaluateDedupeInterval(undefined, 14, 'NEW_USERS');
      expect(neverContacted.isDuplicate).toBe(false);
    });

    it('rejects when audience was contacted within the duplicate window', () => {
      const res = evaluateDedupeInterval(5, 14, 'DORMANT_HIGH_LTV');
      expect(res.isDuplicate).toBe(true);
      expect(res.rejectionReason).toContain('contacted 5 days ago, violating the 14-day dedupe window');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Opportunity Evaluation & Ranking Tests (Core Demo Narrative)
  // --------------------------------------------------------------------------
  describe('4. Opportunity Evaluation Pipeline & Ranking (src/core/evaluator.ts)', () => {
    it('disqualifies Case A (highest nominal value) due to constraint violations', () => {
      const report = evaluateOpportunities(DEMO_OPPORTUNITY_CANDIDATES, standardConstraints);

      const caseA = report.rejectedOpportunities.find((o) => o.id === 'opp_demo_case_a_rejected');
      expect(caseA).toBeDefined();
      expect(caseA?.isEligible).toBe(false);
      expect(caseA?.status).toBe('REJECTED');
      expect(caseA?.rejectionReasons.length).toBeGreaterThanOrEqual(2);
      expect(caseA?.rejectionReasons.some((r) => r.includes('margin floor'))).toBe(true);
      expect(caseA?.rejectionReasons.some((r) => r.includes('maximum cap'))).toBe(true);
    });

    it('GUARANTEES that a rejected opportunity CAN NEVER WIN even if it has the highest nominal Expected Net Value', () => {
      const report = evaluateOpportunities(DEMO_OPPORTUNITY_CANDIDATES, standardConstraints);

      const caseA = report.allOpportunities.find((o) => o.id === 'opp_demo_case_a_rejected');
      expect(caseA?.scoring.expectedNetValue).toBe(67800); // ₹67,800 is nominally the highest

      // Winner must NOT be Case A
      expect(report.winner).not.toBeNull();
      expect(report.winner?.id).not.toBe('opp_demo_case_a_rejected');
      expect(report.winner?.id).toBe('opp_demo_case_b_winner');
      expect(report.winner?.isWinner).toBe(true);
    });

    it('ranks ONLY eligible opportunities by Expected Net Value descending', () => {
      const report = evaluateOpportunities(DEMO_OPPORTUNITY_CANDIDATES, standardConstraints);

      expect(report.eligibleCount).toBe(2);
      expect(report.rejectedCount).toBe(1);

      // Rank 1: Win-Back Campaign (₹54,208 Expected Net Value)
      expect(report.eligibleOpportunities[0].id).toBe('opp_demo_case_b_winner');
      expect(report.eligibleOpportunities[0].rank).toBe(1);
      expect(report.eligibleOpportunities[0].scoring.expectedNetValue).toBe(54208);

      // Rank 2: Payment Recovery (₹31,405.50 Expected Net Value)
      expect(report.eligibleOpportunities[1].id).toBe('opp_demo_case_c_runner_up');
      expect(report.eligibleOpportunities[1].rank).toBe(2);
      expect(report.eligibleOpportunities[1].scoring.expectedNetValue).toBe(31405.50);
    });

    it('handles scenario where zero candidates are eligible', () => {
      // Extremely strict margin floor of 50% that disqualifies all demo candidates
      const strictConstraints: HardConstraintRule[] = [
        { type: 'MARGIN_FLOOR', operator: 'GTE', thresholdValue: 50.0, unit: 'PERCENT', isHard: true },
      ];

      const report = evaluateOpportunities(DEMO_OPPORTUNITY_CANDIDATES, strictConstraints);
      expect(report.eligibleCount).toBe(0);
      expect(report.rejectedCount).toBe(3);
      expect(report.winner).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // 5. State Machine Tests (Locked Lifecycle)
  // --------------------------------------------------------------------------
  describe('5. State Machine & Governance Gate (src/core/stateMachine.ts)', () => {
    it('allows legal Candidate -> Decision transition', () => {
      const res = validateStateTransition({
        entityId: 'opp_123',
        fromState: 'CANDIDATE_EVALUATED',
        toState: 'DECISION_RECOMMENDED',
        actor: 'SYSTEM',
      });

      expect(res.success).toBe(true);
      expect(res.fromStage).toBe('CANDIDATE');
      expect(res.toStage).toBe('DECISION');
    });

    it('requires merchant approval to transition Decision -> Action (ACTION_APPROVED)', () => {
      // Valid merchant approval
      const approvedRes = validateStateTransition({
        entityId: 'act_123',
        fromState: 'DECISION_AWAITING_APPROVAL',
        toState: 'ACTION_APPROVED',
        isMerchantApproved: true,
        actor: 'MERCHANT',
      });
      expect(approvedRes.success).toBe(true);

      // Attempt to transition without merchant approval -> MUST THROW
      expect(() =>
        validateStateTransition({
          entityId: 'act_123',
          fromState: 'DECISION_AWAITING_APPROVAL',
          toState: 'ACTION_APPROVED',
          isMerchantApproved: false, // Disallowed
          actor: 'AGENT',
        })
      ).toThrow(IllegalStateTransitionError);
    });

    it('strictly forbids skipping directly from Candidate to Action', () => {
      expect(() =>
        validateStateTransition({
          entityId: 'opp_123',
          fromState: 'CANDIDATE_DISCOVERED',
          toState: 'ACTION_INITIATED', // Illegal direct leap
          actor: 'AGENT',
        })
      ).toThrow(IllegalStateTransitionError);
    });

    it('allows legal Action -> Measurement transition', () => {
      const res = validateStateTransition({
        entityId: 'act_123',
        fromState: 'ACTION_COMPLETED',
        toState: 'MEASUREMENT_RECORDED',
        actor: 'SYSTEM',
      });

      expect(res.success).toBe(true);
      expect(res.fromStage).toBe('ACTION');
      expect(res.toStage).toBe('MEASUREMENT');
    });
  });

  // --------------------------------------------------------------------------
  // 6. Audit Logger Tests
  // --------------------------------------------------------------------------
  describe('6. Audit Logger Traceability (src/core/auditLogger.ts)', () => {
    it('creates well-structured audit records with timestamps and metadata', () => {
      const record = createAuditRecord({
        actor: 'SYSTEM',
        eventType: 'OPPORTUNITY_REJECTED',
        entityType: 'Opportunity',
        entityId: 'opp_demo_case_a_rejected',
        summary: 'Opportunity rejected: Projected margin 21.0% violates 25.0% floor',
        metadata: {
          projectedMargin: 21.0,
          marginFloor: 25.0,
        },
      });

      expect(record.actor).toBe('SYSTEM');
      expect(record.eventType).toBe('OPPORTUNITY_REJECTED');
      expect(record.summary).toContain('21.0% violates 25.0% floor');
      expect(record.detailsJson).toContain('"projectedMargin":21');
    });
  });
});
