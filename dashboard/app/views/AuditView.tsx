import { CheckCircle, WarningCircle, ClipboardText, MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import type { DecisionRecord } from '../../lib/readLog';

const KIND_META: Record<
  DecisionRecord['kind'],
  { label: string; icon: typeof CheckCircle; className: string }
> = {
  assess: { label: 'Assess', icon: MagnifyingGlass, className: 'bg-signal/15 text-signal' },
  plan: { label: 'Plan', icon: ClipboardText, className: 'bg-paper-500/15 text-paper-300' },
  execute: { label: 'Execute', icon: CheckCircle, className: 'bg-safe/15 text-safe' },
  refuse: { label: 'Refuse', icon: WarningCircle, className: 'bg-danger/15 text-danger' },
  simulate_fail: { label: 'Simulate fail', icon: WarningCircle, className: 'bg-danger/15 text-danger' },
};

export function AuditView({ records }: { records: DecisionRecord[] }) {
  const reversed = [...records].reverse();

  return (
    <div className="flex flex-col gap-4 px-6 py-6 lg:px-8">
      <div className="panel flex items-center justify-between rounded-panel px-5 py-4">
        <div>
          <h3 className="text-[13px] font-semibold text-paper-100">Decision audit trail</h3>
          <p className="mt-0.5 text-[11.5px] text-paper-500">{records.length} records, JSON-lines feed</p>
        </div>
      </div>

      {reversed.length === 0 ? (
        <div className="panel flex flex-col items-center gap-2 rounded-panel px-6 py-16 text-center">
          <p className="text-[13px] text-paper-300">No decision records yet.</p>
          <p className="text-[11.5px] text-paper-500">
            Run <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-signal">pnpm demo:real</code>{' '}
            or connect a live backend.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {reversed.map((rec, i) => {
            const meta = KIND_META[rec.kind];
            const Icon = meta.icon;
            return (
              <li key={i} className="panel rounded-panel px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.05] pb-2.5">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-semibold ${meta.className}`}
                    >
                      <Icon size={12} weight="fill" />
                      {meta.label.toUpperCase()}
                    </span>
                    <span className="text-[12px] font-medium text-paper-300">{rec.userId}</span>
                  </div>
                  <span className="tabular text-[11px] text-paper-500">
                    {new Date(rec.ts).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {rec.hf !== undefined && <Field label="Health factor" value={rec.hf.toFixed(4)} />}
                  {rec.chosenSymbol && <Field label="Chosen asset" value={rec.chosenSymbol} className="text-safe" />}
                  {rec.capitalBurned !== undefined && (
                    <Field label="Capital burned" value={`$${rec.capitalBurned.toFixed(2)}`} className="text-warn" />
                  )}
                </div>

                {rec.txHash && (
                  <div className="mt-3 rounded-control border border-white/[0.06] bg-black/20 px-3 py-2">
                    <span className="text-[10px] font-medium uppercase tracking-[0.05em] text-paper-500">
                      Tx hash
                    </span>
                    <p className="tabular select-all break-all font-mono text-[11px] text-safe">{rec.txHash}</p>
                  </div>
                )}

                {rec.reason && (
                  <div className="mt-3 rounded-control border border-danger/20 bg-danger/[0.06] px-3 py-2">
                    <span className="text-[10px] font-medium uppercase tracking-[0.05em] text-danger">
                      Refusal reason
                    </span>
                    <p className="mt-0.5 text-[11.5px] text-paper-300">{rec.reason}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <span className="block text-[10px] font-medium uppercase tracking-[0.05em] text-paper-500">{label}</span>
      <span className={`tabular text-[12.5px] font-semibold text-paper-100 ${className ?? ''}`}>{value}</span>
    </div>
  );
}
