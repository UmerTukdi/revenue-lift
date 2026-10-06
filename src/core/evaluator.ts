// ==============================================================================
// Revenue Lift — Opportunity Evaluation & Ranking Engine
// ==============================================================================
// Deterministic Pipeline:
// 1. Calculate Expected Net Value using locked integer-paise formula.
// 2. Evaluate each candidate against configured hard constraints.
// 3. Filter into Eligible and Rejected pools.
// 4. Rank ONLY Eligible candidates by Expected Net Value descending.
// 5. Select the winner strictly from Eligible candidates.
// 6. Guarantee: Disqualified candidates CAN NEVER WIN regardless of value.
// ==============================================================================

import { calculateExpectedNetValue, ScoringInputs, ScoringResult } from './scoring';
import { evaluateHardConstraints, HardConstraintRule, ConstraintEvaluationSummary } from './constraints';
import { OpportunityType, OpportunityStatus } from './types';

export interface OpportunityCandidate {
  id: string;
  type: OpportunityType;
  title: string;
  description: string;
  targetSegment: string;
  scoringInputs: ScoringInputs;
  projectedMarginPct: number;
  projectedDiscountPct: number;
  projectedInventoryRemaining: number;
  daysSinceLastContact?: number;
  restrictedSegments?: string[];
  isSynthetic?: boolean;
}

export interface EvaluatedOpportunity {
  id: string;
  type: OpportunityType;
  title: string;
  description: string;
  targetSegment: string;
  status: OpportunityStatus;
  scoring: ScoringResult;
  projectedMarginPct: number;
  projectedDiscountPct: number;
  projectedInventoryRemaining: number;
  constraintEvaluation: ConstraintEvaluationSummary;
  isEligible: boolean;
  rejectionReasons: string[];
  rank?: number;
  isWinner: boolean;
  explanation: string;
}

export interface OpportunityEvaluationReport {
  goalId?: string;
  evaluatedAt: Date;
  totalCandidates: number;
  eligibleCount: number;
  rejectedCount: number;
  winner: EvaluatedOpportunity | null;
  eligibleOpportunities: EvaluatedOpportunity[];
  rejectedOpportunities: EvaluatedOpportunity[];
  allOpportunities: EvaluatedOpportunity[];
}

/**
 * Deterministically evaluates an array of candidate opportunities against hard constraints
 * and ranks eligible opportunities by Expected Net Value.
 */
export function evaluateOpportunities(
  candidates: OpportunityCandidate[],
  constraints: HardConstraintRule[],
  goalId?: string
): OpportunityEvaluationReport {
  const allEvaluated: EvaluatedOpportunity[] = [];

  for (const candidate of candidates) {
    // Step 1: Deterministic financial scoring
    const scoring = calculateExpectedNetValue(candidate.scoringInputs);

    // Step 2: Hard constraint filter evaluation
    const constraintEval = evaluateHardConstraints(
      {
        projectedMarginPct: candidate.projectedMarginPct,
        projectedDiscountPct: candidate.projectedDiscountPct,
        projectedInventoryRemaining: candidate.projectedInventoryRemaining,
        targetSegment: candidate.targetSegment,
        daysSinceLastContact: candidate.daysSinceLastContact,
        restrictedSegments: candidate.restrictedSegments,
      },
      constraints
    );

    const isEligible = constraintEval.isEligible;
    const status: OpportunityStatus = isEligible ? 'ELIGIBLE' : 'REJECTED';

    allEvaluated.push({
      id: candidate.id,
      type: candidate.type,
      title: candidate.title,
      description: candidate.description,
      targetSegment: candidate.targetSegment,
      status,
      scoring,
      projectedMarginPct: candidate.projectedMarginPct,
      projectedDiscountPct: candidate.projectedDiscountPct,
      projectedInventoryRemaining: candidate.projectedInventoryRemaining,
      constraintEvaluation: constraintEval,
      isEligible,
      rejectionReasons: constraintEval.rejectionReasons,
      isWinner: false,
      explanation: isEligible
        ? `Satisfies all ${constraintEval.passedCount} active business constraints. Expected Net Value: ₹${scoring.expectedNetValue.toLocaleString('en-IN')}.`
        : `Disqualified: Violates ${constraintEval.failedCount} hard constraint(s). Reasons: ${constraintEval.rejectionReasons.join('; ')}`,
    });
  }

  // Step 3: Separate Eligible vs Rejected
  const eligibleOpportunities = allEvaluated.filter((o) => o.isEligible);
  const rejectedOpportunities = allEvaluated.filter((o) => !o.isEligible);

  // Step 4: Sort ONLY eligible opportunities by Expected Net Value descending
  eligibleOpportunities.sort((a, b) => {
    // Compare in integer paise to avoid any rounding discrepancy
    return b.scoring.expectedNetValuePaise - a.scoring.expectedNetValuePaise;
  });

  // Assign ranks to eligible opportunities
  eligibleOpportunities.forEach((opp, index) => {
    opp.rank = index + 1;
  });

  // Step 5: Pick the winner strictly from the ranked eligible pool
  let winner: EvaluatedOpportunity | null = null;
  if (eligibleOpportunities.length > 0) {
    winner = eligibleOpportunities[0];
    winner.isWinner = true;
    winner.explanation = `RECOMMENDED WINNER: Highest Expected Net Value (₹${winner.scoring.expectedNetValue.toLocaleString(
      'en-IN'
    )}) among all eligible strategies satisfying your business constraints.`;
  }

  return {
    goalId,
    evaluatedAt: new Date(),
    totalCandidates: allEvaluated.length,
    eligibleCount: eligibleOpportunities.length,
    rejectedCount: rejectedOpportunities.length,
    winner,
    eligibleOpportunities,
    rejectedOpportunities,
    allOpportunities: allEvaluated,
  };
}
