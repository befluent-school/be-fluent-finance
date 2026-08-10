export function variation(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function VariationBadge({ value, suffix = "vs. período anterior" }: { value: number | null; suffix?: string }) {
  if (value === null) return null;
  const positive = value >= 0;
  return (
    <span
      className={`ml-2 text-xs font-medium ${positive ? "text-status-paid" : "text-status-overdue"}`}
    >
      {positive ? "▲" : "▼"} {Math.abs(value).toFixed(0)}% {suffix}
    </span>
  );
}
