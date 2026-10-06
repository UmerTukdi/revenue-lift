// ==============================================================================
// Revenue Lift — Agent Tools Implementation
// ==============================================================================
// All financial tools invoke the deterministic backend engine.
// The LLM is prohibited from performing financial calculations or bypassing constraints.
// ==============================================================================

import prisma from '../lib/db';
import { HardConstraintRule } from '../core/constraints';
import { evaluateOpportunities, OpportunityEvaluationReport, OpportunityCandidate } from '../core/evaluator';
import { logAuditEvent, StructuredAuditRecord } from '../core/auditLogger';
import { DEMO_OPPORTUNITY_CANDIDATES } from '../opportunities/demoCandidates';
import { getAIProvider } from './provider';
import { ParsedGoal } from './types';
import { IllegalStateTransitionError } from '../core/errors';

export interface SetGoalParams {
  merchantId?: string;
  targetRevenue: number;
  timeframeDays?: number;
  marginFloorPct?: number;
  discountCapPct?: number;
  inventoryMinimum?: number;
  duplicateWindowDays?: number;
}

export interface SetGoalResult {
  goalId: string;
  merchantId: string;
  targetRevenue: number;
  timeframeDays: number;
  constraints: HardConstraintRule[];
  auditRecords: StructuredAuditRecord[];
}

/**
 * Tool 1: setMerchantGoal (Fully Implemented)
 * Locks the merchant's target revenue and hard constraint boundaries.
 */
export async function setMerchantGoal(params: SetGoalParams): Promise<SetGoalResult> {
  const {
    targetRevenue,
    timeframeDays = 30,
    marginFloorPct = 25.0,
    discountCapPct = 10.0,
    inventoryMinimum = 15,
    duplicateWindowDays = 14,
  } = params;

  if (targetRevenue <= 0) {
    throw new Error(`Target revenue must be a positive number. Received: ${targetRevenue}`);
  }

  // Find or use default merchant
  let merchant = params.merchantId
    ? await prisma.merchant.findUnique({ where: { id: params.merchantId } })
    : await prisma.merchant.findFirst();

  if (!merchant) {
    merchant = await prisma.merchant.create({
      data: {
        name: 'ShopNova Electronics [DEMO]',
        email: 'admin@shopnova.demo',
        isSynthetic: true,
      },
    });
  }

  // Deactivate any previous goals for this merchant
  await prisma.goal.updateMany({
    where: { merchantId: merchant.id, status: 'ACTIVE' },
    data: { status: 'CANCELLED' },
  });

  // Construct constraint rules
  const constraintRules: HardConstraintRule[] = [
    { type: 'MARGIN_FLOOR', operator: 'GTE', thresholdValue: marginFloorPct, unit: 'PERCENT', isHard: true },
    { type: 'DISCOUNT_CAP', operator: 'LTE', thresholdValue: discountCapPct, unit: 'PERCENT', isHard: true },
    { type: 'INVENTORY_MIN', operator: 'GTE', thresholdValue: inventoryMinimum, unit: 'UNITS', isHard: true },
    { type: 'DUPLICATE_WINDOW_DAYS', operator: 'GTE', thresholdValue: duplicateWindowDays, unit: 'DAYS', isHard: true },
  ];

  // Persist Goal & Constraints to SQLite
  const goal = await prisma.goal.create({
    data: {
      merchantId: merchant.id,
      targetRevenue,
      timeframeDays,
      status: 'ACTIVE',
      constraints: {
        create: constraintRules.map((c) => ({
          type: c.type,
          operator: c.operator,
          thresholdValue: c.thresholdValue,
          unit: c.unit,
          isHard: true,
        })),
      },
    },
    include: { constraints: true },
  });

  // Audit Events
  const audit1 = await logAuditEvent({
    merchantId: merchant.id,
    actor: 'MERCHANT',
    eventType: 'GOAL_CREATED',
    entityType: 'Goal',
    entityId: goal.id,
    summary: `Merchant configured growth objective: ₹${targetRevenue.toLocaleString('en-IN')} additional revenue over ${timeframeDays} days.`,
    metadata: { targetRevenue, timeframeDays },
  });

  const audit2 = await logAuditEvent({
    merchantId: merchant.id,
    actor: 'SYSTEM',
    eventType: 'CONSTRAINTS_LOCKED',
    entityType: 'Goal',
    entityId: goal.id,
    summary: `Hard constraints locked: Margin >= ${marginFloorPct}%, Discount <= ${discountCapPct}%, Inventory >= ${inventoryMinimum} units, Dedupe >= ${duplicateWindowDays} days.`,
    metadata: { marginFloorPct, discountCapPct, inventoryMinimum, duplicateWindowDays },
  });

  return {
    goalId: goal.id,
    merchantId: merchant.id,
    targetRevenue,
    timeframeDays,
    constraints: constraintRules,
    auditRecords: [audit1, audit2],
  };
}

