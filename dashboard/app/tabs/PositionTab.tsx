'use client';

import React from 'react';

interface PositionTabProps {
  currentHF: number;
  targetHF: number;
  isSaveScenario: boolean;
}

export function PositionTab({ currentHF, targetHF, isSaveScenario }: PositionTabProps) {
  const isSmallPos = !isSaveScenario;

  const collaterals = isSmallPos
    ? [{ symbol: 'WETH', amount: 0.1, priceUsd: 3000, lt: 0.825, kappa: 0.0105 }]
    : [
        { symbol: 'USDC', amount: 5000, priceUsd: 1, lt: 0.86, kappa: 0.0055 },
        { symbol: 'WETH', amount: 10, priceUsd: 3000, lt: 0.825, kappa: 0.0105 },
        { symbol: 'WBTC', amount: 0.5, priceUsd: 60000, lt: 0.78, kappa: 0.0125 },
        { symbol: 'wstETH', amount: 5, priceUsd: 3300, lt: 0.79, kappa: 0.0165 },
      ];

  const debts = isSmallPos
    ? [{ symbol: 'USDC', amount: 400, priceUsd: 1 }]
    : [{ symbol: 'USDC', amount: 19000, priceUsd: 1 }];

  const totalA = collaterals.reduce((sum, c) => sum + c.amount * c.priceUsd * c.lt, 0);
  const totalD = debts.reduce((sum, d) => sum + d.amount * d.priceUsd, 0);

  // SVG Gauge calculations (270 degree arc)
  const clampedHF = Math.min(Math.max(currentHF, 0.5), 2.0);
  // Map clampedHF (0.5 to 2.0) to angle (-225 to 45 deg)
  const angleDeg = -225 + ((clampedHF - 0.5) / 1.5) * 270;
  const angleRad = (angleDeg * Math.PI) / 180;
  const needleX = 100 + 65 * Math.cos(angleRad);
  const needleY = 100 + 65 * Math.sin(angleRad);

  const getStatusColor = (hf: number) => {
    if (hf < 1.0) return 'text-red-400 bg-red-950/50 border-red-500/30';
    if (hf < 1.20) return 'text-amber-400 bg-amber-950/50 border-amber-500/30';
    return 'text-emerald-400 bg-emerald-950/50 border-emerald-500/30';
  };

  const getStatusLabel = (hf: number) => {
    if (hf < 1.0) return 'LIQUIDATION IMMINENT';
    if (hf < 1.20) return 'TRIGGER BAND (SAFEGUARD ACTIVE)';
    return 'HEALTHY POSITION';
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Health Factor Gauge */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* SVG Arc Gauge */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 flex flex-col items-center justify-center shadow-lg relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 z-0" />
          <div className="relative z-10 w-full flex flex-col items-center">
            <h3 className="text-xs uppercase tracking-wider font-medium text-slate-400 mb-2">
              Health Factor Gauge
            </h3>

            <svg viewBox="0 0 200 180" className="w-52 h-44 drop-shadow">
              {/* Background Arc - Danger Zone (Red) */}
              <path
                d="M 29.29 170.71 A 80 80 0 0 1 20 100"
                fill="none"
                stroke="#ef4444"
                strokeWidth="16"
                strokeLinecap="round"
              />
              {/* Warning Zone (Yellow) */}
              <path
                d="M 20 100 A 80 80 0 0 1 53.14 43.43"
                fill="none"
                stroke="#f59e0b"
                strokeWidth="16"
              />
              {/* Safe Zone (Green) */}
              <path
                d="M 53.14 43.43 A 80 80 0 0 1 170.71 170.71"
                fill="none"
                stroke="#10b981"
                strokeWidth="16"
                strokeLinecap="round"
              />

              {/* Center Pivot */}
              <circle cx="100" cy="100" r="8" fill="#f8fafc" />

              {/* Needle */}
              <line
                x1="100"
                y1="100"
                x2={needleX}
                y2={needleY}
                stroke="#f8fafc"
                strokeWidth="4"
                strokeLinecap="round"
              />
            </svg>

            {/* Readout */}
            <div className="text-center mt-[-10px]">
              <span className="text-4xl font-extrabold tracking-tight text-white font-mono">
                {currentHF.toFixed(4)}
              </span>
              <div
                className={`mt-2 px-3 py-1 text-xs font-semibold rounded-full border ${getStatusColor(
                  currentHF
                )}`}
              >
                {getStatusLabel(currentHF)}
              </div>
            </div>
          </div>
        </div>

        {/* Aggregates Summary */}
        <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Risk Collateral (A)
            </span>
            <span className="text-2xl font-bold text-slate-100 font-mono">
              ${totalA.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </span>
            <span className="text-[11px] text-slate-500">Σ (Cᵢ × Pᵢ × LTᵢ)</span>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Total Debt (D)
            </span>
            <span className="text-2xl font-bold text-rose-400 font-mono">
              ${totalD.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </span>
            <span className="text-[11px] text-slate-500">Σ (Dⱼ × Pⱼ)</span>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Target HF (Hₜ)
            </span>
            <span className="text-2xl font-bold text-cyan-400 font-mono">
              {targetHF.toFixed(2)}
            </span>
            <span className="text-[11px] text-slate-500">Optimal Restructure</span>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Trigger Band
            </span>
            <span className="text-2xl font-bold text-amber-400 font-mono">&lt; 1.20</span>
            <span className="text-[11px] text-slate-500">Proactive Intervention</span>
          </div>
        </div>
      </div>

      {/* Position Breakdown Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Collateral Table */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            Collateral Supply
          </h3>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-800/60 text-slate-400 uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="p-2.5 rounded-l">Asset</th>
                  <th className="p-2.5">Amount</th>
                  <th className="p-2.5">Price</th>
                  <th className="p-2.5">Value (USD)</th>
                  <th className="p-2.5 rounded-r">LT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {collaterals.map((c, idx) => {
                  const valUsd = c.amount * c.priceUsd;
                  return (
                    <tr key={idx} className="hover:bg-slate-800/30 transition-colors">
                      <td className="p-2.5 font-bold text-emerald-400">{c.symbol}</td>
                      <td className="p-2.5 text-slate-300">{c.amount}</td>
                      <td className="p-2.5 text-slate-300">${c.priceUsd.toLocaleString()}</td>
                      <td className="p-2.5 text-slate-100 font-semibold">
                        ${valUsd.toLocaleString()}
                      </td>
                      <td className="p-2.5 text-slate-400">{c.lt}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Debt Table */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            Borrowed Debt
          </h3>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-800/60 text-slate-400 uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="p-2.5 rounded-l">Asset</th>
                  <th className="p-2.5">Amount</th>
                  <th className="p-2.5">Price</th>
                  <th className="p-2.5 rounded-r">Value (USD)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {debts.map((d, idx) => {
                  const valUsd = d.amount * d.priceUsd;
                  return (
                    <tr key={idx} className="hover:bg-slate-800/30 transition-colors">
                      <td className="p-2.5 font-bold text-rose-400">{d.symbol}</td>
                      <td className="p-2.5 text-slate-300">{d.amount.toLocaleString()}</td>
                      <td className="p-2.5 text-slate-300">${d.priceUsd}</td>
                      <td className="p-2.5 text-slate-100 font-semibold">
                        ${valUsd.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
