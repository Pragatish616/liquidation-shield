'use client';

import { useEffect, useState } from 'react';

const MIN_HF = 0.85;
const MAX_HF = 1.6;
const SIZE = 208;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function bandColor(hf: number): string {
  if (hf < 1.0) return '#F0475E';
  if (hf < 1.2) return '#F5A524';
  return '#2FD97C';
}

function bandLabel(hf: number): string {
  if (hf < 1.0) return 'Liquidatable';
  if (hf < 1.2) return 'Trigger band';
  return 'Healthy';
}

export function HFGauge({ hf, targetHF }: { hf: number; targetHF: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const clamped = Math.min(Math.max(hf, MIN_HF), MAX_HF);
  const fraction = (clamped - MIN_HF) / (MAX_HF - MIN_HF);
  const filled = mounted ? fraction * CIRCUMFERENCE : 0;
  const color = bandColor(hf);

  const targetClamped = Math.min(Math.max(targetHF, MIN_HF), MAX_HF);
  const targetFraction = (targetClamped - MIN_HF) / (MAX_HF - MIN_HF);
  const targetAngle = targetFraction * 360 - 90;

  return (
    <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} className="-rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} stroke="#1b1f27" strokeWidth={STROKE} fill="none" />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          stroke={color}
          strokeWidth={STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          strokeDashoffset={CIRCUMFERENCE - filled}
          className="transition-[stroke-dashoffset,stroke] duration-1000 ease-out"
        />
      </svg>

      <div className="absolute inset-0" style={{ transform: `rotate(${targetAngle}deg)` }} aria-hidden>
        <div className="absolute left-1/2 top-0 h-3 w-[2px] -translate-x-1/2 rounded-full bg-paper-100/60" />
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
        <span className="tabular text-[2.65rem] font-semibold leading-none tracking-tight text-paper-100">
          {hf.toFixed(3)}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color }}>
          {bandLabel(hf)}
        </span>
      </div>
    </div>
  );
}
