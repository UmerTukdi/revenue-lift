// ==============================================================================
// Revenue Lift — Server-Side Agent API Route
// ==============================================================================
// POST /api/agent
// Invokes the AI Revenue Scientist agent orchestrator.
// Server-side only: Never exposes secrets or executes actions without approval.
// ==============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { runAgentCycle } from '@/agent/orchestrator';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body || typeof body.message !== 'string' || body.message.trim().length === 0) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: 'A valid natural language merchant message string is required in the body.',
        },
        { status: 400 }
      );
    }

    const response = await runAgentCycle({
      message: body.message.trim(),
      merchantId: body.merchantId,
      goalId: body.goalId,
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error: any) {
    console.error('Agent API error:', error);

    return NextResponse.json(
      {
        error: 'Internal Agent Error',
        message: 'The AI Revenue Scientist encountered an unexpected error. No financial action was taken.',
        requiresApproval: false,
        lifecycleState: 'CANDIDATE_DISCOVERED',
      },
      { status: 500 }
    );
  }
}
