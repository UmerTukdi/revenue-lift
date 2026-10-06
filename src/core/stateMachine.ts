// ==============================================================================
// Revenue Lift — Locked Lifecycle State Machine
// ==============================================================================
// Locked Lifecycle:
// Candidate ──► Decision ──► Action ──► Measurement
//
// Rules:
// 1. A Candidate cannot skip directly to Action.
// 2. A Decision cannot transition to Action without EXPLICIT merchant approval.
// 3. Any invalid state jump throws IllegalStateTransitionError.
// ==============================================================================

import { IllegalStateTransitionError } from './errors';

export type LifecycleStage = 'CANDIDATE' | 'DECISION' | 'ACTION' | 'MEASUREMENT';

export type LifecycleState =
  | 'CANDIDATE_DISCOVERED'
  | 'CANDIDATE_EVALUATED'
  | 'DECISION_RECOMMENDED'
  | 'DECISION_AWAITING_APPROVAL'
  | 'DECISION_REJECTED_BY_MERCHANT'
  | 'ACTION_APPROVED'
  | 'ACTION_INITIATED'
  | 'ACTION_COMPLETED'
  | 'ACTION_FAILED'
  | 'MEASUREMENT_RECORDED';

export interface TransitionPayload {
  entityId: string;
  fromState: LifecycleState;
  toState: LifecycleState;
  isMerchantApproved?: boolean;
  actor: 'MERCHANT' | 'AGENT' | 'SYSTEM';
  rationale?: string;
}

/**
 * Valid state transitions mapping.
 */
const LEGAL_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  // 1. Candidate Stage
  CANDIDATE_DISCOVERED: ['CANDIDATE_EVALUATED'],
  CANDIDATE_EVALUATED: ['DECISION_RECOMMENDED'],

  // 2. Decision Stage
  DECISION_RECOMMENDED: ['DECISION_AWAITING_APPROVAL'],
  DECISION_AWAITING_APPROVAL: ['ACTION_APPROVED', 'DECISION_REJECTED_BY_MERCHANT'],
  DECISION_REJECTED_BY_MERCHANT: [], // Terminal for this opportunity

  // 3. Action Stage
  ACTION_APPROVED: ['ACTION_INITIATED'],
  ACTION_INITIATED: ['ACTION_COMPLETED', 'ACTION_FAILED'],
  ACTION_COMPLETED: ['MEASUREMENT_RECORDED'],
  ACTION_FAILED: ['ACTION_INITIATED'], // Retry path if retryable

  // 4. Measurement Stage
  MEASUREMENT_RECORDED: [], // Terminal for this lifecycle run
};

/**
 * Maps granular states to high-level lifecycle stages.
 */
export function getLifecycleStage(state: LifecycleState): LifecycleStage {
  if (state.startsWith('CANDIDATE_')) return 'CANDIDATE';
  if (state.startsWith('DECISION_')) return 'DECISION';
  if (state.startsWith('ACTION_')) return 'ACTION';
  if (state.startsWith('MEASUREMENT_')) return 'MEASUREMENT';
  throw new Error(`Unknown lifecycle state: ${state}`);
}

/**
 * Deterministically validates and executes a state machine transition.
 * Throws IllegalStateTransitionError if the requested transition is illegal
 * or if consequential execution is attempted without merchant approval.
 */
export function validateStateTransition(payload: TransitionPayload): {
  success: boolean;
  fromStage: LifecycleStage;
  toStage: LifecycleStage;
} {
  const { entityId, fromState, toState, isMerchantApproved, actor } = payload;

  const allowedNextStates = LEGAL_TRANSITIONS[fromState] || [];

  // Check 1: General legal transitions
  if (!allowedNextStates.includes(toState)) {
    throw new IllegalStateTransitionError(fromState, toState, entityId);
  }

  // Check 2: Consequential Action Gate — Decision -> Action REQUIRES Merchant Approval
  if (toState === 'ACTION_APPROVED') {
    if (!isMerchantApproved || actor !== 'MERCHANT') {
      throw new IllegalStateTransitionError(
        fromState,
        toState,
        `${entityId} (Consequential execution strictly requires explicit merchant approval)`
      );
    }
  }

  // Check 3: Candidate cannot jump directly to Action or Measurement
  const fromStage = getLifecycleStage(fromState);
  const toStage = getLifecycleStage(toState);

  if (fromStage === 'CANDIDATE' && (toStage === 'ACTION' || toStage === 'MEASUREMENT')) {
    throw new IllegalStateTransitionError(
      fromState,
      toState,
      `${entityId} (Cannot bypass Decision phase to execute Action)`
    );
  }

  return {
    success: true,
    fromStage,
    toStage,
  };
}
