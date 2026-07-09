import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCurrencyBRL } from "@shared/finance";

type ExtratoRow = {
  id: string;
  date: string;
  description: string;
  amount: number;
  pluggy_type: "DEBIT" | "CREDIT";
  ignored: boolean;
  reconciled_cash_transaction_id: string | null;
  bank_connections: { institution_name: string } | null;
};

const PAGE_SIZE = 50;

export default async function ExtratoPage({
  searchParams,
}: {
  searchParams: Promise<{
    banco?: string;
    de?: string;
    ate?: string;
    tipo?: string;
    status?: string;
    pagina?: string;
  }>;
}) {
  const { banco, de, ate, tipo, status, pagina } = await searchParams;
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

  const { data: connections } = await supabase
    .from("bank_connections")
    .select("id, institution_name")
    .order("institution_name");

  let query = supabase
    .from("bank_transactions_staging")
    .select(
      "id, date, description, amount, pluggy_type, ignored, reconciled_cash_transaction_id, bank_connections(institution_name)",
      { count: "exact" }
    )
    .order("date", { ascending: false });

  if (banco) query = query.eq("bank_connection_id", banco);
  if (de) query = query.gte("date", de);
  if (ate) query = query.lte("date", ate);
  if (tipo === "credito") query = query.eq("pluggy_type", "CREDIT");
  if (tipo === "debito") query = query.eq("pluggy_type", "DEBIT");
  if (status === "pendente") query = query.is("reconciled_cash_transaction_id", null).eq("ignored", false);
  if (status === "conciliada") query = query.not("reconciled_cash_transaction_id", "is", null);
  if (status === "ignorada") query = query.eq("ignored", true);

  const from = (page - 1) * PAGE_SIZE;
  const { data: transactions, count } = await query
    .range(from, from + PAGE_SIZE - 1)
    .returns<ExtratoRow[]>();

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  function buildPageLink(targetPage: number) {
    const params = new URLSearchParams();
    if (banco) params.set("banco", banco);
    if (de) params.set("de", de);
    if (ate) params.set("ate", ate);
    if (tipo) params.set("tipo", tipo);
    if (status) params.set("status", status);
    params.set("pagina", String(targetPage));
    return `/banco/extrato?${params.toString()}`;
  }

  return (
    <div>
      <p className="text-sm text-ink-300">
        Extrato completo das transações importadas via Open Finance, por banco e período.
      </p>

      <div className="mt-4 flex gap-4 border-b border-ink-700 text-sm">
        <Link
          href="/banco/conciliacao"
          className="border-b-2 border-transparent px-1 pb-2 text-ink-300 hover:text-ink-50"
        >
          Pendentes
        </Link>
        <span className="border-b-2 border-amber-500 px-1 pb-2 font-semibold text-ink-50">
          Extrato completo
        </span>
      </div>

      <form className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5" method="get">
        <select
          name="banco"
          defaultValue={banco ?? ""}
          className="rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-50"
        >
          <option value="">Todos os bancos</option>
          {(connections ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.institution_name}
            </option>
          ))}
        </select>
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
          <option value="credito">Crédito</option>
          <option value="debito">Débito</option>
        </select>
        <select
          name="status"
          defaultValue={status ?? ""}
          className="rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-50"
        >
          <option value="">Todos os status</option>
          <option value="pendente">Pendente</option>
          <option value="conciliada">Conciliada</option>
          <option value="ignorada">Ignorada</option>
        </select>
        <button
          type="submit"
          className="col-span-2 rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 hover:brightness-105 sm:col-span-1"
        >
          Filtrar
        </button>
      </form>

      <div className="card-premium mt-6 overflow-x-auto rounded-md">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-white/[0.03] text-left text-xs text-ink-300">
              <th className="px-4 py-3 font-medium">Data</th>
              <th className="px-4 py-3 font-medium">Banco</th>
              <th className="px-4 py-3 font-medium">Descrição</th>
              <th className="px-4 py-3 font-medium">Valor</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {transactions?.map((t) => {
              const rowStatus = t.ignored
                ? "Ignorada"
                : t.reconciled_cash_transaction_id
                  ? "Conciliada"
                  : "Pendente";
              return (
                <tr key={t.id} className="border-b border-ink-700/70 last:border-0 hover:bg-white/[0.03]">
                  <td className="font-tabular px-4 py-3">
                    {new Date(t.date).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="px-4 py-3 text-ink-300">
                    {t.bank_connections?.institution_name ?? "—"}
                  </td>
                  <td className="px-4 py-3">{t.description}</td>
                  <td
                    className={`font-tabular px-4 py-3 font-medium ${
                      t.pluggy_type === "CREDIT" ? "text-status-paid" : "text-status-overdue"
                    }`}
                  >
                    {t.pluggy_type === "CREDIT" ? "+" : "-"} {formatCurrencyBRL(t.amount)}
                  </td>
                  <td className="px-4 py-3 text-ink-300">{rowStatus}</td>
                </tr>
              );
            })}
            {(!transactions || transactions.length === 0) && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-500">
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
