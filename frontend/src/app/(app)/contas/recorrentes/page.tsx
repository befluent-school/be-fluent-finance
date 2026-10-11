import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { formatCurrencyBRL } from "@shared/finance";
import { requireUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { withUser, sequential } from "@/lib/db";
import { costCategories, recurringPayables } from "@/lib/db/schema";
import { RecurringForm } from "./recurring-form";
import { RecurringRowActions } from "./recurring-row-actions";

export default async function RecorrentesPage() {
  const user = await requireUser();
  if (!Policies.manageFinance.check(user)) {
    return <div className="rounded-md border border-ink-700 bg-ink-800/40 p-6 text-sm text-ink-300">Área restrita a sócios.</div>;
  }

  const { list, categories } = await withUser(user.id, async (tx) => {
    const [list, categories] = await sequential([
      () =>
        tx
          .select({
            id: recurringPayables.id,
            description: recurringPayables.description,
            amount: recurringPayables.amount,
            dueDay: recurringPayables.dueDay,
            active: recurringPayables.active,
            startMonth: recurringPayables.startMonth,
            categoryName: costCategories.name,
          })
          .from(recurringPayables)
          .leftJoin(costCategories, eq(costCategories.id, recurringPayables.categoryId))
          .orderBy(asc(recurringPayables.description)),
      () =>
        tx
          .select({ id: costCategories.id, name: costCategories.name })
          .from(costCategories)
          .where(eq(costCategories.active, true))
          .orderBy(asc(costCategories.name)),
    ]);
    return { list, categories };
  });

  const totalMensal = list.filter((r) => r.active).reduce((sum, r) => sum + r.amount, 0);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/contas" className="text-xs text-ink-400 hover:text-ink-200">‹ Voltar para Contas</Link>
          <h1 className="font-display text-xl font-bold text-ink-50">Contas recorrentes</h1>
          <p className="text-sm text-ink-300">
            Custos fixos gerados automaticamente todo mês. Total mensal ativo:{" "}
            <strong className="text-ink-50">{formatCurrencyBRL(totalMensal)}</strong>
          </p>
        </div>
        <RecurringForm categories={categories} />
      </div>

      <div className="mt-6 card-premium overflow-x-auto rounded-md">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-white/[0.03] text-left text-xs text-ink-300">
              <th className="px-4 py-3 font-medium">Descrição</th>
              <th className="px-4 py-3 font-medium">Categoria</th>
              <th className="px-4 py-3 font-medium">Valor</th>
              <th className="px-4 py-3 font-medium">Vence dia</th>
              <th className="px-4 py-3 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-500">Nenhuma conta recorrente cadastrada.</td></tr>
            )}
            {list.map((r) => (
              <tr key={r.id} className="border-b border-ink-700/70 last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-3 text-ink-50">{r.description}</td>
                <td className="px-4 py-3 text-ink-300">{r.categoryName ?? "—"}</td>
                <td className="font-tabular px-4 py-3">{formatCurrencyBRL(r.amount)}</td>
                <td className="font-tabular px-4 py-3 text-ink-300">{r.dueDay}</td>
                <td className="px-4 py-3"><RecurringRowActions id={r.id} active={r.active} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
