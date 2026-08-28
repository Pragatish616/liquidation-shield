'use client';

import { ShieldCheck, Gauge, ClipboardText, ClockCounterClockwise } from '@phosphor-icons/react';
import type { ViewKey } from '../types';

const NAV: { key: ViewKey; label: string; icon: typeof Gauge }[] = [
  { key: 'overview', label: 'Overview', icon: Gauge },
  { key: 'plan', label: 'Plan', icon: ClipboardText },
  { key: 'audit', label: 'Audit', icon: ClockCounterClockwise },
];

export function MobileNav({ active, onSelect }: { active: ViewKey; onSelect: (v: ViewKey) => void }) {
  return (
    <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3 lg:hidden">
      <div className="flex items-center gap-2">
        <ShieldCheck size={19} weight="fill" className="text-signal" />
        <span className="text-[13.5px] font-semibold tracking-tight text-paper-100">Liquidation Shield</span>
      </div>
      <nav className="flex items-center gap-1">
        {NAV.map(({ key, label, icon: Icon }) => {
          const isActive = key === active;
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-1.5 rounded-control px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
                isActive ? 'bg-white/[0.07] text-paper-100' : 'text-paper-500'
              }`}
            >
              <Icon size={15} weight={isActive ? 'fill' : 'regular'} />
              {label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
