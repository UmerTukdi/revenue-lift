// ==============================================================================
// Revenue Lift — Deterministic Hard Constraint System
// ==============================================================================
// Hard constraints are non-negotiable filters, NOT soft weights or ML scores.
// If ANY hard constraint fails:
// 1. The opportunity is marked REJECTED.
// 2. It is strictly excluded from winning recommendations.
// 3. Human-readable rejection reasons are preserved for transparency.
// A higher Expected Net Value CANNOT compensate for a failed constraint.
// ==============================================================================

import { ConstraintType } from './types';

export interface ConstraintCheckResult {
  passed: boolean;
  type: ConstraintType;
  code: string;
  reason: string;
  actualValue: number | string;
  requiredThreshold: number | string;
}

export interface HardConstraintRule {
  type: ConstraintType;
  operator: 'GTE' | 'LTE' | 'EQ';
  thresholdValue: number;
  unit: 'PERCENT' | 'CURRENCY' | 'UNITS' | 'DAYS';
  isHard?: boolean;
}

export interface OpportunityConstraintInputs {
  /** Projected post-campaign net margin % (e.g., 22.0) */
  projectedMarginPct: number;
  /** Projected promotional discount % (e.g., 15.0) */
  projectedDiscountPct: number;
  /** Estimated inventory remaining or available units after action (e.g., 8) */
  projectedInventoryRemaining: number;
  /** Target segment code (e.g., 'DORMANT_HIGH_LTV') */
  targetSegment: string;
  /** Days elapsed since last equivalent campaign targeted to this segment/group (e.g., 5 days) */
  daysSinceLastContact?: number;
  /** Explicit list of restricted or disallowed segments (optional) */
  restrictedSegments?: string[];
}

export interface ConstraintEvaluationSummary {
  isEligible: boolean;
  passedCount: number;
  failedCount: number;
  checks: ConstraintCheckResult[];
  rejectionReasons: string[];
}

/**
 * Evaluates an opportunity against a configured list of hard constraints.
 * Pure deterministic filter: If any rule fails, isEligible is FALSE.
 */
export function evaluateHardConstraints(
  inputs: OpportunityConstraintInputs,
  rules: HardConstraintRule[]
): ConstraintEvaluationSummary {
  const checks: ConstraintCheckResult[] = [];
  const rejectionReasons: string[] = [];

  for (const rule of rules) {
    // Only enforce active hard constraints
    if (rule.isHard === false) continue;

    switch (rule.type) {
      case 'MARGIN_FLOOR': {
        const minMargin = rule.thresholdValue;
        const actual = inputs.projectedMarginPct;
        const passed = actual >= minMargin;

        const check: ConstraintCheckResult = {
          passed,
          type: 'MARGIN_FLOOR',
          code: 'MARGIN_BELOW_FLOOR',
          actualValue: `${actual.toFixed(1)}%`,
          requiredThreshold: `>= ${minMargin.toFixed(1)}%`,
          reason: passed
            ? `Projected margin of ${actual.toFixed(1)}% satisfies floor of ${minMargin.toFixed(1)}%`
            : `Projected margin of ${actual.toFixed(1)}% violates minimum margin floor of ${minMargin.toFixed(1)}%`,
        };

        checks.push(check);
        if (!passed) rejectionReasons.push(check.reason);
        break;
      }

      case 'DISCOUNT_CAP': {
        const maxDiscount = rule.thresholdValue;
        const actual = inputs.projectedDiscountPct;
        const passed = actual <= maxDiscount;

        const check: ConstraintCheckResult = {
          passed,
          type: 'DISCOUNT_CAP',
          code: 'DISCOUNT_EXCEEDS_CAP',
          actualValue: `${actual.toFixed(1)}%`,
          requiredThreshold: `<= ${maxDiscount.toFixed(1)}%`,
          reason: passed
            ? `Promotional discount of ${actual.toFixed(1)}% is within allowed cap of ${maxDiscount.toFixed(1)}%`
            : `Promotional discount of ${actual.toFixed(1)}% exceeds maximum cap of ${maxDiscount.toFixed(1)}%`,
        };

        checks.push(check);
        if (!passed) rejectionReasons.push(check.reason);
        break;
      }

      case 'INVENTORY_MIN': {
        const minInventory = rule.thresholdValue;
        const actual = inputs.projectedInventoryRemaining;
        const passed = actual >= minInventory;

        const check: ConstraintCheckResult = {
          passed,
          type: 'INVENTORY_MIN',
          code: 'INVENTORY_DEPLETED',
          actualValue: `${actual} units`,
          requiredThreshold: `>= ${minInventory} units`,
          reason: passed
            ? `Post-campaign inventory of ${actual} units satisfies buffer threshold of ${minInventory} units`
            : `Post-campaign inventory of ${actual} units falls below minimum safe threshold of ${minInventory} units`,
        };

        checks.push(check);
        if (!passed) rejectionReasons.push(check.reason);
        break;
      }

      case 'DUPLICATE_WINDOW_DAYS': {
        const minDays = rule.thresholdValue;
        const actual = inputs.daysSinceLastContact;

        // If never contacted, actual is undefined -> passes
        const passed = actual === undefined || actual >= minDays;

        const check: ConstraintCheckResult = {
          passed,
          type: 'DUPLICATE_WINDOW_DAYS',
          code: 'DUPLICATE_ACTION_RESTRICTED',
          actualValue: actual === undefined ? 'Never contacted' : `${actual} days ago`,
          requiredThreshold: `>= ${minDays} days interval`,
          reason: passed
            ? `Customer outreach interval complies with the ${minDays}-day contact frequency protection`
            : `Audience was already contacted ${actual} days ago, violating the ${minDays}-day dedupe protection window`,
        };

        checks.push(check);
        if (!passed) rejectionReasons.push(check.reason);
        break;
      }

      case 'SEGMENT_FILTER': {
        const isRestricted = inputs.restrictedSegments?.includes(inputs.targetSegment) ?? false;
        const passed = !isRestricted;

        const check: ConstraintCheckResult = {
          passed,
          type: 'SEGMENT_FILTER',
          code: 'SEGMENT_DISALLOWED',
          actualValue: inputs.targetSegment,
          requiredThreshold: 'Eligible customer segment',
          reason: passed
            ? `Target segment '${inputs.targetSegment}' is eligible for targeted growth campaigns`
            : `Target segment '${inputs.targetSegment}' is restricted from receiving automated incentives`,
        };

        checks.push(check);
        if (!passed) rejectionReasons.push(check.reason);
        break;
      }
    }
  }

  const failedCount = checks.filter((c) => !c.passed).length;
  const passedCount = checks.length - failedCount;
  const isEligible = failedCount === 0;

  return {
    isEligible,
    passedCount,
    failedCount,
    checks,
    rejectionReasons,
  };
}