/**
 * Tool 2: discoverAndEvaluateOpportunities (Fully Implemented)
 * Discovers candidate strategies, calculates deterministic Expected Net Value,
 * applies hard constraint filters, and ranks eligible opportunities.
 */
export async function discoverAndEvaluateOpportunities(params: {
  goalId?: string;
  merchantId?: string;
  customCandidates?: OpportunityCandidate[];
  customConstraints?: HardConstraintRule[];
}): Promise<OpportunityEvaluationReport> {
  let constraintRules = params.customConstraints;

  // If constraints not provided, retrieve from DB
  if (!constraintRules && params.goalId) {
    const goal = await prisma.goal.findUnique({
      where: { id: params.goalId },
      include: { constraints: true },
    });
    if (goal && goal.constraints.length > 0) {
      constraintRules = goal.constraints.map((c) => ({
        type: c.type as any,
        operator: c.operator as any,
        thresholdValue: c.thresholdValue,
        unit: c.unit as any,
        isHard: c.isHard,
      }));
    }
  }

  // Default constraints fallback
  if (!constraintRules || constraintRules.length === 0) {
    constraintRules = [
      { type: 'MARGIN_FLOOR', operator: 'GTE', thresholdValue: 25.0, unit: 'PERCENT', isHard: true },
      { type: 'DISCOUNT_CAP', operator: 'LTE', thresholdValue: 10.0, unit: 'PERCENT', isHard: true },
      { type: 'INVENTORY_MIN', operator: 'GTE', thresholdValue: 15.0, unit: 'UNITS', isHard: true },
      { type: 'DUPLICATE_WINDOW_DAYS', operator: 'GTE', thresholdValue: 14.0, unit: 'DAYS', isHard: true },
    ];
  }

  const candidates = params.customCandidates || DEMO_OPPORTUNITY_CANDIDATES;

  // Run authoritative deterministic evaluation pipeline
  const report = evaluateOpportunities(candidates, constraintRules, params.goalId);

  // If goalId is present, persist evaluation records and winner's Decision record
  if (params.goalId) {
    for (const opp of report.allOpportunities) {
      const persistedOpp = await prisma.opportunity.upsert({
        where: { id: opp.id },
        update: {
          expectedNetValue: opp.scoring.expectedNetValue,
          status: opp.status,
          rejectionReasons: opp.rejectionReasons.length > 0 ? JSON.stringify(opp.rejectionReasons) : null,
          isRecommended: opp.isWinner,
          recommendationReason: opp.explanation,
        },
        create: {
          id: opp.id,
          goalId: params.goalId,
          type: opp.type,
          title: opp.title,
          description: opp.description,
          targetSegment: opp.targetSegment,
          eligibleCustomers: opp.scoring.eligibleCustomers,
          acceptanceProbability: opp.scoring.acceptanceProbability,
          incrementalRevenuePerCustomer: opp.scoring.incrementalRevenuePerCustomer,
          incentiveCostPerCustomer: opp.scoring.incentiveCostPerCustomer,
          expectedNetValue: opp.scoring.expectedNetValue,
          projectedMarginPct: opp.projectedMarginPct,
          projectedDiscountPct: opp.projectedDiscountPct,
          inventoryImpact: opp.projectedInventoryRemaining,
          status: opp.status,
          rejectionReasons: opp.rejectionReasons.length > 0 ? JSON.stringify(opp.rejectionReasons) : null,
          isRecommended: opp.isWinner,
          recommendationReason: opp.explanation,
        },
      });

      // If recommended winner, idempotently create or update CampaignAction in PENDING_APPROVAL
      if (opp.isWinner) {
        const existingAction = await prisma.campaignAction.findFirst({
          where: { opportunityId: persistedOpp.id },
        });

        if (existingAction) {
          if (existingAction.status === 'PENDING_APPROVAL' || existingAction.status === 'DRAFT') {
            await prisma.campaignAction.update({
              where: { id: existingAction.id },
              data: { decisionRationale: opp.explanation },
            });
          }
        } else {
          await prisma.campaignAction.create({
            data: {
              opportunityId: persistedOpp.id,
              status: 'PENDING_APPROVAL',
              decisionRationale: opp.explanation,
            },
          });

          await logAuditEvent({
            merchantId: params.merchantId,
            actor: 'AGENT',
            eventType: 'ACTION_RECOMMENDED',
            entityType: 'Opportunity',
            entityId: persistedOpp.id,
            summary: `Agent recommended '${opp.title}' (Expected Net Value: ₹${opp.scoring.expectedNetValue.toLocaleString(
              'en-IN'
            )}). Consequential execution strictly blocked pending merchant authorization.`,
          });
        }
      }
    }
  }

  return report;
}

