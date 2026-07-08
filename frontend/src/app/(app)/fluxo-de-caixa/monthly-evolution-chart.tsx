import { formatCurrencyBRL } from "@shared/finance";

type MonthTotal = { month: string; entrada: number; saida: number };

export function MonthlyEvolutionChart({ data }: { data: MonthTotal[] }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.entrada, d.saida]));

  return (
    <div className="flex items-end gap-4 overflow-x-auto rounded-md border border-ink-700 p-4">
      {data.map((month) => (
        <div key={month.month} className="flex min-w-16 flex-col items-center gap-1">
          <div className="flex h-40 items-end gap-1">
            <div
              title={`Entradas: ${formatCurrencyBRL(month.entrada)}`}
              style={{ height: `${(month.entrada / max) * 100}%` }}
              className="w-4 rounded-t bg-amber-500"
            />
            <div
              title={`Saídas: ${formatCurrencyBRL(month.saida)}`}
              style={{ height: `${(month.saida / max) * 100}%` }}
              className="w-4 rounded-t bg-ink-600"
            />
          </div>
          <span className="text-xs text-ink-300">
            {new Date(`${month.month}-01`).toLocaleDateString("pt-BR", { month: "short" })}
          </span>
        </div>
      ))}
      {data.length === 0 && (
        <p className="text-sm text-ink-500">Sem lançamentos suficientes para o gráfico.</p>
      )}
    </div>
  );
}
