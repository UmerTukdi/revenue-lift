// ==============================================================================
// Revenue Lift — Deterministic Financial Scoring Engine
// ==============================================================================
// Primary Opportunity Scoring Formula:
// Expected Net Value = Eligible Customers (N)
//                     × Acceptance Probability (P)
//                     × Incremental Revenue Per Accepted Customer (R)
//                     − Total Incentive Cost
// Where: Total Incentive Cost = N × P × Incentive Cost Per Accepted Customer (C)
//
// Equivalently: Expected Net Value = N × P × (R − C)
//
// All monetary arithmetic uses integer minor units (paise) to prevent
// floating-point precision issues. 1 INR = 100 paise.
// ==============================================================================

export interface ScoringInputs {
  /** Eligible customer count (N >= 0) */
  eligibleCustomers: number;
  /** Acceptance/conversion probability (0.0 <= P <= 1.0) */
  acceptanceProbability: number;
  /** Incremental gross revenue per converted customer in INR (R >= 0) */
  incrementalRevenuePerCustomer: number;
  /** Incentive/discount cost per converted customer in INR (C >= 0) */
  incentiveCostPerCustomer: number;
}

export interface ScoringResult {
  eligibleCustomers: number;
  acceptanceProbability: number;
  incrementalRevenuePerCustomer: number;
  incentiveCostPerCustomer: number;
  /** Expected conversions = N * P */
  expectedConversions: number;
  /** Total expected incremental gross revenue in INR */
  incrementalRevenue: number;
  /** Total expected incentive cost in INR */
  expectedIncentiveCost: number;
  /** Expected Net Value in INR (Revenue - Incentive Cost) */
  expectedNetValue: number;
  /** Expected Net Value in integer paise for audit precision */
  expectedNetValuePaise: number;
}

/**
 * Converts INR (major units) to Paise (integer minor units).
 */
export function inrToPaise(inr: number): number {
  return Math.round(inr * 100);
}

/**
 * Converts Paise (integer minor units) back to INR (major units).
 */
export function paiseToInr(paise: number): number {
  return paise / 100;
}

/**
 * Deterministically calculates Expected Net Value for an opportunity.
 * Pure function: Zero side-effects, zero LLM dependency, precision-locked.
 */
export function calculateExpectedNetValue(inputs: ScoringInputs): ScoringResult {
  const {
    eligibleCustomers,
    acceptanceProbability,
    incrementalRevenuePerCustomer,
    incentiveCostPerCustomer,
  } = inputs;

  // Validation
  if (eligibleCustomers < 0) {
    throw new Error(`Eligible customers count (N) must be non-negative. Received: ${eligibleCustomers}`);
  }
  if (acceptanceProbability < 0 || acceptanceProbability > 1) {
    throw new Error(
      `Acceptance probability (P) must be between 0.0 and 1.0. Received: ${acceptanceProbability}`
    );
  }
  if (incrementalRevenuePerCustomer < 0) {
    throw new Error(
      `Incremental revenue per customer (R) must be non-negative. Received: ${incrementalRevenuePerCustomer}`
    );
  }
  if (incentiveCostPerCustomer < 0) {
    throw new Error(
      `Incentive cost per customer (C) must be non-negative. Received: ${incentiveCostPerCustomer}`
    );
  }

  // Edge cases: No customers or zero probability
  if (eligibleCustomers === 0 || acceptanceProbability === 0) {
    return {
      eligibleCustomers,
      acceptanceProbability,
      incrementalRevenuePerCustomer,
      incentiveCostPerCustomer,
      expectedConversions: 0,
      incrementalRevenue: 0,
      expectedIncentiveCost: 0,
      expectedNetValue: 0,
      expectedNetValuePaise: 0,
    };
  }

  // Conversion count: N * P
  const expectedConversions = eligibleCustomers * acceptanceProbability;

  // Convert unit amounts to paise (integer minor units)
  const revPerCustomerPaise = inrToPaise(incrementalRevenuePerCustomer);
  const costPerCustomerPaise = inrToPaise(incentiveCostPerCustomer);

  // Total gross revenue in paise
  const incrementalRevenuePaise = Math.round(expectedConversions * revPerCustomerPaise);

  // Total incentive cost in paise
  const expectedIncentiveCostPaise = Math.round(expectedConversions * costPerCustomerPaise);

  // Expected Net Value = Revenue - Incentive Cost
  const expectedNetValuePaise = incrementalRevenuePaise - expectedIncentiveCostPaise;

  return {
    eligibleCustomers,
    acceptanceProbability,
    incrementalRevenuePerCustomer,
    incentiveCostPerCustomer,
    expectedConversions: Number(expectedConversions.toFixed(2)),
    incrementalRevenue: paiseToInr(incrementalRevenuePaise),
    expectedIncentiveCost: paiseToInr(expectedIncentiveCostPaise),
    expectedNetValue: paiseToInr(expectedNetValuePaise),
    expectedNetValuePaise,
  };
}
