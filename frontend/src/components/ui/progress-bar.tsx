export function ProgressBar({
  label,
  current,
  target,
  formatValue,
  remainingLabel,
}: {
  label: string;
  current: number;
  target: number;
  formatValue: (value: number) => string;
  remainingLabel: (remaining: number) => string;
}) {
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
  const remaining = Math.max(0, target - current);
  const achieved = current >= target && target > 0;

  return (
    <div className={`card-premium animate-rise rounded-lg p-6 ${achieved ? "card-glow" : ""}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">{label}</p>
        {achieved && (
          <span className="flex items-center gap-1 text-xs font-semibold text-amber-400">
            <BeeIcon className="h-3.5 w-3.5" />
            Meta batida
          </span>
        )}
      </div>

      <div className="mt-3 flex items-baseline gap-2 font-tabular">
        <span className="font-display gradient-text text-2xl font-bold">
          {formatValue(current)}
        </span>
        <span className="text-sm text-ink-500">/ {formatValue(target)}</span>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-ink-700">
        <div
          className="glow-amber h-full rounded-full bg-gradient-to-b from-amber-300 to-amber-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="mt-2 text-xs text-ink-500">
        {achieved ? "Meta atingida neste período." : remainingLabel(remaining)}
      </p>
    </div>
  );
}

function BeeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3l7 4v10l-7 4-7-4V7l7-4z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M12 3v18M5 7l7 4 7-4M5 17l7-4 7 4" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
