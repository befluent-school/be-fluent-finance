export function KpiCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "positive" | "warning" | "negative";
}) {
  const toneClass = {
    neutral: "gradient-text",
    positive: "text-status-paid",
    warning: "text-status-pending",
    negative: "text-status-overdue",
  }[tone];

  return (
    <div className="card-premium animate-rise relative overflow-hidden rounded-lg p-6">
      <div className="pointer-events-none absolute -right-6 -top-10 h-28 w-28 rounded-full bg-amber-500/10 blur-2xl" />
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">{label}</p>
      <p className={`font-display font-tabular mt-2 text-3xl font-bold ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}
