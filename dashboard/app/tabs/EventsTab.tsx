'use client';

import React from 'react';
import type { DecisionRecord } from '../../lib/readLog';

interface EventsTabProps {
  records: DecisionRecord[];
  activeScenario: 'save' | 'refuse';
  onScenarioChange: (scenario: 'save' | 'refuse') => void;
}

export function EventsTab({ records, activeScenario, onScenarioChange }: EventsTabProps) {
  const reversedRecords = [...records].reverse();

  const getKindBadge = (kind: string) => {
    switch (kind) {
      case 'execute':
        return 'bg-emerald-950/80 text-emerald-400 border-emerald-500/40';
      case 'refuse':
        return 'bg-rose-950/80 text-rose-400 border-rose-500/40';
      case 'plan':
        return 'bg-purple-950/80 text-purple-400 border-purple-500/40';
      case 'assess':
        return 'bg-sky-950/80 text-sky-400 border-sky-500/40';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  const formatTxHash = (hash?: string) => {
    if (!hash) return null;
    return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
  };

  return (
    <div className="space-y-6">
      {/* Header & Scenario Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div>
          <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-400" />
            Decision Audit Trail (JSON Lines Feed)
          </h3>
          <p className="text-xs text-slate-400 mt-0.5 font-mono">
            {records.length} records parsed from decision log
          </p>
        </div>

        {/* Scenario Toggle */}
        <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => onScenarioChange('save')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeScenario === 'save'
                ? 'bg-emerald-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Demo 01 (Save)
          </button>
          <button
            onClick={() => onScenarioChange('refuse')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
              activeScenario === 'refuse'
                ? 'bg-rose-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Demo 02 (Refuse)
          </button>
        </div>
      </div>

      {/* Audit Log Feed */}
      {reversedRecords.length === 0 ? (
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-12 text-center text-slate-400">
          <p className="text-sm">No decision records logged yet.</p>
          <p className="text-xs text-slate-500 mt-1 font-mono">
            Run <code className="text-cyan-400">pnpm demo:save</code> from backend to generate logs.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reversedRecords.map((rec, idx) => {
            const dateStr = new Date(rec.ts).toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              fractionalSecondDigits: 3,
            });

            return (
              <div
                key={idx}
                className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-4 transition-colors hover:border-slate-700 shadow-md font-mono text-xs"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/60 pb-2 mb-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-2.5 py-0.5 text-[10px] font-extrabold uppercase rounded border ${getKindBadge(
                        rec.kind
                      )}`}
                    >
                      {rec.kind}
                    </span>
                    <span className="text-slate-400 font-semibold">{rec.userId}</span>
                  </div>

                  <span className="text-slate-500 text-[11px]">{dateStr}</span>
                </div>

                {/* Event Record Details */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-slate-300">
                  {rec.hf !== undefined && (
                    <div>
                      <span className="text-slate-500 block text-[10px] uppercase">
                        Health Factor
                      </span>
                      <span className="font-bold text-slate-100">{rec.hf.toFixed(4)}</span>
                    </div>
                  )}

                  {rec.chosenSymbol && (
                    <div>
                      <span className="text-slate-500 block text-[10px] uppercase">
                        Chosen Asset
                      </span>
                      <span className="font-bold text-emerald-400">{rec.chosenSymbol}</span>
                    </div>
                  )}

                  {rec.capitalBurned !== undefined && (
                    <div>
                      <span className="text-slate-500 block text-[10px] uppercase">
                        Capital Burned
                      </span>
                      <span className="font-bold text-amber-400">
                        ${rec.capitalBurned.toFixed(2)}
                      </span>
                    </div>
                  )}

                  {rec.txHash && (
                    <div className="sm:col-span-3 bg-slate-950 p-2.5 rounded border border-slate-800/80 mt-1">
                      <span className="text-slate-500 block text-[10px] uppercase">
                        Mock Transaction Hash
                      </span>
                      <span className="font-bold text-emerald-400 select-all font-mono">
                        {rec.txHash}
                      </span>
                    </div>
                  )}

                  {rec.reason && (
                    <div className="sm:col-span-3 bg-rose-950/20 p-2.5 rounded border border-rose-500/20 mt-1 text-rose-300">
                      <span className="text-rose-400 font-bold block text-[10px] uppercase">
                        Refusal Reason / Invariant
                      </span>
                      <span>{rec.reason}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
