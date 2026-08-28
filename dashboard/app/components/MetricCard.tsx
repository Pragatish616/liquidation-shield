export function MetricCard({
  label,
  value,
  caption,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: 'neutral' | 'safe' | 'warn' | 'danger' | 'signal';
}) {
  const toneClass = {
    neutral: 'text-paper-100',
    safe: 'text-safe',
    warn: 'text-warn',
    danger: 'text-danger',
    signal: 'text-signal',
  }[tone];

  return (
    <div className="panel flex flex-col justify-between gap-3 rounded-panel px-5 py-4">
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-paper-500">{label}</span>
      <span className={`tabular text-[1.65rem] font-semibold leading-none tracking-tight ${toneClass}`}>
        {value}
      </span>
      {caption && <span className="text-[11.5px] text-paper-500">{caption}</span>}
    </div>
  );
}
