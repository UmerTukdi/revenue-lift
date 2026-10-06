// Core Domain Types for Revenue Lift

export type OpportunityType =
  | 'FAILED_PAYMENT_RECOVERY'
  | 'WINBACK_CAMPAIGN'
  | 'TARGETED_DISCOUNT'
  | 'CART_RECOVERY'
  | 'PRICE_DROP_CAMPAIGN'
  | 'REPEAT_PURCHASE'
  | 'INVENTORY_CLEARANCE'
  | 'DORMANT_WINBACK';

export type OpportunityStatus = 'CANDIDATE' | 'ELIGIBLE' | 'REJECTED';

export type ActionStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED_BY_MERCHANT'
  | 'INITIATED'
  | 'COMPLETED'
  | 'FAILED';

export type ConstraintType =
  | 'MARGIN_FLOOR'
  | 'DISCOUNT_CAP'
  | 'INVENTORY_MIN'
  | 'DUPLICATE_WINDOW_DAYS'
  | 'SEGMENT_FILTER';

export type AuditEventType =
  | 'GOAL_CREATED'
  | 'GOAL_UPDATED'
  | 'CONSTRAINTS_LOCKED'
  | 'OPPORTUNITY_DISCOVERED'
  | 'OPPORTUNITY_EVALUATED'
  | 'OPPORTUNITY_REJECTED'
  | 'ACTION_RECOMMENDED'
  | 'MERCHANT_APPROVED'
  | 'MERCHANT_DECLINED'
  | 'EXECUTION_INITIATED'
  | 'EXECUTION_SUCCESS'
  | 'EXECUTION_FAILED'
  | 'WEBHOOK_RECEIVED'
  | 'PAYMENT_SUCCEEDED'
  | 'PAYMENT_FAILED'
  | 'MEASUREMENT_RECORDED';

export interface ExpectedNetValueInputs {
  eligibleCustomers: number;       // N
  acceptanceProbability: number;   // P(accept) [0.0 - 1.0]
  incrementalRevenuePerCustomer: number; // R
  incentiveCostPerCustomer: number;      // C
}

export interface HardConstraintParams {
  marginFloorPct?: number;       // e.g. 25.0 (%)
  discountCapPct?: number;       // e.g. 10.0 (%)
  inventoryMin?: number;         // e.g. 20 (units)
  duplicateWindowDays?: number;  // e.g. 14 (days)
}

export interface OpportunityEvaluationResult {
  isEligible: boolean;
  expectedNetValue: number;
  projectedMarginPct: number;
  projectedDiscountPct: number;
  rejectionReasons: string[];
}
