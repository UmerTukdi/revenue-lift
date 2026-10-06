// ==============================================================================
// Revenue Lift — AI Provider Abstraction
// ==============================================================================
// The LLM is strictly an interface and natural language reasoning layer.
// All financial arithmetic, constraint checks, and rankings are performed
// by the authoritative deterministic engine.
// Supports Gemini, Mock (deterministic demo/test mode), and extensible to Groq.
// ==============================================================================

import { config } from '../lib/env';
import { ParsedGoal, DecisionExplanationContext } from './types';

export interface AIProvider {
  name: string;
  parseGoal(prompt: string): Promise<ParsedGoal>;
  generateExplanation(context: DecisionExplanationContext): Promise<string>;
}

// ------------------------------------------------------------------------------
// Deterministic Mock Provider (Runs without API key, 100% reliable for testing/demo)
// ------------------------------------------------------------------------------
export class MockAIProvider implements AIProvider {
  public readonly name = 'mock';

  async parseGoal(prompt: string): Promise<ParsedGoal> {
    const text = prompt.toLowerCase();

    // 1. Extract Target Revenue (e.g. ₹50,000, 50000, 50k)
    let targetRevenue: number | undefined;
    const revMatch = text.match(/(?:₹|rs\.?|inr)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+(?:\.[0-9]+)?)\s*(k|lakh|lac|cr)?\s*(?:additional|extra|more)?\s*(?:revenue|sales|target)?/i);

    if (revMatch) {
      const rawNum = parseFloat(revMatch[1].replace(/,/g, ''));
      const multiplier = revMatch[2]?.toLowerCase();
      if (multiplier === 'k') targetRevenue = rawNum * 1000;
      else if (multiplier === 'lakh' || multiplier === 'lac') targetRevenue = rawNum * 100000;
      else if (multiplier === 'cr') targetRevenue = rawNum * 10000000;
      else if (rawNum > 100) targetRevenue = rawNum; // Sensible minimum threshold for revenue
    }

    // Direct fallback search for '50000' or '50k' if regex didn't catch
    if (!targetRevenue) {
      if (text.includes('50,000') || text.includes('50000')) targetRevenue = 50000;
      else if (text.includes('50k')) targetRevenue = 50000;
    }

    // 2. Extract Margin Floor (e.g. margin above 25%, margin >= 25%, margin 25%)
    let marginFloorPct: number | undefined;
    const marginMatch = text.match(/margin\s*(?:cannot fall below|above|floor|at least|>=|>|minimum of)?\s*([0-9]+(?:\.[0-9]+)?)\s*%/i);
    if (marginMatch) {
      marginFloorPct = parseFloat(marginMatch[1]);
    } else if (text.includes('25%') && text.includes('margin')) {
      marginFloorPct = 25.0;
    }

    // 3. Extract Discount Cap (e.g. discount below 10%, discount <= 10%, max 10% discount)
    let discountCapPct: number | undefined;
    const discountMatch = text.match(/discount\s*(?:cannot exceed|below|cap|under|at most|<=|<|maximum of)?\s*([0-9]+(?:\.[0-9]+)?)\s*%/i);
    if (discountMatch) {
      discountCapPct = parseFloat(discountMatch[1]);
    } else if (text.includes('10%') && (text.includes('discount') || text.includes('discounts'))) {
      discountCapPct = 10.0;
    }

    // 4. Extract Inventory Minimum
    let inventoryMinimum: number | undefined;
    const invMatch = text.match(/inventory\s*(?:above|minimum|at least|>=|>)?\s*([0-9]+)\s*(?:units)?/i);
    if (invMatch) {
      inventoryMinimum = parseInt(invMatch[1], 10);
    }

    // 5. Extract Duplicate Window Days
    let duplicateWindowDays: number | undefined;
    const dedupeMatch = text.match(/(?:contact|outreach|duplicate|window)\s*(?:interval|window|frequency)?\s*(?:of)?\s*([0-9]+)\s*days/i);
    if (dedupeMatch) {
      duplicateWindowDays = parseInt(dedupeMatch[1], 10);
    } else if (text.includes('already contacted') || text.includes('previously contacted')) {
      duplicateWindowDays = 14; // Default safe merchant protection window
    }

