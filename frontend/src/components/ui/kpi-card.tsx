export function KpiCard({
  label,
  value,
  hint,
  explanation,
  tone = "neutral",
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Texto explicando de onde vem o número — aparece via tooltip nativo no ícone "?". */
  explanation?: string;
  tone?: "neutral" | "positive" | "warning" | "negative";
  className?: string;
}) {
  const toneClass = {
    neutral: "gradient-text",
    positive: "text-status-paid",
    warning: "text-status-pending",
    negative: "text-status-overdue",
  }[tone];

  return (
    <div
      className={`card-premium animate-rise relative overflow-hidden rounded-lg p-6 ${className ?? ""}`}
    >
      <div className="pointer-events-none absolute -right-6 -top-10 h-28 w-28 rounded-full bg-amber-500/10 blur-2xl" />
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">{label}</p>
        {explanation && (
          <span
            title={explanation}
            className="flex size-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-ink-600 text-[9px] font-bold text-ink-500 hover:border-ink-400 hover:text-ink-300"
          >
            ?
          </span>
        )}
      </div>
      <p className={`font-display font-tabular mt-2 text-3xl font-bold ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}
