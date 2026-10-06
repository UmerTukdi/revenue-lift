// ==============================================================================
// Revenue Lift — Duplicate Action Prevention (Dedupe Protection)
// ==============================================================================
// Protects customers from fatigue and prevents merchant over-discounting.
// If an equivalent campaign action has been approved or executed for this
// customer segment within the configured duplicate window:
// 1. The opportunity is marked ineligible.
// 2. An explicit rejection reason is returned.
// 3. The opportunity is barred from winning.
// ==============================================================================

import prisma from '../lib/db';
import { OpportunityType } from './types';

export interface DedupeCheckResult {
  isDuplicate: boolean;
  daysSinceLastAction?: number;
  duplicateWindowDays: number;
  lastActionDate?: Date;
  lastActionId?: string;
  rejectionReason?: string;
}

/**
 * Checks if an equivalent action was already approved or executed within the duplicate window.
 */
export async function checkDuplicateAction(params: {
  opportunityType: OpportunityType;
  targetSegment: string;
  duplicateWindowDays: number;
  merchantId?: string;
}): Promise<DedupeCheckResult> {
  const { opportunityType, targetSegment, duplicateWindowDays, merchantId } = params;

  const windowCutoffDate = new Date(Date.now() - duplicateWindowDays * 24 * 60 * 60 * 1000);

  try {
    // Look up recent actions for this segment & merchant
    const recentAction = await prisma.campaignAction.findFirst({
      where: {
        status: { in: ['APPROVED', 'INITIATED', 'COMPLETED'] },
        approvedAt: { gte: windowCutoffDate },
        opportunity: {
          targetSegment,
          ...(merchantId ? { goal: { merchantId } } : {}),
        },
      },
      include: {
        opportunity: true,
      },
      orderBy: {
        approvedAt: 'desc',
      },
    });

    if (recentAction && recentAction.approvedAt) {
      const elapsedMs = Date.now() - recentAction.approvedAt.getTime();
      const daysSinceLastAction = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));

      return {
        isDuplicate: true,
        daysSinceLastAction,
        duplicateWindowDays,
        lastActionDate: recentAction.approvedAt,
        lastActionId: recentAction.id,
        rejectionReason: `Audience segment '${targetSegment}' already received a '${recentAction.opportunity.title}' action ${daysSinceLastAction} days ago. Violates the ${duplicateWindowDays}-day contact frequency protection window.`,
      };
    }
  } catch (error) {
    console.warn('Dedupe database lookup warning:', error);
  }

  return {
    isDuplicate: false,
    duplicateWindowDays,
  };
}

/**
 * Pure helper for dedupe evaluation without database dependency (for unit tests).
 */
export function evaluateDedupeInterval(
  daysSinceLastContact: number | undefined,
  duplicateWindowDays: number,
  segmentName: string
): DedupeCheckResult {
  if (daysSinceLastContact === undefined) {
    return {
      isDuplicate: false,
      duplicateWindowDays,
    };
  }

  const isDuplicate = daysSinceLastContact < duplicateWindowDays;

  return {
    isDuplicate,
    daysSinceLastAction: daysSinceLastContact,
    duplicateWindowDays,
    rejectionReason: isDuplicate
      ? `Audience segment '${segmentName}' was contacted ${daysSinceLastContact} days ago, violating the ${duplicateWindowDays}-day dedupe window.`
      : undefined,
  };
}
