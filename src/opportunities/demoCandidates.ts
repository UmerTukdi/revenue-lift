// ==============================================================================
// Revenue Lift — Standard Synthetic Demo Opportunities
// ==============================================================================
// Strictly marked as SYNTHETIC DEMO / TEST SCENARIO.
// Demonstrates all 3 required architectural cases:
// Case A: High-value opportunity REJECTED due to hard margin & discount constraints.
// Case B: Valid opportunity that WINS due to highest Expected Net Value among eligible candidates.
// Case C: Valid but lower-value opportunity that loses to the winner.
// ==============================================================================

import { OpportunityCandidate } from '../core/evaluator';

export const DEMO_OPPORTUNITY_CANDIDATES: OpportunityCandidate[] = [
  // ----------------------------------------------------------------------------
  // Case A: Aggressive Discount Clearance (The Constraint Violator)
  // Highest nominal value (₹67,800), BUT violates 25% margin floor & 10% discount cap.
  // Must be REJECTED and MUST NOT win.
  // ----------------------------------------------------------------------------
  {
    id: 'opp_demo_case_a_rejected',
    type: 'TARGETED_DISCOUNT',
    title: 'Aggressive 15% Clearance Campaign [SYNTHETIC DEMO]',
    description:
      'Mass 15% discount campaign targeted to price-sensitive segment to liquidate inventory.',
    targetSegment: 'PRICE_SENSITIVE',
    scoringInputs: {
      eligibleCustomers: 500,
      acceptanceProbability: 0.2, // 20%
      incrementalRevenuePerCustomer: 800, // ₹800/cust
      incentiveCostPerCustomer: 122, // ₹122 discount/cust
    },
    projectedMarginPct: 21.0, // ⚠️ VIOLATION: Below 25% margin floor!
    projectedDiscountPct: 15.0, // ⚠️ VIOLATION: Exceeds 10% discount cap!
    projectedInventoryRemaining: 25,
    daysSinceLastContact: 45,
    isSynthetic: true,
  },

  // ----------------------------------------------------------------------------
  // Case B: Customer Win-Back Campaign (The Legitimate Winner)
  // Expected Net Value ₹54,208. Satisfies all hard constraints.
  // Must be chosen as the RECOMMENDED WINNER.
  // ----------------------------------------------------------------------------
  {
    id: 'opp_demo_case_b_winner',
    type: 'WINBACK_CAMPAIGN',
    title: 'Dormant Customer Win-Back [SYNTHETIC DEMO]',
    description:
      'Targeted win-back for 350 dormant customers with a controlled 8% loyalty incentive.',
    targetSegment: 'DORMANT_HIGH_LTV',
    scoringInputs: {
      eligibleCustomers: 350,
      acceptanceProbability: 0.22, // 22%
      incrementalRevenuePerCustomer: 780, // ₹780/cust
      incentiveCostPerCustomer: 76, // ₹76 incentive/cust
    },
    projectedMarginPct: 28.5, // ✅ Complies: >= 25% margin floor
    projectedDiscountPct: 8.0, // ✅ Complies: <= 10% discount cap
    projectedInventoryRemaining: 40, // ✅ Complies: >= 15 units
    daysSinceLastContact: 75, // ✅ Complies: >= 14 days dedupe window
    isSynthetic: true,
  },

  // ----------------------------------------------------------------------------
  // Case C: Failed Payment Recovery (Eligible, but lower net value)
  // Expected Net Value ₹31,405.50. Complies with all constraints, ranks #2.
  // ----------------------------------------------------------------------------
  {
    id: 'opp_demo_case_c_runner_up',
    type: 'FAILED_PAYMENT_RECOVERY',
    title: 'Smart Payment Link Recovery [SYNTHETIC DEMO]',
    description:
      'Re-engage 45 customers with recent failed transactions using 24-hr Razorpay Smart Payment Links.',
    targetSegment: 'FAILED_CHECKOUT',
    scoringInputs: {
      eligibleCustomers: 45,
      acceptanceProbability: 0.35, // 35%
      incrementalRevenuePerCustomer: 2000, // ₹2,000 average order
      incentiveCostPerCustomer: 6, // ₹6 communication/link fee (zero discount)
    },
    projectedMarginPct: 35.0, // ✅ Complies: >= 25% margin floor
    projectedDiscountPct: 0.0, // ✅ Complies: <= 10% discount cap
    projectedInventoryRemaining: 28, // ✅ Complies: >= 15 units
    daysSinceLastContact: undefined, // Never contacted before; complies with dedupe window
    isSynthetic: true,
  },
];
