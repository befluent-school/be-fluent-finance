import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCurrencyBRL } from "@shared/finance";

type ExtratoRow = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: "entrada" | "saida";
  cost_categories: { name: string } | null;
};

const PAGE_SIZE = 50;

export default async function ExtratoPage({
  searchParams,
}: {
  searchParams: Promise<{
    de?: string;
    ate?: string;
    tipo?: string;
    pagina?: string;
  }>;
}) {
  const { de, ate, tipo, pagina } = await searchParams;
  const page = Math.max(1, parseInt(pagina ?? "1", 10) || 1);

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role === "funcionario") {
    redirect("/dashboard");
  }

  let query = supabase
    .from("cash_transactions")
    .select("id, date, description, amount, type, cost_categories(name)", { count: "exact" })
    .eq("source", "manual_import")
    .order("date", { ascending: false });

  if (de) query = query.gte("date", de);
  if (ate) query = query.lte("date", ate);
  if (tipo === "credito") query = query.eq("type", "entrada");
  if (tipo === "debito") query = query.eq("type", "saida");

  const from = (page - 1) * PAGE_SIZE;
  const { data: transactions, count } = await query
    .range(from, from + PAGE_SIZE - 1)
    .returns<ExtratoRow[]>();

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  function buildPageLink(targetPage: number) {
    const params = new URLSearchParams();
    if (de) params.set("de", de);
    if (ate) params.set("ate", ate);
    if (tipo) params.set("tipo", tipo);
    params.set("pagina", String(targetPage));
    return `/banco/extrato?${params.toString()}`;
  }

  return (
    <div>
      <p className="text-sm text-ink-300">Extrato completo das transações importadas, por período.</p>

      <div className="mt-4 flex gap-4 border-b border-ink-700 text-sm">
        <Link
          href="/banco/conciliacao"
          className="border-b-2 border-transparent px-1 pb-2 text-ink-300 hover:text-ink-50"
        >
          Importar
        </Link>
        <span className="border-b-2 border-amber-500 px-1 pb-2 font-semibold text-ink-50">
          Extrato completo
        </span>
      </div>

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
            Página {page} de {totalPages} ({count} transaç{count === 1 ? "ão" : "ões"})
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
}
