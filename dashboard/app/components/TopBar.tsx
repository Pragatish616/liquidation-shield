'use client';

export function TopBar({
  title,
  subtitle,
  live,
  scenario,
  onScenarioChange,
  updatedAt,
}: {
  title: string;
  subtitle: string;
  live: boolean;
  scenario: 'save' | 'refuse';
  onScenarioChange: (s: 'save' | 'refuse') => void;
  updatedAt: number | null;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-white/[0.07] px-6 py-5 sm:flex-row sm:items-center sm:justify-between lg:px-8">
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight text-paper-100">{title}</h1>
        <p className="mt-0.5 text-[12.5px] text-paper-500">{subtitle}</p>
      </div>

      <div className="flex items-center gap-3">
        {!live && (
          <div className="flex items-center rounded-full border border-white/[0.08] bg-white/[0.02] p-0.5 text-[11.5px] font-medium">
            <button
              onClick={() => onScenarioChange('save')}
              className={`rounded-full px-3 py-1.5 transition-colors ${
                scenario === 'save' ? 'bg-safe/15 text-safe' : 'text-paper-500 hover:text-paper-300'
              }`}
            >
              Demo — save
            </button>
            <button
              onClick={() => onScenarioChange('refuse')}
              className={`rounded-full px-3 py-1.5 transition-colors ${
                scenario === 'refuse' ? 'bg-danger/15 text-danger' : 'text-paper-500 hover:text-paper-300'
              }`}
            >
              Demo — refuse
            </button>
          </div>
        )}

        <span className="tabular text-[11.5px] text-paper-500">
          {updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : '—'}
        </span>
      </div>
    </div>
  );
}
