import { HFGauge } from '../components/HFGauge';
import { MetricCard } from '../components/MetricCard';

interface Leg {
  symbol: string;
  amount: number;
  priceUsd: number;
  lt?: number;
}

const COLLATERAL_SMALL: Leg[] = [{ symbol: 'WETH', amount: 0.1, priceUsd: 3000, lt: 0.825 }];
const COLLATERAL_MULTI: Leg[] = [
  { symbol: 'USDC', amount: 5000, priceUsd: 1, lt: 0.86 },
  { symbol: 'WETH', amount: 10, priceUsd: 3000, lt: 0.825 },
  { symbol: 'WBTC', amount: 0.5, priceUsd: 60000, lt: 0.78 },
  { symbol: 'wstETH', amount: 5, priceUsd: 3300, lt: 0.79 },
];
const DEBT_SMALL: Leg[] = [{ symbol: 'USDC', amount: 400, priceUsd: 1 }];
const DEBT_MULTI: Leg[] = [{ symbol: 'USDC', amount: 19000, priceUsd: 1 }];

export function OverviewView({
  currentHF,
  targetHF,
  compact,
}: {
  currentHF: number;
  targetHF: number;
  compact: boolean;
}) {
  const collaterals = compact ? COLLATERAL_SMALL : COLLATERAL_MULTI;
  const debts = compact ? DEBT_SMALL : DEBT_MULTI;

  const totalA = collaterals.reduce((sum, c) => sum + c.amount * c.priceUsd * (c.lt ?? 0), 0);
  const totalD = debts.reduce((sum, d) => sum + d.amount * d.priceUsd, 0);

  return (
    <div className="flex flex-col gap-6 px-6 py-6 lg:px-8">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[auto_1fr]">
        <div className="panel flex items-center justify-center rounded-panel px-8 py-8">
          <HFGauge hf={currentHF} targetHF={targetHF} />
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard label="Risk collateral (A)" value={`$${totalA.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} caption="Σ Cᵢ · Pᵢ · LTᵢ" />
          <MetricCard label="Total debt (D)" value={`$${totalD.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} caption="Σ Dⱼ · Pⱼ" tone="danger" />
          <MetricCard label="Target HF" value={targetHF.toFixed(2)} caption="Dynamic setpoint" tone="signal" />
          <MetricCard label="Trigger band" value="< 1.20" caption="Proactive intervention" tone="warn" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="panel rounded-panel px-5 py-5">
          <div className="mb-4 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-safe" />
            <h3 className="text-[13px] font-semibold text-paper-100">Collateral supply</h3>
          </div>
          <LegTable legs={collaterals} showLT />
        </div>

        <div className="panel rounded-panel px-5 py-5">
          <div className="mb-4 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-danger" />
            <h3 className="text-[13px] font-semibold text-paper-100">Borrowed debt</h3>
          </div>
          <LegTable legs={debts} />
        </div>
      </div>
    </div>
  );
}

function LegTable({ legs, showLT }: { legs: Leg[]; showLT?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12.5px]">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-[0.05em] text-paper-500">
            <th className="pb-2 font-medium">Asset</th>
            <th className="pb-2 font-medium">Amount</th>
            <th className="pb-2 font-medium">Price</th>
            <th className="pb-2 font-medium">Value</th>
            {showLT && <th className="pb-2 font-medium">LT</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05]">
          {legs.map((leg) => (
            <tr key={leg.symbol}>
              <td className="tabular py-2.5 font-medium text-paper-100">{leg.symbol}</td>
              <td className="tabular py-2.5 text-paper-300">{leg.amount.toLocaleString()}</td>
              <td className="tabular py-2.5 text-paper-300">${leg.priceUsd.toLocaleString()}</td>
              <td className="tabular py-2.5 font-medium text-paper-100">
                ${(leg.amount * leg.priceUsd).toLocaleString()}
              </td>
              {showLT && <td className="tabular py-2.5 text-paper-500">{leg.lt}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
