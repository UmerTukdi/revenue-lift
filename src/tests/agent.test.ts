import { describe, it, expect } from 'vitest';
import { MockAIProvider, GeminiProvider, getAIProvider } from '../agent/provider';
import { runAgentCycle } from '../agent/orchestrator';
import { setMerchantGoal, discoverAndEvaluateOpportunities, executeApprovedAction } from '../agent/tools';
import { evaluateOpportunities } from '../core/evaluator';
import { DEMO_OPPORTUNITY_CANDIDATES } from '../opportunities/demoCandidates';
import { IllegalStateTransitionError } from '../core/errors';

describe('AI Revenue Scientist Agent & Governance (Step 3)', () => {
  const mockProvider = new MockAIProvider();

  // --------------------------------------------------------------------------
  // 1. Natural Language Goal Parsing
  // --------------------------------------------------------------------------
  describe('1. Natural Language Goal Parsing', () => {
    it('parses valid structured goal with target revenue, margin floor, and discount cap', async () => {
      const prompt = 'I want ₹50,000 additional revenue this month. Keep margin above 25% and discounts below 10%.';
      const parsed = await mockProvider.parseGoal(prompt);

      expect(parsed.isValid).toBe(true);
      expect(parsed.targetRevenue).toBe(50000);
      expect(parsed.timeframeDays).toBe(30);
      expect(parsed.marginFloorPct).toBe(25.0);
      expect(parsed.discountCapPct).toBe(10.0);
      expect(parsed.missingField).toBeUndefined();
    });

    it('extracts abbreviations like 50k and duplicate frequency constraints', async () => {
      const prompt = 'Generate 50k extra sales. Do not target customers who were already contacted in 14 days.';
      const parsed = await mockProvider.parseGoal(prompt);

      expect(parsed.isValid).toBe(true);
      expect(parsed.targetRevenue).toBe(50000);
      expect(parsed.duplicateWindowDays).toBe(14);
    });

    it('flags missing target revenue and returns a helpful clarification question', async () => {
      const prompt = 'Keep margin above 25% and discounts below 10%.';
      const parsed = await mockProvider.parseGoal(prompt);

      expect(parsed.isValid).toBe(false);
      expect(parsed.missingField).toBe('targetRevenue');
      expect(parsed.clarificationQuestion).toBeDefined();
      expect(parsed.clarificationQuestion).toContain('target incremental revenue');
    });
  });

  // --------------------------------------------------------------------------
  // 2. AI Provider Abstraction & Mock Mode (Zero API Key Dependency)
  // --------------------------------------------------------------------------
  describe('2. AI Provider Abstraction & Safe Fallbacks', () => {
    it('factory returns MockAIProvider when provider is mock or keys are absent', () => {
      const provider = getAIProvider('mock');
      expect(provider.name).toBe('mock');
    });

    it('GeminiProvider falls back safely to deterministic mock when API key is missing', async () => {
      const unauthenticatedGemini = new GeminiProvider(undefined);
      const parsed = await unauthenticatedGemini.parseGoal('I want ₹50,000 additional revenue. Margin at least 25%.');

      expect(parsed.isValid).toBe(true);
      expect(parsed.targetRevenue).toBe(50000);
      expect(parsed.marginFloorPct).toBe(25.0);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Deterministic Evaluator Called with Parsed Constraints
  // --------------------------------------------------------------------------
  describe('3. Deterministic Evaluator Integration', () => {
    it('calls deterministic evaluator with parsed constraints and strictly preserves numbers', async () => {
      const parsed = await mockProvider.parseGoal(
        'Generate ₹50,000 extra revenue. Margin must remain >= 25%. Discount <= 10%.'
      );

      const constraints = [
        { type: 'MARGIN_FLOOR' as const, operator: 'GTE' as const, thresholdValue: parsed.marginFloorPct!, unit: 'PERCENT' as const, isHard: true },
        { type: 'DISCOUNT_CAP' as const, operator: 'LTE' as const, thresholdValue: parsed.discountCapPct!, unit: 'PERCENT' as const, isHard: true },
      ];

      const report = evaluateOpportunities(DEMO_OPPORTUNITY_CANDIDATES, constraints);

      // Verify Case A is rejected and CANNOT win
      const caseA = report.rejectedOpportunities.find((o) => o.id === 'opp_demo_case_a_rejected');
      expect(caseA).toBeDefined();
      expect(caseA?.isEligible).toBe(false);
      expect(report.winner?.id).not.toBe('opp_demo_case_a_rejected');

      // Verify Case B is the legitimate winner
      expect(report.winner?.id).toBe('opp_demo_case_b_winner');
      expect(report.winner?.scoring.expectedNetValue).toBe(54208);
    });

    it('guarantees LLM explanation does NOT alter numbers from the deterministic engine', async () => {
      const report = evaluateOpportunities(DEMO_OPPORTUNITY_CANDIDATES, [
        { type: 'MARGIN_FLOOR', operator: 'GTE', thresholdValue: 25.0, unit: 'PERCENT', isHard: true },
        { type: 'DISCOUNT_CAP', operator: 'LTE', thresholdValue: 10.0, unit: 'PERCENT', isHard: true },
      ]);

      const explanation = await mockProvider.generateExplanation({
        targetRevenue: 50000,
        timeframeDays: 30,
        winner: report.winner,
        eligible: report.eligibleOpportunities,
        rejected: report.rejectedOpportunities,
        constraints: [
          { type: 'MARGIN_FLOOR', operator: 'GTE', thresholdValue: 25.0, unit: 'PERCENT', isHard: true },
        ],
      });

      // Must quote exact numbers computed by backend
      expect(explanation).toContain('₹54,208');
      expect(explanation).toContain('₹67,800');
      expect(explanation).toContain('DISQUALIFIED');
      expect(explanation).toContain('Awaiting your explicit approval');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Full Orchestrator Loop & Governance Gates
  // --------------------------------------------------------------------------
  describe('4. Full Orchestrator Execution Loop', () => {
    it('runs end-to-end agent cycle for a valid merchant prompt', async () => {
      const res = await runAgentCycle({
        message: 'I want ₹50,000 additional revenue this month. Keep margin above 25% and discount below 10%.',
      });

      expect(res.goal?.isValid).toBe(true);
      expect(res.goal?.targetRevenue).toBe(50000);
      expect(res.winner).toBeDefined();
      expect(res.winner?.title).toContain('Dormant Customer Win-Back');
      expect(res.rejectedOpportunities.length).toBeGreaterThanOrEqual(1);
      expect(res.requiresApproval).toBe(true);
      expect(res.lifecycleState).toBe('DECISION_AWAITING_APPROVAL');
      expect(res.message).toContain('Recommended Action');
    });

    it('returns clarification message when target revenue is missing', async () => {
      const res = await runAgentCycle({
        message: 'Optimize my sales and keep margins above 25%.',
      });

      expect(res.goal?.isValid).toBe(false);
      expect(res.winner).toBeNull();
      expect(res.requiresApproval).toBe(false);
      expect(res.message).toContain('Please specify your target incremental revenue');
    });

    it('strictly forbids executing an action without verified merchant approval', async () => {
      await expect(executeApprovedAction('act_demo_123', false)).rejects.toThrow(
        IllegalStateTransitionError
      );
    });
  });
});
