'use client';

import React, { useState, useEffect } from 'react';
import { PositionTab } from './tabs/PositionTab';
import { PlanTab } from './tabs/PlanTab';
import { EventsTab } from './tabs/EventsTab';
import type { DecisionRecord } from '../lib/readLog';

const MOCK_SAVE: DecisionRecord[] = [
  { ts: Date.now() - 60000, userId: 'demo-save', kind: 'assess', hf: 1.3026, targetHF: 1.35, pLiq: 0.05 },
  { ts: Date.now() - 50000, userId: 'demo-save', kind: 'assess', hf: 1.2766, targetHF: 1.35, pLiq: 0.05 },
  { ts: Date.now() - 40000, userId: 'demo-save', kind: 'assess', hf: 1.2510, targetHF: 1.35, pLiq: 0.05 },
  { ts: Date.now() - 30000, userId: 'demo-save', kind: 'assess', hf: 1.2260, targetHF: 1.35, pLiq: 0.05 },
  { ts: Date.now() - 20000, userId: 'demo-save', kind: 'assess', hf: 1.2015, targetHF: 1.35, pLiq: 0.05 },
  { ts: Date.now() - 10000, userId: 'demo-save', kind: 'assess', hf: 1.1539, targetHF: 1.35, pLiq: 0.05 },
  { ts: Date.now() - 9500, userId: 'demo-save', kind: 'plan', hf: 1.1539, targetHF: 1.35, chosenSymbol: 'USDC', capitalBurned: 15.9 },
  {
    ts: Date.now() - 9000,
    userId: 'demo-save',
    kind: 'execute',
    hf: 1.1539,
    targetHF: 1.35,
    chosenSymbol: 'USDC',
    capitalBurned: 15.9,
    txHash: '0xc4d3661dfc67007659be0cacad89db84539027bcb60daf3985983dd4b16aa30c',
  },
];

const MOCK_REFUSE: DecisionRecord[] = [
  { ts: Date.now() - 30000, userId: 'demo-refuse', kind: 'assess', hf: 0.6188, targetHF: 1.35, pLiq: 0.001 },
  { ts: Date.now() - 20000, userId: 'demo-refuse', kind: 'assess', hf: 0.5942, targetHF: 1.35, pLiq: 0.001 },
  { ts: Date.now() - 10000, userId: 'demo-refuse', kind: 'assess', hf: 0.5824, targetHF: 1.35, pLiq: 0.001 },
  { ts: Date.now() - 9500, userId: 'demo-refuse', kind: 'plan', hf: 0.5824, targetHF: 1.35 },
  {
    ts: Date.now() - 9000,
    userId: 'demo-refuse',
    kind: 'refuse',
    hf: 0.5824,
    targetHF: 1.35,
    reason: 'intervention cost $21.11 exceeds expected loss $0.02 - theta 0',
  },
];

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<'position' | 'plan' | 'events'>('position');
  const [scenario, setScenario] = useState<'save' | 'refuse'>('save');
  const [records, setRecords] = useState<DecisionRecord[]>([]);
  const [live, setLive] = useState(false);

  // Prefer the real Part 1 + Part 2 decision log (produced by `pnpm
  // demo:real`, reading the live fork) when present; otherwise fall back
  // to the scripted mock scenario for the selected tab.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch('/api/decisions?scenario=real', { cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;
        if (data.live && data.records?.length > 0) {
          setRecords(data.records);
          setLive(true);
          return;
        }
      } catch {
        // fork/log not available -- fall through to mock
      }
      if (!cancelled) {
        setRecords(scenario === 'save' ? MOCK_SAVE : MOCK_REFUSE);
        setLive(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [scenario]);

  const latestAssess = [...records].reverse().find((r) => r.kind === 'assess');
  const currentHF = latestAssess?.hf ?? (scenario === 'save' ? 1.1539 : 0.5824);
  const targetHF = latestAssess?.targetHF ?? 1.35;

  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: 'position', label: 'Position' },
    { key: 'plan', label: 'Plan preview' },
    { key: 'events', label: 'Event log' },
  ];

  return (
    <main className="max-w-6xl mx-auto px-6 py-10 space-y-8 fade-up">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 pb-7 border-b border-white/[0.06]">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[26px] font-semibold tracking-tight text-white">
              Liquidation Shield
            </h1>
            <span className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider rounded-full text-cyan-300/90 border border-cyan-400/20 bg-cyan-400/[0.06]">
              CSI Origin 2026
            </span>
          </div>
          <p className="text-[13px] text-white/40 mt-2 max-w-lg leading-relaxed">
            Closed-loop control for leveraged Aave positions — sense, decide, act, operate.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="glass rounded-xl px-4 py-2.5 flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  live ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  live ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
            </span>
            <span className="text-[11px] font-medium text-white/70 tracking-wide">
              {live ? 'LIVE — on-chain data' : 'DEMO — scripted scenario'}
            </span>
          </div>
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 -mt-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-[13px] font-medium rounded-lg transition-all ${
              activeTab === t.key
                ? 'text-white bg-white/[0.06] border border-white/[0.08]'
                : 'text-white/40 hover:text-white/70 border border-transparent'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="pt-1">
        {activeTab === 'position' && (
          <PositionTab currentHF={currentHF} targetHF={targetHF} isSaveScenario={scenario === 'save'} />
        )}

        {activeTab === 'plan' && (
          <PlanTab
            latestRecord={records[records.length - 1]}
            records={records}
            isSaveScenario={scenario === 'save'}
          />
        )}

        {activeTab === 'events' && (
          <EventsTab records={records} activeScenario={scenario} onScenarioChange={setScenario} />
        )}
      </div>
    </main>
  );
}
