'use client';

import React from 'react';
import type { DecisionRecord } from '../../lib/readLog';

interface PlanTabProps {
  latestRecord?: DecisionRecord;
  records: DecisionRecord[];
  isSaveScenario: boolean;
}

export function PlanTab({ latestRecord, records, isSaveScenario }: PlanTabProps) {
  const execRecord = records.find((r) => r.kind === 'execute');
  const refuseRecord = records.find((r) => r.kind === 'refuse');
  const planRecord = records.find((r) => r.kind === 'plan');

  const isExecuted = isSaveScenario && !!execRecord;

  // Ranked collateral table data derived from OVERVIEW §5 / L3 planner
  const candidates = [
    { symbol: 'USDC', kappa: 0.0055, vReq: 1865.08, capitalBurned: 10.26, feasible: true },
    { symbol: 'WETH', kappa: 0.0105, vReq: 1761.86, capitalBurned: 18.50, feasible: true },
    { symbol: 'WBTC', kappa: 0.0125, vReq: 1627.12, capitalBurned: 20.34, feasible: true },
    { symbol: 'wstETH', kappa: 0.0165, vReq: 1674.00, capitalBurned: 27.62, feasible: true },
  ];

  const chosenSymbol = execRecord?.chosenSymbol ?? planRecord?.chosenSymbol ?? 'USDC';

  return (
    <div className="space-y-6">
      {/* Verdict & Viability Header Card */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 shadow-lg relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Intervention Plan Status
            </span>
            <div className="flex items-center gap-3 mt-1">
              <h2 className="text-2xl font-extrabold text-slate-100">
                {isExecuted ? 'MODE2_FLASH (Deleverage via Flash Loan)' : 'HOLD (Intervention Refused)'}
              </h2>
              <span
                className={`px-2.5 py-0.5 text-xs font-bold rounded-full ${
                  isExecuted
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                    : 'bg-rose-950 text-rose-400 border border-rose-500/30'
                }`}
              >
                {isExecuted ? 'EXECUTE' : 'REFUSE'}
              </span>
            </div>
          </div>

          <div className="text-right font-mono">
            <span className="text-xs text-slate-400 block">Target HF Setpoint</span>
            <span className="text-xl font-bold text-cyan-400">1.35</span>
          </div>
        </div>

        {/* Viability Arithmetic Breakdown */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">
          <div className="bg-slate-950/60 p-4 rounded-lg border border-slate-800">
            <span className="text-[11px] font-medium text-slate-400 uppercase block">
              E[loss | no action]
            </span>
            <span className="text-xl font-bold text-rose-400 font-mono mt-1 block">
              {isExecuted ? '$475.00 ($23.75 weighted)' : '$0.02 (counterfactual)'}
            </span>
            <span className="text-[10px] text-slate-500 block mt-1">
              {isExecuted ? '50% debt seized @ 5% bonus' : 'Low P(liq) & small position'}
            </span>
          </div>

          <div className="bg-slate-950/60 p-4 rounded-lg border border-slate-800">
            <span className="text-[11px] font-medium text-slate-400 uppercase block">
              E[loss | action]
            </span>
            <span className="text-xl font-bold text-amber-400 font-mono mt-1 block">
              {isExecuted ? '$15.90 ($10.90 burn + $5 gas)' : '$21.01 ($6.01 burn + $15 gas)'}
            </span>
            <span className="text-[10px] text-slate-500 block mt-1">
              Capital burned + Gas USD
            </span>
          </div>

          <div className="bg-slate-950/60 p-4 rounded-lg border border-slate-800">
            <span className="text-[11px] font-medium text-slate-400 uppercase block">
              Net Preserved Benefit
            </span>
            <span
              className={`text-xl font-bold font-mono mt-1 block ${
                isExecuted ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {isExecuted ? '+$459.10 ($2.85 weighted)' : '-$20.99 (Negative Benefit)'}
            </span>
            <span className="text-[10px] text-slate-500 block mt-1">
              E_no_action - E_action &gt; θ
            </span>
          </div>
        </div>

        {/* Refusal Reason Callout (if HOLD) */}
        {!isExecuted && refuseRecord && (
          <div className="mt-5 p-4 rounded-lg bg-rose-950/30 border border-rose-500/30 text-xs text-rose-300 font-mono flex items-start gap-3">
            <span className="text-rose-400 font-bold text-base">⚠️</span>
            <div>
              <span className="font-bold block uppercase text-[10px] text-rose-400 tracking-wider">
                Refusal Arithmetic Reason
              </span>
              <p className="mt-1">{refuseRecord.reason}</p>
            </div>
          </div>
        )}
      </div>

      {/* Ranked Collateral Candidates Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 space-y-4 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-200 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            Ranked Collateral Selection Solver (argmin Vⱼ · κⱼ)
          </h3>
          <span className="text-xs text-slate-400 font-mono">
            Optimized via Minimum-Intervention Math
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-800/70 text-slate-400 uppercase text-[10px] tracking-wider">
              <tr>
                <th className="p-3 rounded-l">Rank</th>
                <th className="p-3">Collateral</th>
                <th className="p-3">Route Cost (κ)</th>
                <th className="p-3">V (USD Released)</th>
                <th className="p-3">Capital Burned (V · κ)</th>
                <th className="p-3 rounded-r">Feasibility</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {candidates.map((cand, idx) => {
                const isChosen = cand.symbol === chosenSymbol && isExecuted;
                return (
                  <tr
                    key={idx}
                    className={`transition-colors ${
                      isChosen
                        ? 'bg-emerald-950/40 border-l-4 border-l-emerald-400 font-semibold'
                        : 'hover:bg-slate-800/30'
                    }`}
                  >
                    <td className="p-3 text-slate-400">#{idx + 1}</td>
                    <td className="p-3 flex items-center gap-2">
                      <span className="font-bold text-slate-100">{cand.symbol}</span>
                      {isChosen && (
                        <span className="px-2 py-0.5 text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded">
                          CHOSEN OPTIMAL
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-slate-300">{(cand.kappa * 100).toFixed(2)}%</td>
                    <td className="p-3 text-slate-200">${cand.vReq.toLocaleString()}</td>
                    <td
                      className={`p-3 font-bold ${
                        isChosen ? 'text-emerald-400' : 'text-slate-300'
                      }`}
                    >
                      ${cand.capitalBurned.toFixed(2)}
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 text-[10px] font-bold text-emerald-400 bg-emerald-950/50 rounded">
                        FEASIBLE (Hₜ(1-κ) &gt; LT)
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
