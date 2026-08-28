'use client';

import { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { MobileNav } from './components/MobileNav';
import { TopBar } from './components/TopBar';
import { OverviewView } from './views/OverviewView';
import { PlanView } from './views/PlanView';
import { AuditView } from './views/AuditView';
import type { ViewKey } from './types';
import type { DecisionRecord } from '../lib/readLog';

const MOCK_SAVE: DecisionRecord[] = [
  { ts: Date.now() - 60000, userId: 'demo-save', kind: 'assess', hf: 1.3026, targetHF: 1.35, pLiq: 0.05 },
  { ts: Date.now() - 50000, userId: 'demo-save', kind: 'assess', hf: 1.2766, targetHF: 1.35, pLiq: 0.05 },
  { ts: Date.now() - 40000, userId: 'demo-save', kind: 'assess', hf: 1.251, targetHF: 1.35, pLiq: 0.05 },
  { ts: Date.now() - 30000, userId: 'demo-save', kind: 'assess', hf: 1.226, targetHF: 1.35, pLiq: 0.05 },
  { ts: Date.now() - 20000, userId: 'demo-save', kind: 'assess', hf: 1.2015, targetHF: 1.35, pLiq: 0.05 },
  { ts: Date.now() - 10000, userId: 'demo-save', kind: 'assess', hf: 1.1539, targetHF: 1.35, pLiq: 0.05 },
  {
    ts: Date.now() - 9500,
    userId: 'demo-save',
    kind: 'plan',
    hf: 1.1539,
    targetHF: 1.35,
    chosenSymbol: 'USDC',
    capitalBurned: 15.9,
  },
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
  const [view, setView] = useState<ViewKey>('overview');
  const [scenario, setScenario] = useState<'save' | 'refuse'>('save');
  const [records, setRecords] = useState<DecisionRecord[]>(MOCK_SAVE);
  const [live, setLive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

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
          setUpdatedAt(Date.now());
          return;
        }
      } catch {
        // backend unreachable -- fall through to the scripted demo scenario
      }
      if (!cancelled) {
        setRecords(scenario === 'save' ? MOCK_SAVE : MOCK_REFUSE);
        setLive(false);
        setUpdatedAt(Date.now());
      }
    }

    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [scenario]);

  const latestAssess = [...records].reverse().find((r) => r.kind === 'assess');
  const currentHF = latestAssess?.hf ?? (scenario === 'save' ? 1.1539 : 0.5824);
  const targetHF = latestAssess?.targetHF ?? 1.35;
  const compact = !live && scenario === 'refuse';

  const titles: Record<ViewKey, { title: string; subtitle: string }> = {
    overview: { title: 'Overview', subtitle: 'Position health, sensed and forecast in real time' },
    plan: { title: 'Intervention plan', subtitle: 'Minimum-cost deleverage sizing and viability gate' },
    audit: { title: 'Audit trail', subtitle: 'Every assess → plan → execute/refuse decision, logged' },
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-shell">
      <Sidebar active={view} onSelect={setView} live={live} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav active={view} onSelect={setView} />
        <TopBar
          title={titles[view].title}
          subtitle={titles[view].subtitle}
          live={live}
          scenario={scenario}
          onScenarioChange={setScenario}
          updatedAt={updatedAt}
        />
        <main className="flex-1">
          {view === 'overview' && <OverviewView currentHF={currentHF} targetHF={targetHF} compact={compact} />}
          {view === 'plan' && <PlanView records={records} />}
          {view === 'audit' && <AuditView records={records} />}
        </main>
      </div>
    </div>
  );
}