    // 6. Timeframe Days
    let timeframeDays = 30; // Default monthly
    if (text.includes('month') || text.includes('30 days')) timeframeDays = 30;
    else if (text.includes('quarter') || text.includes('90 days')) timeframeDays = 90;
    else if (text.includes('14 days') || text.includes('2 weeks')) timeframeDays = 14;

    // Check validity
    if (!targetRevenue || targetRevenue <= 0) {
      return {
        targetRevenue: undefined,
        timeframeDays,
        marginFloorPct,
        discountCapPct,
        inventoryMinimum,
        duplicateWindowDays,
        isValid: false,
        missingField: 'targetRevenue',
        clarificationQuestion:
          'Please specify your target incremental revenue (e.g. "Generate ₹50,000 additional revenue this month") so I can evaluate and rank growth opportunities for you.',
      };
    }

    return {
      targetRevenue,
      timeframeDays,
      marginFloorPct,
      discountCapPct,
      inventoryMinimum,
      duplicateWindowDays,
      isValid: true,
    };
  }

  async generateExplanation(context: DecisionExplanationContext): Promise<string> {
    const { winner, eligible, rejected, constraints } = context;

    if (!winner) {
      return `I analyzed your available opportunities, but none satisfied your hard business constraints (${constraints
        .map((c) => `${c.type} ${c.operator} ${c.thresholdValue}${c.unit}`)
        .join(', ')}). No consequential action will be initiated to avoid damaging your margins.`;
    }

    let explanation = `I evaluated available growth opportunities against your goal of ₹${context.targetRevenue.toLocaleString(
      'en-IN'
    )} incremental revenue.\n\n`;

    // Highlight rejected candidates (e.g. Case A)
    if (rejected.length > 0) {
      const topRejected = rejected[0];
      explanation += `⚠️ Excluded Strategy: '${topRejected.title}' had the highest nominal projected value (₹${topRejected.scoring.expectedNetValue.toLocaleString(
        'en-IN'
      )}), but it was DISQUALIFIED because it violates your hard constraints (${topRejected.rejectionReasons.join(
        '; '
      )}). I have excluded it to protect your profitability.\n\n`;
    }

    // Recommend the winner
    explanation += `🏆 Recommended Action: I recommend '${winner.title}'. It delivers the highest Expected Net Value (₹${winner.scoring.expectedNetValue.toLocaleString(
      'en-IN'
    )}) among all ${eligible.length} strategies that strictly satisfy your margin floor and discount constraints.`;

    // Compare with runner-up if available
    const runnerUp = eligible.find((o) => o.id !== winner.id);
    if (runnerUp) {
      explanation += ` It outperforms '${runnerUp.title}' (Expected Net Value: ₹${runnerUp.scoring.expectedNetValue.toLocaleString(
        'en-IN'
      )}) by ₹${(winner.scoring.expectedNetValue - runnerUp.scoring.expectedNetValue).toLocaleString('en-IN')}.\n\n`;
    } else {
      explanation += `\n\n`;
    }

    explanation += `🔒 Awaiting your explicit approval before any Razorpay action is initiated.`;

    return explanation;
  }
}

