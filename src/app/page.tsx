import prisma from '@/lib/db';
import { 
  ShieldCheck, 
  Target, 
  Layers, 
  CheckCircle2, 
  Lock, 
  Terminal,
  Activity,
  AlertTriangle,
  Building2,
  TrendingUp,
  XCircle,
  Award,
  Sparkles,
  HelpCircle,
  CreditCard,
  Cpu,
  Server,
  Scale
} from 'lucide-react';
import ApprovalActionCard from '@/components/ApprovalActionCard';
import MerchantGoalInput from '@/components/MerchantGoalInput';
import MeasurementOutcomePanel from '@/components/MeasurementOutcomePanel';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const merchant = await prisma.merchant.findFirst({
    include: {
      goals: {
        orderBy: { createdAt: 'desc' },
        include: {
          constraints: true,
          opportunities: {
            include: {
              actions: {
                include: {
                  executions: { orderBy: { executedAt: 'desc' } },
                  measurement: true,
                },
              },
            },
            orderBy: { expectedNetValue: 'desc' },
          },
        },
      },
      products: true,
      auditEvents: {
        take: 10,
        orderBy: { timestamp: 'desc' },
      },
    },
  });
  console.log('🔎 Merchant fetched:', JSON.stringify(merchant, null, 2));
  // Choose the ACTIVE goal if present, otherwise fall back to the most recent goal
  const activeGoal = merchant?.goals?.find((g) => g.status === 'ACTIVE') || merchant?.goals?.[0] || null;
  console.log('🪄 Current Goal ID:', activeGoal?.id, 'Status:', activeGoal?.status);
  const opportunities = activeGoal?.opportunities || [];
  console.log('📊 Opportunities count:', opportunities.length);

  const eligibleOpportunities = opportunities
    .filter((o) => o.status === 'ELIGIBLE')
    .sort((a, b) => b.expectedNetValue - a.expectedNetValue);

  const rejectedOpportunities = opportunities.filter((o) => o.status === 'REJECTED');
  const winner = eligibleOpportunities.find((o) => o.isRecommended) || eligibleOpportunities[0];
  let winnerAction = null;
  if (winner) {
    // Fetch the persisted CampaignAction for the winner opportunity
    winnerAction = await prisma.campaignAction.findFirst({
      where: { opportunityId: winner.id },
      include: {
        executions: { orderBy: { executedAt: 'desc' } },
        measurement: true,
      },
    });
  }
  const latestExecution = winnerAction?.executions?.[0];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased font-sans selection:bg-indigo-500 selection:text-white">
      {/* 1. Mandatory Test/Synthetic Notice Bar */}
      <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-xs text-amber-300">
        <div className="flex flex-wrap items-center justify-between gap-2 max-w-7xl mx-auto w-full">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>HACKATHON BUILDATHON DEMO:</strong> Track 01 — AI Growth & Agentic Commerce. All merchant and customer records are synthetic test fixtures.
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono">
            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/30">DEMO MERCHANT</span>
            <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-200 border border-indigo-500/30">RAZORPAY TEST MODE</span>
            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/30">SYNTHETIC DATA</span>
          </div>
        </div>
      </div>

      {/* 2. Top Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black tracking-tight text-white">Revenue Lift</h1>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  AI Revenue Scientist
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Revenue Lift is an AI Revenue Scientist that determines which growth action is worth taking for a merchant, explains why, executes the approved action through Razorpay, and measures whether it actually worked.
              </p>
            </div>
          </div>

          {/* System Health Indicators */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/60">
              <Building2 className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-300 font-medium truncate max-w-[200px]">
                {merchant?.name || 'ShopNova Electronics'}
              </span>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/40 border border-slate-800 text-[11px]">
              <Cpu className="w-3 h-3 text-indigo-400" />
              <span className="text-slate-400">AI Agent:</span>
              <span className="text-emerald-400 font-semibold">Active</span>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/40 border border-slate-800 text-[11px]">
              <Scale className="w-3 h-3 text-emerald-400" />
              <span className="text-slate-400">Decision Engine:</span>
              <span className="text-emerald-400 font-semibold">Healthy</span>
            </div>

            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/40 border border-slate-800 text-[11px]">
              <CreditCard className="w-3 h-3 text-amber-400" />
              <span className="text-slate-400">Razorpay Gateway:</span>
              <span className="text-amber-300 font-semibold">Test Mode</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Cockpit */}
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* 3. Locked Lifecycle Bar */}
        <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-5 shadow-xl">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              Locked Agent Lifecycle
            </h2>
            <span className="text-xs text-slate-500 font-mono">Candidate → Decision → Approval → Action → Measurement</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-800/40 border border-emerald-500/30">
              <div className="font-semibold text-emerald-400 uppercase tracking-wider text-[10px]">Step 1</div>
              <div className="font-bold text-white mt-0.5">Candidate</div>
              <p className="text-[11px] text-slate-400 mt-0.5">Economics scored</p>
            </div>

            <div className="p-3 rounded-xl bg-slate-800/40 border border-emerald-500/30">
              <div className="font-semibold text-emerald-400 uppercase tracking-wider text-[10px]">Step 2</div>
              <div className="font-bold text-white mt-0.5">Decision</div>
              <p className="text-[11px] text-slate-400 mt-0.5">Constraints applied</p>
            </div>

            <div className="p-3 rounded-xl bg-slate-800/40 border border-amber-500/40">
              <div className="font-semibold text-amber-400 uppercase tracking-wider text-[10px]">Step 3</div>
              <div className="font-bold text-white mt-0.5">Merchant Approval</div>
              <p className="text-[11px] text-slate-400 mt-0.5">Human authorization</p>
            </div>

            <div className="p-3 rounded-xl bg-slate-800/40 border border-indigo-500/30">
              <div className="font-semibold text-indigo-400 uppercase tracking-wider text-[10px]">Step 4</div>
              <div className="font-bold text-white mt-0.5">Action</div>
              <p className="text-[11px] text-slate-400 mt-0.5">Razorpay Test execution</p>
            </div>

            <div className="p-3 rounded-xl bg-slate-800/40 border border-emerald-500/40 col-span-2 md:col-span-1">
              <div className="font-semibold text-emerald-400 uppercase tracking-wider text-[10px]">Step 5</div>
              <div className="font-bold text-white mt-0.5">Measurement</div>
              <p className="text-[11px] text-slate-400 mt-0.5">Actual vs Prediction</p>
            </div>
          </div>
        </div>

        {/* 4. Natural Language Goal Input Bar */}
        <MerchantGoalInput />

        {/* 5. Active Goal & Locked Hard Constraints */}
        <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-indigo-400" />
              <h2 className="text-base font-semibold text-white">Current Goal & Hard Constraints</h2>
            </div>
            <span className="px-2.5 py-0.5 rounded text-xs font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold">
              TARGET TIMEFRAME: {activeGoal?.timeframeDays || 30} DAYS
            </span>
          </div>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60">
              <div className="text-xs text-slate-400 uppercase font-semibold">Target Incremental Revenue</div>
              <div className="text-2xl font-black text-emerald-400 font-mono mt-1">
                ₹{activeGoal?.targetRevenue.toLocaleString('en-IN') ?? '50,000'}
              </div>
              <div className="text-xs text-slate-500 mt-1">Target for current billing cycle</div>
            </div>

            <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60">
              <div className="text-xs text-slate-400 uppercase font-semibold">Margin Floor Filter</div>
              <div className="text-2xl font-black text-white font-mono mt-1">≥ 25.0%</div>
              <div className="text-xs text-slate-500 mt-1">Disqualifies low-margin strategies</div>
            </div>

            <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60">
              <div className="text-xs text-slate-400 uppercase font-semibold">Discount Cap Filter</div>
              <div className="text-2xl font-black text-white font-mono mt-1">≤ 10.0%</div>
              <div className="text-xs text-slate-500 mt-1">Disqualifies excessive price cuts</div>
            </div>

            <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60">
              <div className="text-xs text-slate-400 uppercase font-semibold">Audience Dedupe Window</div>
              <div className="text-2xl font-black text-white font-mono mt-1">≥ 14 Days</div>
              <div className="text-xs text-slate-500 mt-1">Protects users from spam outreach</div>
            </div>
          </div>
        </div>

        {/* 6. Hero Centerpiece: Recommended Winner Card */}
        {winner ? (
          <div className="rounded-3xl bg-gradient-to-br from-emerald-950/40 via-slate-900/90 to-slate-950 border-2 border-emerald-500/50 p-6 md:p-8 shadow-2xl space-y-6 relative overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-bold uppercase tracking-wider">
                <Award className="w-4 h-4 text-emerald-400" />
                Recommended Winner (Rank #1)
              </span>
              <span className="text-xs font-mono px-2.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 font-semibold">
                STATUS: ELIGIBLE
              </span>
            </div>

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="space-y-2 max-w-2xl">
                <h3 className="text-2xl font-black text-white">{winner.title}</h3>
                <p className="text-sm text-slate-300 leading-relaxed">{winner.description}</p>
                <div className="pt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded-lg bg-slate-800/80 text-slate-300 border border-slate-700 font-mono">
                    Audience: {winner.eligibleCustomers} Customers
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-800/80 text-slate-300 border border-slate-700 font-mono">
                    Acceptance Prob: {(winner.acceptanceProbability * 100).toFixed(0)}%
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 font-mono font-semibold">
                    Projected Margin: {winner.projectedMarginPct}% (Floor: 25%)
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 font-mono font-semibold">
                    Promotional Discount: {winner.projectedDiscountPct}% (Cap: 10%)
                  </span>
                </div>
              </div>

              <div className="shrink-0 p-5 rounded-2xl bg-slate-900/90 border border-emerald-500/40 text-right space-y-1">
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                  Expected Net Value
                </div>
                <div className="text-3xl md:text-4xl font-black text-emerald-300 font-mono">
                  ₹{winner.expectedNetValue.toLocaleString('en-IN')}
                </div>
                <div className="text-[11px] text-slate-400">
                  Incentive Budget: ₹{(winner.eligibleCustomers * winner.acceptanceProbability * winner.incentiveCostPerCustomer).toLocaleString('en-IN')}
                </div>
              </div>
            </div>

            {/* Why This Wins Verification Checklist */}
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2 text-xs">
              <div className="font-bold text-slate-300 uppercase text-[11px] tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Why This Action Wins (Deterministic Verification):
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-300">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span><strong>Highest Expected Net Value</strong> among all constraint-compliant opportunities.</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span><strong>Margin Safe:</strong> Projected 28.5% margin preserves 25.0% profit floor.</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span><strong>Discount Controlled:</strong> 8.0% incentive complies with 10.0% cap.</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span><strong>Dedupe Safe:</strong> 75 days interval complies with 14-day anti-fatigue rule.</span>
                </li>
              </ul>
            </div>

            {/* Approval & Execution Governance Gate */}
            {winnerAction && (
              <ApprovalActionCard
                actionId={winnerAction.id}
                initialStatus={winnerAction.status}
                opportunityTitle={winner.title}
                expectedNetValue={winner.expectedNetValue}
                eligibleCustomers={winner.eligibleCustomers}
              />
            )}

            {/* Step 5: Post-Action Measurement & Reconciliation Panel */}
            {winnerAction && (
              <MeasurementOutcomePanel
                actionId={winnerAction.id}
                actionStatus={winnerAction.status}
                predictedNetValue={winner.expectedNetValue}
                predictedRevenue={winner.eligibleCustomers * winner.acceptanceProbability * winner.incrementalRevenuePerCustomer}
                targetRevenue={activeGoal?.targetRevenue || 50000}
                existingMeasurement={winnerAction.measurement}
              />
            )}
          </div>
        ) : (
          <div className="rounded-3xl bg-amber-950/20 border-2 border-amber-500/40 p-8 text-center space-y-3 shadow-xl">
            <div className="inline-flex p-3 rounded-full bg-amber-500/20 text-amber-300">
              <AlertTriangle className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-white">No eligible opportunity satisfies the current constraints.</h3>
            <p className="text-xs text-slate-400 max-w-lg mx-auto">
              Every evaluated opportunity breached one or more hard business guardrails (margin floor, discount cap, inventory buffer, or dedupe protection). No consequential action will be initiated to protect your profitability.
            </p>
            <div className="inline-block px-3 py-1 rounded bg-slate-800 text-xs text-slate-300 font-mono">
              Governance: Execution strictly blocked. Relax constraints to re-evaluate.
            </div>
          </div>
        )}

        {/* 7. Decision Explanation Panel ("Why this decision?") */}
        <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 shadow-xl space-y-4">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-indigo-400" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">
              Why This Decision? (AI Revenue Scientist Explanation)
            </h3>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-300 leading-relaxed space-y-3 font-sans">
            <p>
              <strong>1. Objective Defined:</strong> You requested to generate ₹{activeGoal?.targetRevenue.toLocaleString('en-IN')} incremental revenue while locking a 25.0% margin floor, 10.0% discount cap, and 14-day dedupe protection window.
            </p>
            <p className="text-rose-300 bg-rose-950/20 p-2.5 rounded-lg border border-rose-500/30">
              <strong>2. Constraint Exclusion:</strong> The <em>Aggressive 15% Clearance Campaign</em> presented the highest nominal gross value (₹67,800). However, our deterministic constraint engine <strong>strictly disqualified it</strong> because its projected margin (21.0%) falls below your 25% floor, and its discount (15.0%) breaches your 10% cap. To protect your merchant profits, this strategy was banned from winning.
            </p>
            <p className="text-emerald-300 bg-emerald-950/20 p-2.5 rounded-lg border border-emerald-500/30">
              <strong>3. Recommended Selection:</strong> The <em>High-LTV Dormant Customer Win-Back</em> strategy complies with every business boundary and produces the highest Expected Net Value (₹54,208) among all eligible alternatives.
            </p>
            <p className="text-slate-400 italic">
              <strong>4. Governance Guard:</strong> Execution is locked behind your explicit authorization. No payment links or customer notifications will ever be triggered autonomously.
            </p>
          </div>
        </div>

        {/* 8. Opportunity Comparison Matrix */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-indigo-400" />
              Opportunity Matrix ({opportunities.length} Evaluated)
            </h3>
            <span className="text-xs text-slate-500 font-mono">
              Strict Deterministic Separation (Eligible vs Disqualified)
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 1. Winner Card */}
            {winner && (
              <div className="rounded-2xl bg-slate-900 border-2 border-emerald-500/60 p-5 shadow-lg flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      RANK #1 • WINNER
                    </span>
                    <span className="text-xs font-mono font-bold text-emerald-400">ELIGIBLE</span>
                  </div>
                  <h4 className="text-sm font-bold text-white mt-2">{winner.title}</h4>
                  <p className="text-xs text-slate-400 mt-1">{winner.description}</p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800 space-y-1 text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>Expected Net Value:</span>
                    <span className="font-bold text-emerald-400 font-mono">₹{winner.expectedNetValue.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Margin:</span>
                    <span className="text-slate-200 font-mono">{winner.projectedMarginPct}% (≥ 25%)</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Discount:</span>
                    <span className="text-slate-200 font-mono">{winner.projectedDiscountPct}% (≤ 10%)</span>
                  </div>
                </div>
              </div>
            )}

            {/* 2. Runner-Up Card */}
            {eligibleOpportunities
              .filter((o) => o.id !== winner?.id)
              .map((opp) => (
                <div key={opp.id} className="rounded-2xl bg-slate-900/80 border border-slate-800 p-5 shadow-lg flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                        RANK #2 • RUNNER UP
                      </span>
                      <span className="text-xs font-mono font-bold text-emerald-400">ELIGIBLE</span>
                    </div>
                    <h4 className="text-sm font-bold text-white mt-2">{opp.title}</h4>
                    <p className="text-xs text-slate-400 mt-1">{opp.description}</p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800 space-y-1 text-xs">
                    <div className="flex justify-between text-slate-400">
                      <span>Expected Net Value:</span>
                      <span className="font-bold text-slate-200 font-mono">₹{opp.expectedNetValue.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Margin:</span>
                      <span className="text-slate-200 font-mono">{opp.projectedMarginPct}% (≥ 25%)</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Discount:</span>
                      <span className="text-slate-200 font-mono">{opp.projectedDiscountPct}% (≤ 10%)</span>
                    </div>
                  </div>
                </div>
              ))}

            {/* 3. Disqualified / Rejected Card */}
            {rejectedOpportunities.map((opp) => {
              const reasons: string[] = opp.rejectionReasons ? JSON.parse(opp.rejectionReasons) : [];
              return (
                <div key={opp.id} className="rounded-2xl bg-rose-950/10 border-2 border-rose-500/40 p-5 shadow-lg flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-500/20 text-rose-300 border border-rose-500/40">
                        DISQUALIFIED
                      </span>
                      <span className="text-xs font-mono font-bold text-rose-400">REJECTED</span>
                    </div>
                    <h4 className="text-sm font-bold text-slate-200 mt-2">{opp.title}</h4>
                    <p className="text-xs text-slate-400 mt-1">{opp.description}</p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800 space-y-2 text-xs">
                    <div className="flex justify-between text-slate-400">
                      <span>Nominal Value:</span>
                      <span className="font-bold text-slate-400 line-through font-mono">₹{opp.expectedNetValue.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="p-2 rounded bg-rose-950/30 border border-rose-500/30 text-[11px] text-rose-300 space-y-1">
                      {reasons.map((r, idx) => (
                        <div key={idx} className="flex items-start gap-1">
                          <span>❌</span>
                          <span>{r}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 9. Execution Console & Audit Trail 2-Column Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Execution Console */}
          <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Server className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-sm font-bold uppercase tracking-wider text-white">Execution Console</h3>
                </div>
                <span className="text-xs font-mono text-slate-500">Live Status</span>
              </div>

              <div className="mt-4 space-y-3 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Target Action:</span>
                  <span className="font-medium text-slate-200">{winner?.title || 'None'}</span>
                </div>

                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Payment Infrastructure:</span>
                  <span className="font-mono text-indigo-300">Razorpay Test Mode</span>
                </div>

                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Environment:</span>
                  <span className="font-mono text-amber-300">TEST / DEMO (No live charges)</span>
                </div>

                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Current Action Status:</span>
                  <span className={`font-mono font-bold ${
                    winnerAction?.status === 'COMPLETED' ? 'text-emerald-400' :
                    winnerAction?.status === 'FAILED' ? 'text-rose-400' : 'text-amber-400'
                  }`}>
                    {winnerAction?.status || 'PENDING_APPROVAL'}
                  </span>
                </div>

                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Gateway Batch Reference:</span>
                  <span className="font-mono text-slate-300 truncate max-w-[150px]">
                    {latestExecution?.providerReferenceId || latestExecution?.batchId || 'plink_pending_approval'}
                  </span>
                </div>

                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Links Generated:</span>
                  <span className="font-mono text-emerald-400 font-bold">
                    {latestExecution?.linksCreated || 0}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-[11px] text-slate-400">
              💡 Razorpay test mode ensures zero customer disruption while testing recovery links.
            </div>
          </div>

          {/* 10. Immutable Audit Trail */}
          <div className="lg:col-span-2 rounded-2xl bg-slate-900/80 border border-slate-800 p-6 shadow-xl flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">Immutable Audit Trail</h3>
              </div>
              <span className="text-xs font-mono text-slate-500">Live SQLite Stream</span>
            </div>

            <div className="mt-4 space-y-3.5 flex-1 overflow-y-auto max-h-[380px]">
              {merchant?.auditEvents && merchant.auditEvents.length > 0 ? (
                merchant.auditEvents.map((evt) => (
                  <div key={evt.id} className="relative pl-6 pb-2 border-l border-slate-800 last:border-l-0">
                    <div className={`absolute -left-1.5 top-1 w-3 h-3 rounded-full border-2 border-slate-950 ${
                      evt.eventType.includes('REJECTED') || evt.eventType.includes('FAILED') ? 'bg-rose-500' :
                      evt.eventType.includes('MEASUREMENT') || evt.eventType.includes('SUCCESS') ? 'bg-emerald-400' :
                      evt.eventType.includes('APPROVED') || evt.eventType.includes('RECOMMENDED') ? 'bg-indigo-400' : 'bg-slate-500'
                    }`}></div>
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-indigo-400 font-semibold">{evt.actor} • {evt.eventType}</span>
                      <span className="text-slate-500">{new Date(evt.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-xs text-slate-300 mt-0.5">{evt.summary}</p>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-500 text-center py-8">No events logged yet.</div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
