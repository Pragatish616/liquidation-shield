'use client';

import { ShieldCheck, Gauge, ClipboardText, ClockCounterClockwise } from '@phosphor-icons/react';
import type { ViewKey } from '../types';

const NAV: { key: ViewKey; label: string; icon: typeof Gauge }[] = [
  { key: 'overview', label: 'Overview', icon: Gauge },
  { key: 'plan', label: 'Intervention plan', icon: ClipboardText },
  { key: 'audit', label: 'Audit trail', icon: ClockCounterClockwise },
];

export function Sidebar({
  active,
  onSelect,
  live,
}: {
  active: ViewKey;
  onSelect: (v: ViewKey) => void;
  live: boolean;
}) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col justify-between border-r border-white/[0.07] px-4 py-6 lg:flex">
      <div className="flex flex-col gap-8">
        <div className="flex items-center gap-2.5 px-2">
          <ShieldCheck size={22} weight="fill" className="text-signal" />
          <span className="text-[15px] font-semibold tracking-tight text-paper-100">Liquidation Shield</span>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV.map(({ key, label, icon: Icon }) => {
            const isActive = key === active;
            return (
              <button
                key={key}
                onClick={() => onSelect(key)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-control px-3 py-2.5 text-[13.5px] font-medium transition-colors ${
                  isActive
                    ? 'bg-white/[0.06] text-paper-100'
                    : 'text-paper-500 hover:bg-white/[0.03] hover:text-paper-300'
                }`}
              >
                <Icon size={17} weight={isActive ? 'fill' : 'regular'} />
                {label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-2 rounded-control border border-white/[0.06] px-3 py-2.5">
        <span className="relative flex h-1.5 w-1.5">
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
              live ? 'bg-safe' : 'bg-warn'
            }`}
          />
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${live ? 'bg-safe' : 'bg-warn'}`} />
        </span>
        <span className="text-[11.5px] font-medium text-paper-500">
          {live ? 'Live simulation' : 'Demo data'}
        </span>
      </div>
    </aside>
  );
}
