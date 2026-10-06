'use client';

// ==============================================================================
// Revenue Lift — Natural Language Goal Input Component
// ==============================================================================
// Allows merchants to set goals in plain English. Calls /api/agent server route.
// ==============================================================================

import React, { useState } from 'react';
import { Sparkles, ArrowRight, RefreshCw, AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function MerchantGoalInput() {
  const [prompt, setPrompt] = useState(
    'I want ₹50,000 additional revenue this month. Keep margin above 25% and discount below 10%.'
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: prompt.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Failed to analyze goal with AI agent');
      }

      // Refresh server components to display updated goal and opportunities
      router.refresh();
    } catch (err: any) {
      setError(err?.message || 'Agent query failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl bg-gradient-to-r from-indigo-950/40 via-slate-900/90 to-slate-900 border border-indigo-500/30 p-5 shadow-xl">
      <form onSubmit={handleAnalyze} className="space-y-3">
        <div className="flex items-center justify-between">
          <label htmlFor="merchant-prompt" className="text-xs font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            AI Revenue Scientist — Goal Input
          </label>
          <span className="text-[11px] text-slate-400">Natural-Language Intent & Constraint Parser</span>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            id="merchant-prompt"
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="State your goal (e.g. 'I want ₹50,000 additional revenue with 25% margin floor')"
            className="flex-1 bg-slate-950/90 border border-slate-700/80 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition font-mono text-xs sm:text-sm"
          />
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25 transition disabled:opacity-50 cursor-pointer shrink-0"
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Analyzing...</span>
              </>
            ) : (
              <>
                <span>Analyze Opportunities</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-950/30 p-2.5 rounded-lg border border-rose-500/30">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </form>
    </div>
  );
}