// ------------------------------------------------------------------------------
// Gemini AI Provider (Connects to Google GenAI REST API with Mock Fallback)
// ------------------------------------------------------------------------------
export class GeminiProvider implements AIProvider {
  public readonly name = 'gemini';
  private apiKey?: string;
  private fallback: MockAIProvider;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || config.geminiApiKey;
    this.fallback = new MockAIProvider();
  }

  async parseGoal(prompt: string): Promise<ParsedGoal> {
    if (!this.apiKey) {
      // Gracefully fall back to deterministic mock parser if API key is missing
      return this.fallback.parseGoal(prompt);
    }

    try {
      const systemInstruction = `You are a financial goal extraction parser for Razorpay merchants.
Extract numeric parameters from the merchant instruction.
Return ONLY valid JSON matching this schema:
{
  "targetRevenue": number or null,
  "timeframeDays": number (default 30),
  "marginFloorPct": number or null,
  "discountCapPct": number or null,
  "inventoryMinimum": number or null,
  "duplicateWindowDays": number or null,
  "targetSegments": string[] or []
}`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(8000), // 8-second timeout for reliable demo experience
          body: JSON.stringify({
            contents: [
              { role: 'user', parts: [{ text: `${systemInstruction}\n\nMerchant Message: "${prompt}"` }] },
            ],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json',
            },
          }),
        }
      );

      if (!response.ok) {
        console.warn(`Gemini API call failed with status ${response.status}. Falling back to deterministic parser.`);
        return this.fallback.parseGoal(prompt);
      }

      const data = await response.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) return this.fallback.parseGoal(prompt);

      const parsed = JSON.parse(rawText);
      const targetRevenue = parsed.targetRevenue ? Number(parsed.targetRevenue) : undefined;

      if (!targetRevenue || targetRevenue <= 0) {
        return {
          targetRevenue: undefined,
          timeframeDays: parsed.timeframeDays || 30,
          marginFloorPct: parsed.marginFloorPct ? Number(parsed.marginFloorPct) : undefined,
          discountCapPct: parsed.discountCapPct ? Number(parsed.discountCapPct) : undefined,
          inventoryMinimum: parsed.inventoryMinimum ? Number(parsed.inventoryMinimum) : undefined,
          duplicateWindowDays: parsed.duplicateWindowDays ? Number(parsed.duplicateWindowDays) : undefined,
          isValid: false,
          missingField: 'targetRevenue',
          clarificationQuestion:
            'Please specify your target incremental revenue (e.g. "Generate ₹50,000 additional revenue") so I can find and rank growth opportunities for you.',
        };
      }

      return {
        targetRevenue,
        timeframeDays: parsed.timeframeDays || 30,
        marginFloorPct: parsed.marginFloorPct ? Number(parsed.marginFloorPct) : undefined,
        discountCapPct: parsed.discountCapPct ? Number(parsed.discountCapPct) : undefined,
        inventoryMinimum: parsed.inventoryMinimum ? Number(parsed.inventoryMinimum) : undefined,
        duplicateWindowDays: parsed.duplicateWindowDays ? Number(parsed.duplicateWindowDays) : undefined,
        targetSegments: Array.isArray(parsed.targetSegments) ? parsed.targetSegments : undefined,
        isValid: true,
      };
    } catch (error) {
      console.warn('Gemini parser error. Safely falling back to deterministic parser:', error);
      return this.fallback.parseGoal(prompt);
    }
  }

  async generateExplanation(context: DecisionExplanationContext): Promise<string> {
    if (!this.apiKey) {
      return this.fallback.generateExplanation(context);
    }

    try {
      const prompt = `You are Revenue Lift, an AI Revenue Scientist for Razorpay merchants.
Explain this growth decision based STRICTLY on these deterministic numbers. DO NOT invent or alter any number:
- Goal: ₹${context.targetRevenue.toLocaleString('en-IN')} incremental revenue in ${context.timeframeDays} days.
- Winner: ${context.winner ? `'${context.winner.title}' with Expected Net Value ₹${context.winner.scoring.expectedNetValue.toLocaleString('en-IN')}, margin ${context.winner.projectedMarginPct}%, discount ${context.winner.projectedDiscountPct}%` : 'None eligible'}
- Disqualified Opportunities: ${context.rejected.map((r) => `'${r.title}' (Expected Net Value: ₹${r.scoring.expectedNetValue.toLocaleString('en-IN')}) REJECTED because ${r.rejectionReasons.join('; ')}`).join(' | ')}
- Other Eligible Opportunities: ${context.eligible.filter((e) => e.id !== context.winner?.id).map((e) => `'${e.title}' (₹${e.scoring.expectedNetValue.toLocaleString('en-IN')})`).join(', ')}

Explain clearly why the winner was chosen and why the highest-value option was disqualified to protect merchant margin. Remind the merchant that their explicit approval is required before execution.`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(8000), // 8-second timeout for reliable demo experience
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3 },
          }),
        }
      );

      if (!response.ok) {
        return this.fallback.generateExplanation(context);
      }

      const data = await response.json();
      const generated = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      return generated || this.fallback.generateExplanation(context);
    } catch (error) {
      console.warn('Gemini explanation error, using deterministic fallback:', error);
      return this.fallback.generateExplanation(context);
    }
  }
}

/**
 * Factory to retrieve the configured AI provider.
 * Guaranteed to never crash: Falls back to MockAIProvider if keys are absent or misconfigured.
 */
export function getAIProvider(providerType?: string): AIProvider {
  const chosenType = providerType || config.aiProvider || 'mock';

  if (chosenType === 'gemini' && config.geminiApiKey) {
    return new GeminiProvider(config.geminiApiKey);
  }

  // Default to robust Mock provider
  return new MockAIProvider();
}
