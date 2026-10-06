// ==============================================================================
// Revenue Lift — Deterministic Audit Logger
// ==============================================================================
// Provides an immutable, structured trace of all growth decisions, constraint
// checks, merchant approvals, state transitions, and execution outcomes.
//
// RULE: The audit log is strictly for governance, debugging, and explainability.
// It is NEVER the source of truth for financial calculations.
// ==============================================================================

import prisma from '../lib/db';
import { AuditEventType } from './types';

export interface AuditLogParams {
  merchantId?: string;
  eventType: AuditEventType;
  actor: 'MERCHANT' | 'AGENT' | 'SYSTEM';
  entityType?: 'Goal' | 'Opportunity' | 'CampaignAction' | 'Execution' | 'Measurement';
  entityId?: string;
  summary: string;
  previousState?: string;
  newState?: string;
  metadata?: Record<string, unknown>;
  timestamp?: Date;
}

export interface StructuredAuditRecord {
  id?: string;
  merchantId?: string;
  timestamp: Date;
  actor: 'MERCHANT' | 'AGENT' | 'SYSTEM';
  eventType: AuditEventType;
  entityType?: string;
  entityId?: string;
  summary: string;
  detailsJson?: string;
}

/**
 * Creates a structured audit log entry in memory and persists it to SQLite if available.
 */
export async function logAuditEvent(params: AuditLogParams): Promise<StructuredAuditRecord> {
  const timestamp = params.timestamp || new Date();

  const detailsPayload = {
    previousState: params.previousState,
    newState: params.newState,
    ...(params.metadata || {}),
  };

  const record: StructuredAuditRecord = {
    merchantId: params.merchantId,
    timestamp,
    actor: params.actor,
    eventType: params.eventType,
    entityType: params.entityType,
    entityId: params.entityId,
    summary: params.summary,
    detailsJson: JSON.stringify(detailsPayload),
  };

  try {
    const saved = await prisma.auditEvent.create({
      data: {
        merchantId: params.merchantId,
        timestamp,
        actor: params.actor,
        eventType: params.eventType,
        entityType: params.entityType,
        entityId: params.entityId,
        summary: params.summary,
        detailsJson: JSON.stringify(detailsPayload),
      },
    });
    record.id = saved.id;
  } catch (error) {
    // If DB is unreachable in pure unit tests, preserve in-memory record without crashing
    console.warn('Audit logger warning: Failed to persist to DB, returning in-memory record:', error);
  }

  return record;
}

/**
 * Pure helper to build an audit record without DB side-effects (useful for pure testing).
 */
export function createAuditRecord(params: AuditLogParams): StructuredAuditRecord {
  return {
    merchantId: params.merchantId,
    timestamp: params.timestamp || new Date(),
    actor: params.actor,
    eventType: params.eventType,
    entityType: params.entityType,
    entityId: params.entityId,
    summary: params.summary,
    detailsJson: JSON.stringify({
      previousState: params.previousState,
      newState: params.newState,
      ...(params.metadata || {}),
    }),
  };
}
