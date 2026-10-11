import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { formatCurrencyBRL } from "@shared/finance";
import { requireUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { withUser, sequential } from "@/lib/db";
import { costCategories } from "@/lib/db/schema";
import {
  getReceivablesOpen,
  getPayablesOpen,
  listReceivables,
  listPayables,
} from "@/lib/queries/finance";
import { parseYearMonth } from "@/lib/validation";
import { KpiCard } from "@/components/ui/kpi-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { NewPayableForm } from "./new-payable-form";
import { PayPayableForm } from "./pay-payable-form";
import { DeletePayableButton } from "./delete-payable-button";

function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

function fmtDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export default async function ContasPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const user = await requireUser();
  const canManage = Policies.manageFinance.check(user);

  const { mes } = await searchParams;
  const currentMonth = new Date().toISOString().slice(0, 7);
  const selectedMonth = parseYearMonth(mes, currentMonth);
  const referenceMonth = `${selectedMonth}-01`;

  const { recvOpen, payOpen, receivables, payablesList, categories } = await withUser(
    user.id,
    async (tx) => {
      const [recvOpen, payOpen, receivables, payablesList, categories] = await sequential([
        () => getReceivablesOpen(tx),
        () => getPayablesOpen(tx),
        () => listReceivables(tx, referenceMonth),
        () => listPayables(tx, referenceMonth),
        () =>
          tx
            .select({ id: costCategories.id, name: costCategories.name })
            .from(costCategories)
            .where(eq(costCategories.active, true))
            .orderBy(asc(costCategories.name)),
      ]);
      return { recvOpen, payOpen, receivables, payablesList, categories };
    }
  );

  const aReceberTotal = recvOpen.overdue.total + recvOpen.upcoming.total;
  const aPagarTotal = payOpen.overdue.total + payOpen.upcoming.total;
  const saldoProjetado = aReceberTotal - aPagarTotal;

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-ink-50">Contas a Pagar e a Receber</h1>
          <p className="text-sm text-ink-300">Posição consolidada de tudo em aberto, atualizada automaticamente.</p>
        </div>
        <div className="flex items-center gap-3">
          {canManage && (
            <Link href="/contas/recorrentes" className="rounded-md px-3 py-1.5 text-sm text-ink-300 ring-1 ring-inset ring-ink-700 hover:text-ink-50">
              Contas recorrentes
            </Link>
          )}
          {canManage && <NewPayableForm referenceMonth={selectedMonth} categories={categories} />}
        </div>
      </div>

      {/* Totais em aberto — "foto de agora", independentes do mês navegado. */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="A receber em aberto"
          value={formatCurrencyBRL(aReceberTotal)}
          hint={`${formatCurrencyBRL(recvOpen.overdue.total)} vencido · ${formatCurrencyBRL(recvOpen.upcoming.total)} a vencer`}
          explanation="Todas as mensalidades ainda não pagas, em qualquer mês — separadas entre vencidas (inadimplência) e a vencer."
          tone="positive"
        />
        <KpiCard
          label="A pagar em aberto"
          value={formatCurrencyBRL(aPagarTotal)}
          hint={`${formatCurrencyBRL(payOpen.overdue.total)} vencido · ${formatCurrencyBRL(payOpen.upcoming.total)} a vencer`}
          explanation="Todas as contas a pagar ainda não quitadas (recorrentes, DAS, lançamentos manuais), em qualquer mês."
          tone="negative"
        />
        <KpiCard
          label="Saldo projetado"
          value={formatCurrencyBRL(saldoProjetado)}
          hint="A receber menos a pagar (tudo em aberto)"
          explanation="Diferença entre tudo que há para receber e tudo que há para pagar. Projeção gerencial, não considera o saldo atual em conta."
          tone={saldoProjetado >= 0 ? "positive" : "negative"}
        />
      </div>

      {/* Navegação de mês para as listas detalhadas. */}
      <div className="mt-8 flex items-center gap-3">
        <Link href={`/contas?mes=${addMonths(selectedMonth, -1)}`} className="rounded-md px-2 py-1 text-sm text-ink-300 hover:bg-white/[0.05] hover:text-ink-50">‹</Link>
        <p className="text-sm capitalize text-ink-300">
          {new Date(referenceMonth).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
        </p>
        <Link href={`/contas?mes=${addMonths(selectedMonth, 1)}`} className="rounded-md px-2 py-1 text-sm text-ink-300 hover:bg-white/[0.05] hover:text-ink-50">›</Link>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* A RECEBER */}
        <section>
          <h2 className="text-lg font-semibold text-ink-50">A receber no mês</h2>
          <div className="mt-3 card-premium overflow-x-auto rounded-md">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-700 bg-white/[0.03] text-left text-xs text-ink-300">
                  <th className="px-4 py-3 font-medium">Aluno</th>
                  <th className="px-4 py-3 font-medium">Venc.</th>
                  <th className="px-4 py-3 font-medium">Valor</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {receivables.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-ink-500">Nenhuma mensalidade neste mês.</td></tr>
                )}
                {receivables.map((r) => (
                  <tr key={r.id} className="border-b border-ink-700/70 last:border-0 hover:bg-white/[0.03]">
                    <td className="px-4 py-3 text-ink-50">{r.student_name}</td>
                    <td className="font-tabular px-4 py-3 text-ink-300">{fmtDate(r.due_date)}</td>
                    <td className="font-tabular px-4 py-3">{formatCurrencyBRL(r.amount)}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.effective_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-500">
            Registrar recebimento é feito em <Link href="/mensalidades" className="text-amber-300 underline">Mensalidades</Link>.
          </p>
        </section>

        {/* A PAGAR */}
        <section>
          <h2 className="text-lg font-semibold text-ink-50">A pagar no mês</h2>
          <div className="mt-3 card-premium overflow-x-auto rounded-md">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-700 bg-white/[0.03] text-left text-xs text-ink-300">
                  <th className="px-4 py-3 font-medium">Descrição</th>
                  <th className="px-4 py-3 font-medium">Venc.</th>
                  <th className="px-4 py-3 font-medium">Valor</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  {canManage && <th className="px-4 py-3 font-medium">Ações</th>}
                </tr>
              </thead>
              <tbody>
                {payablesList.length === 0 && (
                  <tr><td colSpan={canManage ? 5 : 4} className="px-4 py-6 text-center text-ink-500">Nenhuma conta a pagar neste mês.</td></tr>
                )}
                {payablesList.map((p) => (
                  <tr key={p.id} className="border-b border-ink-700/70 last:border-0 hover:bg-white/[0.03]">
                    <td className="px-4 py-3 text-ink-50">
                      {p.description}
                      {p.origin !== "manual" && (
                        <span className="ml-2 rounded-full bg-ink-800 px-2 py-0.5 text-[10px] uppercase text-ink-400">
                          {p.origin === "das" ? "DAS" : p.origin === "recurring" ? "recorrente" : p.origin}
                        </span>
                      )}
                      {p.category_name && <span className="block text-xs text-ink-500">{p.category_name}</span>}
                    </td>
                    <td className="font-tabular px-4 py-3 text-ink-300">{fmtDate(p.due_date)}</td>
                    <td className="font-tabular px-4 py-3">{formatCurrencyBRL(p.amount)}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.effective_status} /></td>
                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {p.effective_status !== "pago" && <PayPayableForm payableId={p.id} amount={p.amount} />}
                          <DeletePayableButton payableId={p.id} />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
