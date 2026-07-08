"use client";

import { useRouter, useSearchParams } from "next/navigation";

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];

export function MonthCalendar({
  year,
  month,
  countsByDay,
  selectedDate,
}: {
  year: number;
  month: number; // 1-12
  countsByDay: Record<string, number>;
  selectedDate: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const startWeekday = firstDay.getDay();

  const cells: (number | null)[] = [
    ...Array(startWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  function goToMonth(deltaMonths: number) {
    const d = new Date(year, month - 1 + deltaMonths, 1);
    const params = new URLSearchParams(searchParams.toString());
    params.set("year", String(d.getFullYear()));
    params.set("month", String(d.getMonth() + 1));
    router.push(`/tarefas?${params.toString()}`);
  }

  function selectDay(day: number) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const params = new URLSearchParams(searchParams.toString());
    params.set("year", String(year));
    params.set("month", String(month));
    params.set("date", dateStr);
    router.push(`/tarefas?${params.toString()}`);
  }

  const monthLabel = firstDay.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div className="card-premium rounded-lg p-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => goToMonth(-1)}
          className="rounded-md px-2 py-1 text-sm text-ink-300 hover:bg-white/[0.05] hover:text-ink-50"
        >
          ‹
        </button>
        <p className="text-sm font-semibold capitalize text-ink-50">{monthLabel}</p>
        <button
          onClick={() => goToMonth(1)}
          className="rounded-md px-2 py-1 text-sm text-ink-300 hover:bg-white/[0.05] hover:text-ink-50"
        >
          ›
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs text-ink-500">
        {WEEKDAYS.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <span key={i} />;
          const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const count = countsByDay[dateStr] ?? 0;
          const isSelected = dateStr === selectedDate;
          return (
            <button
              key={i}
              onClick={() => selectDay(day)}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-md text-xs transition ${
                isSelected
                  ? "bg-amber-500/20 text-amber-300 ring-1 ring-inset ring-amber-500/40"
                  : "text-ink-300 hover:bg-white/[0.05] hover:text-ink-50"
              }`}
            >
              {day}
              {count > 0 && (
                <span className="mt-0.5 size-1 rounded-full bg-amber-500" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
