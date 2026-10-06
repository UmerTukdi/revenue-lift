// ==============================================================================
// Revenue Lift — Agent Orchestrator
// ==============================================================================
// Orchestrates the core agent loop:
// 1. Parse natural language merchant message.
// 2. Validate structured goal parameters.
// 3. Lock goal and hard constraints in backend.
// 4. Invoke deterministic evaluator.
// 5. Generate transparent explanation grounded in engine numbers.
// 6. Enforce merchant approval gate.
// ==============================================================================

import { getAIProvider } from './provider';
import { AgentResponse, ParsedGoal } from './types';
import { setMerchantGoal, discoverAndEvaluateOpportunities, explainDecision, getAuditTrail } from './tools';
import prisma from '@/lib/db';

export interface OrchestratorInput {
  message: string;
  merchantId?: string;
  goalId?: string;
}

/**
 * Runs the full agent decision-making loop.
 * Purely orchestrates tools and deterministic engines.
 */
export async function runAgentCycle(input: OrchestratorInput): Promise<AgentResponse> {
  const { message, merchantId } = input;
  const provider = getAIProvider();

  // Step 1: Parse natural-language instruction
  let parsedGoal: ParsedGoal;
  try {
    parsedGoal = await provider.parseGoal(message);
  } catch (error) {
    console.warn('Parser failed, falling back to safe default:', error);
    parsedGoal = {
      isValid: false,
      clarificationQuestion:
        'Could you please clarify your growth goal? (e.g., "I want ₹50,000 additional revenue with 25% margin floor and 10% discount cap.")',
    };
  }

  // Step 2: Handle missing critical goal information
  if (!parsedGoal.isValid || !parsedGoal.targetRevenue) {
    return {
      message:
        parsedGoal.clarificationQuestion ||
        'Please state your target revenue so I can identify eligible growth opportunities for you.',
      goal: parsedGoal,
      opportunities: [],
      winner: null,
      rejectedOpportunities: [],
      nextAction: 'Provide numeric incremental revenue target.',
      requiresApproval: false,
      lifecycleState: 'CANDIDATE_DISCOVERED',
    };
  }

  // Step 3: Lock Goal and Hard Constraints via backend tool
  // Determine if there is already an ACTIVE goal for this merchant
  let goalResult: any;
  const existingActiveGoal = await prisma.goal.findFirst({
    where: { merchantId: merchantId ?? undefined, status: 'ACTIVE' },
    include: { constraints: true },
  });
  if (existingActiveGoal) {
    // Reuse the existing goal without deactivating it
    goalResult = {
      goalId: existingActiveGoal.id,
      merchantId: existingActiveGoal.merchantId,
      constraints: existingActiveGoal.constraints.map((c: any) => ({
        type: c.type as any,
        operator: c.operator as any,
        thresholdValue: c.thresholdValue,
        unit: c.unit as any,
        isHard: c.isHard,
      })),
    };
  } else {
    // No active goal, create a new one
    goalResult = await setMerchantGoal({
      merchantId,
      targetRevenue: parsedGoal.targetRevenue,
      timeframeDays: parsedGoal.timeframeDays,
      marginFloorPct: parsedGoal.marginFloorPct,
      discountCapPct: parsedGoal.discountCapPct,
      inventoryMinimum: parsedGoal.inventoryMinimum,
      duplicateWindowDays: parsedGoal.duplicateWindowDays,
    });
  }

  // Step 4: Run Authoritative Deterministic Opportunity Evaluation
  const report = await discoverAndEvaluateOpportunities({
    goalId: goalResult.goalId,
    merchantId: goalResult.merchantId,
    customConstraints: goalResult.constraints,
  });

  // Step 5: Synthesize transparent explanation strictly grounded in deterministic numbers
  const explanation = await explainDecision(report, parsedGoal, goalResult.constraints);

  // Step 6: Pull live audit trail
  const auditEvents = await getAuditTrail(goalResult.merchantId, 6);

  // Step 7: Return strictly typed response contract with explicit approval requirement
  // Fetch the persisted CampaignAction for the winner if any
  let recommendedAction = undefined;
  if (report.winner) {
    const action = await prisma.campaignAction.findFirst({
      where: { opportunityId: report.winner.id },
      select: { id: true, status: true, opportunityId: true },
    });
    if (action) {
      recommendedAction = { id: action.id, status: action.status, opportunityId: action.opportunityId };
    }
  }

  return {
    message: explanation,
    goal: parsedGoal,
    constraints: goalResult.constraints,
    opportunities: report.allOpportunities,
    winner: report.winner,
    rejectedOpportunities: report.rejectedOpportunities,
    nextAction: report.winner
      ? `Review the recommended '${report.winner.title}' action and authorize execution.`
      : 'No opportunities met your business constraints. Review or relax constraint thresholds.',
    requiresApproval: report.winner !== null,
    lifecycleState: 'DECISION_AWAITING_APPROVAL',
    auditEvents,
    recommendedAction,
  };
}
