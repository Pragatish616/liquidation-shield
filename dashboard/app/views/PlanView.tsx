import { CheckCircle, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import type { DecisionRecord } from '../../lib/readLog';

const CANDIDATES = [
  { symbol: 'USDC', kappa: 0.0055, vReq: 1865.08, capitalBurned: 10.26 },
  { symbol: 'WETH', kappa: 0.0105, vReq: 1761.86, capitalBurned: 18.5 },
  { symbol: 'WBTC', kappa: 0.0125, vReq: 1627.12, capitalBurned: 20.34 },
  { symbol: 'wstETH', kappa: 0.0165, vReq: 1674.0, capitalBurned: 27.62 },
];

export function PlanView({ records }: { records: DecisionRecord[] }) {
  const execRecord = [...records].reverse().find((r) => r.kind === 'execute');
  const refuseRecord = [...records].reverse().find((r) => r.kind === 'refuse');
  const planRecord = [...records].reverse().find((r) => r.kind === 'plan');

  const isExecuted = !!execRecord;
  const chosenSymbol = execRecord?.chosenSymbol ?? planRecord?.chosenSymbol ?? 'USDC';

  return (
    <div className="flex flex-col gap-6 px-6 py-6 lg:px-8">
      <div className="panel rounded-panel px-6 py-6">
        <div className="flex flex-col gap-4 border-b border-white/[0.06] pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-paper-500">
              Intervention status
            </span>
            <div className="mt-1.5 flex items-center gap-2.5">
              {isExecuted ? (
                <CheckCircle size={20} weight="fill" className="text-safe" />
              ) : (
                <WarningCircle size={20} weight="fill" className="text-danger" />
              )}
              <h2 className="text-[17px] font-semibold text-paper-100">
                {isExecuted ? 'Flash-loan deleverage executed' : 'Intervention refused'}
              </h2>
            </div>
          </div>
          <span
            className={`w-fit rounded-full px-3 py-1 text-[11px] font-semibold ${
              isExecuted ? 'bg-safe/15 text-safe' : 'bg-danger/15 text-danger'
            }`}
          >
            {isExecuted ? 'EXECUTE' : 'HOLD'}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <PlanStat
            label="E[loss | no action]"
            value={isExecuted ? '$475.00' : '$0.02'}
            caption={isExecuted ? '50% debt seized @ 5% bonus' : 'counterfactual estimate'}
            tone="danger"
          />
          <PlanStat
            label="E[loss | action]"
            value={isExecuted ? '$15.90' : '$21.01'}
            caption="capital burned + gas"
            tone="warn"
          />
          <PlanStat
            label="Net preserved"
            value={isExecuted ? '+$459.10' : '−$20.99'}
            caption="E_no_action − E_action > θ"
            tone={isExecuted ? 'safe' : 'danger'}
          />
        </div>

        {!isExecuted && refuseRecord?.reason && (
          <div className="mt-5 flex items-start gap-3 rounded-control border border-danger/20 bg-danger/[0.06] px-4 py-3">
            <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-danger" />
            <p className="text-[12.5px] leading-relaxed text-paper-300">{refuseRecord.reason}</p>
          </div>
        )}
      </div>

      <div className="panel rounded-panel px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-paper-100">
            Ranked collateral selection — argmin Vⱼ · κⱼ
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-[0.05em] text-paper-500">
                <th className="pb-2 font-medium">Rank</th>
                <th className="pb-2 font-medium">Collateral</th>
                <th className="pb-2 font-medium">Route cost (κ)</th>
                <th className="pb-2 font-medium">V released</th>
                <th className="pb-2 font-medium">Capital burned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {CANDIDATES.map((c, i) => {
                const chosen = isExecuted && c.symbol === chosenSymbol;
                return (
                  <tr key={c.symbol} className={chosen ? 'bg-signal/[0.06]' : undefined}>
                    <td className="py-2.5 text-paper-500">#{i + 1}</td>
                    <td className="py-2.5">
                      <span className="font-medium text-paper-100">{c.symbol}</span>
                      {chosen && (
                        <span className="ml-2 rounded-full bg-signal/15 px-2 py-0.5 text-[10px] font-semibold text-signal">
                          CHOSEN
                        </span>
                      )}
                    </td>
                    <td className="tabular py-2.5 text-paper-300">{(c.kappa * 100).toFixed(2)}%</td>
                    <td className="tabular py-2.5 text-paper-300">${c.vReq.toLocaleString()}</td>
                    <td className="tabular py-2.5 font-medium text-paper-100">${c.capitalBurned.toFixed(2)}</td>
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

function PlanStat({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: string;
  caption: string;
  tone: 'danger' | 'warn' | 'safe';
}) {
  const toneClass = { danger: 'text-danger', warn: 'text-warn', safe: 'text-safe' }[tone];
  return (
    <div className="rounded-control border border-white/[0.06] bg-white/[0.015] px-4 py-3.5">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.05em] text-paper-500">{label}</span>
      <div className={`tabular mt-1 text-[1.15rem] font-semibold ${toneClass}`}>{value}</div>
      <span className="text-[11px] text-paper-500">{caption}</span>
    </div>
  );
}
