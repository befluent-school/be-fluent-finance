import Link from "next/link";
import { and, asc, count, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { withUser, sequential } from "@/lib/db";
import { cashTransactions, costCategories } from "@/lib/db/schema";
import { parseIsoDate } from "@/lib/validation";
import { formatCurrencyBRL } from "@shared/finance";
import { ImportStatementDialog } from "./import-statement-dialog";
import { BancoTabs } from "./banco-tabs";

type ExtratoRow = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: "entrada" | "saida";
  cost_categories: { name: string } | null;
};

const PAGE_SIZE = 50;

export default async function ConciliacaoPage({
  searchParams,
}: {
  searchParams: Promise<{
    de?: string;
    ate?: string;
    tipo?: string;
    pagina?: string;
  }>;
}) {
  const params = await searchParams;
  const de = parseIsoDate(params.de);
  const ate = parseIsoDate(params.ate);
  const tipo = params.tipo === "credito" || params.tipo === "debito" ? params.tipo : undefined;
  const page = Math.min(100_000, Math.max(1, parseInt(params.pagina ?? "1", 10) || 1));

  // Dados bancários: owner e sócio (funcionário é redirecionado; o RLS
  // de bank_statement_imports/staging também barra).
  const user = await requireUser(Policies.ownerOrSocio);

  const filters: SQL[] = [eq(cashTransactions.source, "manual_import")];
  if (de) filters.push(gte(cashTransactions.date, de));
  if (ate) filters.push(lte(cashTransactions.date, ate));
  if (tipo === "credito") filters.push(eq(cashTransactions.type, "entrada"));
  if (tipo === "debito") filters.push(eq(cashTransactions.type, "saida"));
  const where = and(...filters);

  const { categories, transactions, count: totalCount } = await withUser(user.id, async (tx) => {
    const [categories, rows, [{ value }]] = await sequential([
      () => tx
        .select({ id: costCategories.id, name: costCategories.name })
        .from(costCategories)
        .where(eq(costCategories.active, true))
        .orderBy(asc(costCategories.name)),
      () => tx
        .select({
          id: cashTransactions.id,
          date: cashTransactions.date,
          description: cashTransactions.description,
          amount: cashTransactions.amount,
          type: cashTransactions.type,
          categoryName: costCategories.name,
        })
        .from(cashTransactions)
        .leftJoin(costCategories, eq(costCategories.id, cashTransactions.categoryId))
        .where(where)
        .orderBy(desc(cashTransactions.date))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      () => tx.select({ value: count() }).from(cashTransactions).where(where),
    ]);
    const transactions: ExtratoRow[] = rows.map((r) => ({
      id: r.id,
      date: r.date,
      description: r.description,
      amount: r.amount,
      type: r.type,
      cost_categories: r.categoryName ? { name: r.categoryName } : null,
    }));
    return { categories, transactions, count: value };
  });

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  function buildPageLink(targetPage: number) {
    const params = new URLSearchParams();
    if (de) params.set("de", de);
    if (ate) params.set("ate", ate);
    if (tipo) params.set("tipo", tipo);
    params.set("pagina", String(targetPage));
    return `/banco/conciliacao?${params.toString()}`;
  }

  const importTab = (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-300">
          Importe o extrato do seu banco (CSV, Excel ou OFX) — revise as categorias e as
          transações já entram direto no fluxo de caixa.
        </p>
        <ImportStatementDialog categories={categories} />
      </div>

      <div className="card-premium rounded-lg p-8 text-center text-sm text-ink-500">
        Use o botão &quot;+ Importar extrato&quot; acima para lançar transações a partir de um
        arquivo do seu banco. O histórico completo fica em &quot;Extrato completo&quot;.
      </div>
    </div>
  );

  const extratoTab = (
    <div>
      <p className="text-sm text-ink-300">Extrato completo das transações importadas, por período.</p>

      <form className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4" method="get">
        <input
          type="date"
          name="de"
          defaultValue={de ?? ""}
          className="rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-50"
        />
        <input
          type="date"
          name="ate"
          defaultValue={ate ?? ""}
          className="rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-50"
        />
        <select
          name="tipo"
          defaultValue={tipo ?? ""}
          className="rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-50"
        >
          <option value="">Todos os tipos</option>
          <option value="credito">Entrada</option>
          <option value="debito">Saída</option>
        </select>
        <button
          type="submit"
          className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 hover:brightness-105"
        >
          Filtrar
        </button>
      </form>

      <div className="card-premium mt-6 overflow-x-auto rounded-md">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-white/[0.03] text-left text-xs text-ink-300">
              <th className="px-4 py-3 font-medium">Data</th>
              <th className="px-4 py-3 font-medium">Descrição</th>
              <th className="px-4 py-3 font-medium">Categoria</th>
              <th className="px-4 py-3 font-medium">Valor</th>
            </tr>
          </thead>
          <tbody>
            {transactions?.map((t) => (
              <tr key={t.id} className="border-b border-ink-700/70 last:border-0 hover:bg-white/[0.03]">
                <td className="font-tabular px-4 py-3">
                  {new Date(t.date).toLocaleDateString("pt-BR")}
                </td>
                <td className="px-4 py-3">{t.description}</td>
                <td className="px-4 py-3 text-ink-300">{t.cost_categories?.name ?? "—"}</td>
                <td
                  className={`font-tabular px-4 py-3 font-medium ${
                    t.type === "entrada" ? "text-status-paid" : "text-status-overdue"
                  }`}
                >
                  {t.type === "entrada" ? "+" : "-"} {formatCurrencyBRL(t.amount)}
                </td>
              </tr>
            ))}
            {(!transactions || transactions.length === 0) && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-ink-500">
                  Nenhuma transação encontrada com os filtros selecionados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-ink-300">
          <span>
            Página {page} de {totalPages} ({totalCount} transaç{totalCount === 1 ? "ão" : "ões"})
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={buildPageLink(page - 1)}
                className="rounded-md bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-ink-100 hover:bg-white/[0.1]"
              >
                Anterior
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={buildPageLink(page + 1)}
                className="rounded-md bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-ink-100 hover:bg-white/[0.1]"
              >
                Próxima
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return <BancoTabs importTab={importTab} extratoTab={extratoTab} />;
}
