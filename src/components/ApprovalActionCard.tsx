'use client';

// ==============================================================================
// Revenue Lift — Merchant Approval & Execution Governance Component
// ==============================================================================
// Enforces explicit merchant human-in-the-loop approval before executing
// actions through Razorpay test mode. Includes failure simulation trigger.
// ==============================================================================

import React, { useState } from 'react';
import { ShieldCheck, Lock, Play, AlertOctagon, CheckCircle, RefreshCw, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface ApprovalActionCardProps {
  actionId: string;
  initialStatus: string;
  opportunityTitle: string;
  expectedNetValue: number;
  eligibleCustomers: number;
}

export default function ApprovalActionCard({
  actionId,
  initialStatus,
  opportunityTitle,
  expectedNetValue,
  eligibleCustomers,
}: ApprovalActionCardProps) {
  const [status, setStatus] = useState<string>(initialStatus);
  const [loading, setLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  const [referenceId, setReferenceId] = useState<string | null>(null);

  // 1. Handle standard Approval + Execution flow
  const handleApproveAndExecute = async (forceFailure = false) => {
    setLoading(true);
    setMessage(null);

    try {
      // Step A: Explicit Merchant Approval
      if (status === 'PENDING_APPROVAL') {
        const approveRes = await fetch('/api/actions/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actionId }),
        });

        const approveData = await approveRes.json();
        if (!approveRes.ok) {
          throw new Error(approveData.message || 'Approval failed');
        }
        setStatus('APPROVED');
      }

      // Step B: Razorpay Execution
      const execRes = await fetch('/api/actions/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId, forceFailure }),
      });

      const execData = await execRes.json();

      if (execRes.ok && execData.success) {
        setStatus('COMPLETED');
        setReferenceId(execData.referenceId);
        setMessage(`Success! Dispatched ${execData.linksCreated} test payment links via Razorpay Test Mode.`);
        router.refresh();
      } else {
        setStatus('FAILED');
        setMessage(execData.message || execData.errorMessage || 'Execution failed. No customer was notified or charged.');
        router.refresh();
      }
    } catch (err: any) {
      setStatus('FAILED');
      setMessage(err?.message || 'Execution failed. No customer was notified or charged.');
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-800 space-y-3">
      {/* Governance & State Indicator */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400">Current Action State:</span>
          {status === 'PENDING_APPROVAL' && (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1 font-semibold">
              <Lock className="w-3 h-3" /> APPROVAL REQUIRED
            </span>
          )}
          {status === 'APPROVED' && (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1 font-semibold">
              <ShieldCheck className="w-3 h-3" /> APPROVED
            </span>
          )}
          {status === 'COMPLETED' && (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 font-semibold">
              <CheckCircle className="w-3 h-3" /> EXECUTED VIA RAZORPAY
            </span>
          )}
          {status === 'FAILED' && (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1 font-semibold">
              <AlertOctagon className="w-3 h-3" /> EXECUTION FAILED
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500">
          <span>DEMO MERCHANT</span> • <span>RAZORPAY TEST MODE</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-3">
        {status !== 'COMPLETED' ? (
          <>
            <button
              onClick={() => handleApproveAndExecute(false)}
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 transition disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              {status === 'PENDING_APPROVAL' ? 'Approve & Execute Action' : 'Retry Execution'}
            </button>

            {/* Failure Simulation Button */}
            <button
              onClick={() => handleApproveAndExecute(true)}
              disabled={loading}
              className="px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-rose-950/40 text-rose-300 border border-rose-500/30 font-medium text-xs flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
              title="Test controlled failure handling without real damage"
            >
              <Zap className="w-3.5 h-3.5 text-rose-400" />
              Simulate Gateway Failure
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2 text-xs text-emerald-400 font-medium">
            <CheckCircle className="w-4 h-4" />
            <span>Execution verified. Batch Ref: <code className="font-mono">{referenceId || 'plink_test_batch'}</code></span>
          </div>
        )}
      </div>

      {/* Status Feedback Message */}
      {message && (
        <div
          className={`p-3 rounded-lg text-xs border ${
            status === 'COMPLETED'
              ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-950/30 border-rose-500/30 text-rose-300'
          }`}
        >
          {message}
        </div>
      )}
    </div>
  );
}