/**
 * Tool 3: explainDecision (Fully Implemented)
 * Synthesizes a transparent natural-language explanation strictly grounded in deterministic numbers.
 */
export async function explainDecision(
  report: OpportunityEvaluationReport,
  goal: ParsedGoal,
  constraints: HardConstraintRule[]
): Promise<string> {
  const provider = getAIProvider();

  return provider.generateExplanation({
    targetRevenue: goal.targetRevenue || 50000,
    timeframeDays: goal.timeframeDays || 30,
    winner: report.winner,
    eligible: report.eligibleOpportunities,
    rejected: report.rejectedOpportunities,
    constraints,
  });
}

/**
 * Tool 4: getAuditTrail (Fully Implemented)
 * Retrieves recent immutable audit logs for total operational transparency.
 */
export async function getAuditTrail(merchantId?: string, limit = 10): Promise<StructuredAuditRecord[]> {
  try {
    const events = await prisma.auditEvent.findMany({
      where: merchantId ? { merchantId } : undefined,
      take: limit,
      orderBy: { timestamp: 'desc' },
    });
    return events.map((e) => ({
      id: e.id,
      merchantId: e.merchantId || undefined,
      timestamp: e.timestamp,
      actor: e.actor as any,
      eventType: e.eventType as any,
      entityType: e.entityType || undefined,
      entityId: e.entityId || undefined,
      summary: e.summary,
      detailsJson: e.detailsJson || undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Tool 5: requestMerchantApproval (Safe Interface / Stub)
 * Prepares the consequential action payload for the merchant approval modal.
 */
export async function requestMerchantApproval(actionId: string): Promise<{
  actionId: string;
  status: string;
  requiresMerchantClick: boolean;
  message: string;
}> {
  return {
    actionId,
    status: 'DECISION_AWAITING_APPROVAL',
    requiresMerchantClick: true,
    message: 'Consequential action prepared. Awaiting explicit merchant authorization.',
  };
}

/**
 * Tool 6: executeApprovedAction (Safe Stub / Guardrail)
 * Strictly blocks execution without verified merchant approval.
 */
export async function executeApprovedAction(actionId: string, isMerchantApproved: boolean): Promise<never> {
  if (!isMerchantApproved) {
    throw new IllegalStateTransitionError(
      'DECISION_AWAITING_APPROVAL',
      'ACTION_INITIATED',
      `${actionId} (Execution blocked: Merchant must click Approve before initiating any action)`
    );
  }
  throw new Error('Razorpay execution is reserved for Step 4.');
}

/**
 * Tool 7: fetchMeasurement (Safe Stub)
 */
export async function fetchMeasurement(actionId: string): Promise<{
  actionId: string;
  status: string;
  message: string;
}> {
  return {
    actionId,
    status: 'PENDING_EXECUTION',
    message: 'Measurement reconciliation will run after Step 4 execution.',
  };
}
