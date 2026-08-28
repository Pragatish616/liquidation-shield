'use client';

import React, { useState, useEffect } from 'react';
import { PositionTab } from './tabs/PositionTab';
import { PlanTab } from './tabs/PlanTab';
import { EventsTab } from './tabs/EventsTab';
import type { DecisionRecord } from '../lib/readLog';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<'position' | 'plan' | 'events'>('position');
  const [scenario, setScenario] = useState<'save' | 'refuse'>('save');
  const [records, setRecords] = useState<DecisionRecord[]>([]);

  // Simulated live fetch / load based on selected scenario
  useEffect(() => {
    // Mock records matching L5 scenarios if file reading in browser
    if (scenario === 'save') {
      const mockSaveRecords: DecisionRecord[] = [
        { ts: Date.now() - 60000, userId: 'demo-save', kind: 'assess', hf: 1.3026, targetHF: 1.35, pLiq: 0.05 },
        { ts: Date.now() - 50000, userId: 'demo-save', kind: 'assess', hf: 1.2766, targetHF: 1.35, pLiq: 0.05 },
        { ts: Date.now() - 40000, userId: 'demo-save', kind: 'assess', hf: 1.2510, targetHF: 1.35, pLiq: 0.05 },
        { ts: Date.now() - 30000, userId: 'demo-save', kind: 'assess', hf: 1.2260, targetHF: 1.35, pLiq: 0.05 },
        { ts: Date.now() - 20000, userId: 'demo-save', kind: 'assess', hf: 1.2015, targetHF: 1.35, pLiq: 0.05 },
        { ts: Date.now() - 10000, userId: 'demo-save', kind: 'assess', hf: 1.1539, targetHF: 1.35, pLiq: 0.05 },
        {
          ts: Date.now() - 9500,
          userId: 'demo-save',
          kind: 'plan',
          hf: 1.1539,
          targetHF: 1.35,
          chosenSymbol: 'USDC',
          capitalBurned: 15.90,
        },
        {
          ts: Date.now() - 9000,
          userId: 'demo-save',
          kind: 'execute',
          hf: 1.1539,
          targetHF: 1.35,
          chosenSymbol: 'USDC',
          capitalBurned: 15.90,
          txHash: '0xc4d3661dfc67007659be0cacad89db84539027bcb60daf3985983dd4b16aa30c',
        },
      ];
      setRecords(mockSaveRecords);
    } else {
      const mockRefuseRecords: DecisionRecord[] = [
        { ts: Date.now() - 30000, userId: 'demo-refuse', kind: 'assess', hf: 0.6188, targetHF: 1.35, pLiq: 0.001 },
        { ts: Date.now() - 20000, userId: 'demo-refuse', kind: 'assess', hf: 0.5942, targetHF: 1.35, pLiq: 0.001 },
        { ts: Date.now() - 10000, userId: 'demo-refuse', kind: 'assess', hf: 0.5824, targetHF: 1.35, pLiq: 0.001 },
        {
          ts: Date.now() - 9500,
          userId: 'demo-refuse',
          kind: 'plan',
          hf: 0.5824,
          targetHF: 1.35,
        },
        {
          ts: Date.now() - 9000,
          userId: 'demo-refuse',
          kind: 'refuse',
          hf: 0.5824,
          targetHF: 1.35,
          reason: 'intervention cost $21.11 exceeds expected loss $0.02 - theta 0',
        },
      ];
      setRecords(mockRefuseRecords);
    }
  }, [scenario]);

  const latestAssess = [...records].reverse().find((r) => r.kind === 'assess');
  const currentHF = latestAssess?.hf ?? (scenario === 'save' ? 1.1539 : 0.5824);
  const targetHF = 1.35;

  return (
    <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight text-white">
              AUTOMATED LIQUIDATION SHIELD
            </h1>
            <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase rounded-full bg-cyan-950 text-cyan-400 border border-cyan-500/30">
              CSI ORIGIN 2026
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Part 4 (OPERATE) — Closed-Loop Control System &amp; Minimum-Intervention Solver
          </p>
        </div>

        {/* Live Keeper Status Indicator */}
        <div className="flex items-center gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg px-3.5 py-2 flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <span className="text-xs font-mono font-semibold text-slate-300">
              KEEPER ACTIVE (12s CADENCE)
            </span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-800 space-x-1">
        <button
          onClick={() => setActiveTab('position')}
          className={`px-5 py-3 text-xs font-bold transition-all border-b-2 ${
            activeTab === 'position'
              ? 'border-cyan-400 text-cyan-400 bg-slate-900/50'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Position
        </button>
        <button
          onClick={() => setActiveTab('plan')}
          className={`px-5 py-3 text-xs font-bold transition-all border-b-2 ${
            activeTab === 'plan'
              ? 'border-cyan-400 text-cyan-400 bg-slate-900/50'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Plan preview
        </button>
        <button
          onClick={() => setActiveTab('events')}
          className={`px-5 py-3 text-xs font-bold transition-all border-b-2 ${
            activeTab === 'events'
              ? 'border-cyan-400 text-cyan-400 bg-slate-900/50'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Event log
        </button>
      </div>

      {/* Tab Content */}
      <div className="pt-2">
        {activeTab === 'position' && (
          <PositionTab
            currentHF={currentHF}
            targetHF={targetHF}
            isSaveScenario={scenario === 'save'}
          />
        )}

        {activeTab === 'plan' && (
          <PlanTab
            latestRecord={records[records.length - 1]}
            records={records}
            isSaveScenario={scenario === 'save'}
          />
        )}

        {activeTab === 'events' && (
          <EventsTab
            records={records}
            activeScenario={scenario}
            onScenarioChange={setScenario}
          />
        )}
      </div>
    </main>
  );
}
