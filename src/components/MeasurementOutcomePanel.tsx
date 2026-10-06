'use client';

// ==============================================================================
// Revenue Lift — Measurement & Outcome Reconciliation Panel
// ==============================================================================
// Closes the full loop: Candidate -> Decision -> Action -> Measurement
// Compares predicted Expected Net Value against actual realized revenue.
// ==============================================================================

import React, { useState } from 'react';
import { BarChart3, TrendingUp, CheckCircle2, AlertTriangle, RefreshCw, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface MeasurementOutcomePanelProps {
  actionId: string;
  actionStatus: string;
  predictedNetValue: number;
  predictedRevenue: number;
  targetRevenue: number;
  existingMeasurement?: {
    id: string;
    predictedRevenue: number;
    actualRevenue: number;
    predictedNetValue: number;
    actualNetValue: number;
    conversionsCount: number;
    goalAttainmentRate: number;
  } | null;
}

export default function MeasurementOutcomePanel({
  actionId,
  actionStatus,
  predictedNetValue,
  predictedRevenue,
  targetRevenue,
  existingMeasurement,
}: MeasurementOutcomePanelProps) {
  const [measurement, setMeasurement] = useState<any>(existingMeasurement || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleRecordMeasurement = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/measurements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to record measurement');
      }

      setMeasurement(data.metrics);
      router.refresh();
    } catch (err: any) {
      setError(err?.message || 'Measurement error');
    } finally {
      setLoading(false);
    }
  };

  // State 1: Action Failed
  if (actionStatus === 'FAILED') {
    return (
      <div className="rounded-xl bg-rose-950/20 border border-rose-500/30 p-4 text-xs text-rose-300 flex items-center gap-3">
        <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
        <div>
          <span className="font-semibold block">Measurement Unavailable — Execution Failed</span>
          <span className="text-slate-400 text-[11px]">
            No customer was charged. You can retry execution or inspect the audit log.
          </span>
        </div>
      </div>
    );
  }

  // State 2: Action Pending Approval or Not Completed Yet
  if (actionStatus !== 'COMPLETED') {
    return (
      <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4 text-xs text-slate-400 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-slate-500" />
          <span>Measurement Phase: Unlocks after consequential execution completes.</span>
        </div>
        <span className="text-[11px] font-mono text-slate-500">Stage 4 in queue</span>
      </div>
    );
  }

  // State 3: Action Completed, Awaiting or Showing Measurement
  return (
    <div className="rounded-2xl bg-gradient-to-br from-indigo-950/30 via-slate-900/90 to-slate-900 border border-indigo-500/40 p-5 shadow-2xl space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
            Post-Action Measurement & Reconciliation
          </h3>
        </div>
        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold">
          SYNTHETIC DEMO MEASUREMENT
        </span>
      </div>

      {measurement ? (
        <div className="space-y-4">
          {/* 3 Metric Cards: Predicted vs Actual, Accuracy, Goal Progress */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* 1. Net Value Comparison */}
            <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
              <div className="text-[11px] text-slate-400 uppercase font-semibold">Net Value Variance</div>
              <div className="mt-1 flex items-baseline justify-between">
                <div>
                  <span className="text-xl font-black text-emerald-400 font-mono">
                    ₹{measurement.actualNetValue.toLocaleString('en-IN')}
                  </span>
                  <span className="text-[10px] text-slate-400 block font-medium">Actual Net Value</span>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-300 font-mono">
                    ₹{measurement.predictedNetValue.toLocaleString('en-IN')}
                  </span>
                  <span className="text-[10px] text-slate-500 block">Predicted Expected Net</span>
                </div>
              </div>
              <div className="mt-2 text-[11px] font-mono font-medium text-amber-400 flex items-center justify-between border-t border-slate-700/40 pt-1.5">
                <span>Net Value Delta:</span>
                <span>
                  {measurement.netValueDelta >= 0 ? '+' : ''}₹{measurement.netValueDelta.toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            {/* 2. Prediction Accuracy */}
            <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
              <div className="text-[11px] text-slate-400 uppercase font-semibold">Prediction Accuracy</div>
              <div className="text-2xl font-black text-indigo-300 font-mono mt-1">
                {measurement.predictionAccuracyPct}%
              </div>
              <div className="w-full bg-slate-700/60 h-2 rounded-full overflow-hidden mt-2">
                <div
                  className="bg-indigo-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(measurement.predictionAccuracyPct, 100)}%` }}
                ></div>
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block">
                Deterministic model accuracy vs actual net realized
              </span>
            </div>

            {/* 3. Goal Progress & Incremental Revenue */}
            <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
              <div className="text-[11px] text-slate-400 uppercase font-semibold">Goal Progress</div>
              <div className="flex items-baseline justify-between mt-1">
                <div className="text-2xl font-black text-emerald-400 font-mono">
                  {measurement.goalProgressPct}%
                </div>
                <div className="text-right text-[11px] font-mono text-emerald-300">
                  +₹{(measurement.actualRevenue - targetRevenue).toLocaleString('en-IN')}
                </div>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-emerald-300 font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Target Achieved</span>
              </div>
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                Actual Incremental Revenue: ₹{measurement.actualRevenue.toLocaleString('en-IN')} (Target: ₹{targetRevenue.toLocaleString('en-IN')})
              </span>
            </div>
          </div>

          {/* Metric Separation Governance Callout */}
          <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2">
            <span className="text-emerald-400 font-bold shrink-0">✓ Metric Integrity:</span>
            <span>
              <strong>Actual Incremental Revenue</strong> (₹{measurement.actualRevenue.toLocaleString('en-IN')}) measures top-line conversions towards the ₹{targetRevenue.toLocaleString('en-IN')} target ({measurement.goalProgressPct}% Goal Progress). <strong>Actual Net Value</strong> (₹{measurement.actualNetValue.toLocaleString('en-IN')}) accounts for incentive campaign costs to measure net retained profit ({measurement.predictionAccuracyPct}% accuracy vs predicted ₹{measurement.predictedNetValue.toLocaleString('en-IN')}).
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-slate-950/60 rounded-xl border border-slate-800">
          <div>
            <div className="text-xs font-semibold text-white">Execution Succeeded in Razorpay Test Mode</div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Reconcile captured checkouts and verify prediction accuracy against your ₹{targetRevenue.toLocaleString('en-IN')} target.
            </p>
          </div>

          <button
            onClick={handleRecordMeasurement}
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-indigo-500/20 transition disabled:opacity-50 cursor-pointer shrink-0"
          >
            {loading ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <BarChart3 className="w-3.5 h-3.5" />
            )}
            <span>Record Measurement</span>
          </button>
        </div>
      )}

      {error && (
        <div className="text-xs text-rose-400 bg-rose-950/30 p-2 rounded border border-rose-500/30">
          {error}
        </div>
      )}
    </div>
  );
}
