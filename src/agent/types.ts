// ==============================================================================
// Revenue Lift — AI Agent Contracts & Interfaces
// ==============================================================================

import { HardConstraintRule } from '../core/constraints';
import { EvaluatedOpportunity } from '../core/evaluator';
import { LifecycleState } from '../core/stateMachine';
import { StructuredAuditRecord } from '../core/auditLogger';

export interface ParsedGoal {
  /** Target incremental revenue in INR (e.g. 50000) */
  targetRevenue?: number;
  /** Campaign timeframe in days (default 30) */
  timeframeDays?: number;
  /** Minimum acceptable gross profit margin % (e.g. 25.0) */
  marginFloorPct?: number;
  /** Maximum allowable discount % (e.g. 10.0) */
  discountCapPct?: number;
  /** Minimum safe inventory buffer in units (e.g. 15) */
  inventoryMinimum?: number;
  /** Minimum days between outreach to same segment (e.g. 14) */
  duplicateWindowDays?: number;
  /** Optional customer segments specified by merchant */
  targetSegments?: string[];
  /** Flag indicating whether the goal is sufficiently specified to run */
  isValid: boolean;
  /** Missing critical field name if isValid is false */
  missingField?: string;
  /** Clarification question to prompt the merchant if required info is missing */
  clarificationQuestion?: string;
}

export interface DecisionExplanationContext {
  targetRevenue: number;
  timeframeDays: number;
  winner: EvaluatedOpportunity | null;
  eligible: EvaluatedOpportunity[];
  rejected: EvaluatedOpportunity[];
  constraints: HardConstraintRule[];
}

export interface AgentResponse {
  /** Natural-language conversational response and explanation */
  message: string;
  /** Structured goal if detected/provided */
  goal?: ParsedGoal;
  /** Active locked constraints applied */
  constraints?: HardConstraintRule[];
  /** All opportunities evaluated */
  opportunities: EvaluatedOpportunity[];
  /** Recommended winner (Rank #1 among eligible) */
  winner: EvaluatedOpportunity | null;
  /** List of disqualified opportunities with explicit reasons */
  rejectedOpportunities: EvaluatedOpportunity[];
  /** Recommended next operational step */
  nextAction: string;
  /** Governance flag: Consequential actions strictly require human approval */
  requiresApproval: boolean;
  /** Current state machine lifecycle position */
  lifecycleState: LifecycleState;
  /** Recent audit records generated during this session */
  auditEvents?: StructuredAuditRecord[];
  /** Optional recommended action details */
  recommendedAction?: {
    id: string;
    status: string;
    opportunityId: string;
  };
  /** Error detail if an operational error occurred */
  error?: string;
}
