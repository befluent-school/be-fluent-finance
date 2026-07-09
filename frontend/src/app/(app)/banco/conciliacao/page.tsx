import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCurrencyBRL } from "@shared/finance";
import { ConnectBankButton } from "./connect-bank-button";
import { ReconcileForm } from "./reconcile-form";
import { ResyncButton } from "./resync-button";

type StagingRow = {
  id: string;
  date: string;
  description: string;
  amount: number;
  pluggy_type: "DEBIT" | "CREDIT";
  bank_connections: { institution_name: string } | null;
};

export default async function ConciliacaoPage() {
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

  const [{ data: connections }, { data: pending }, { data: categories }] = await Promise.all([
    supabase.from("bank_connections").select("*").order("created_at", { ascending: false }),
    supabase
      .from("bank_transactions_staging")
      .select("id, date, description, amount, pluggy_type, bank_connections(institution_name)")
      .is("reconciled_cash_transaction_id", null)
      .eq("ignored", false)
      .order("date", { ascending: false })
      .returns<StagingRow[]>(),
    supabase.from("cost_categories").select("id, name").eq("active", true),
  ]);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-300">
          Integração via Open Finance (Pluggy) — transações importadas aguardam confirmação
          antes de virarem lançamentos reais no fluxo de caixa.
        </p>
        <ConnectBankButton />
      </div>

      <div className="mt-4 flex gap-4 border-b border-ink-700 text-sm">
        <span className="border-b-2 border-amber-500 px-1 pb-2 font-semibold text-ink-50">
          Pendentes
        </span>
        <Link
          href="/banco/extrato"
          className="border-b-2 border-transparent px-1 pb-2 text-ink-300 hover:text-ink-50"
        >
          Extrato completo
        </Link>
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Contas conectadas</h2>
      <div className="card-premium mt-3 overflow-x-auto rounded-md">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-white/[0.03] text-left text-xs text-ink-300">
              <th className="px-4 py-3 font-medium">Instituição</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Última sincronização</th>
              <th className="px-4 py-3 font-medium">Ação</th>
            </tr>
          </thead>
          <tbody>
            {connections?.map((c) => (
              <tr key={c.id} className="border-b border-ink-700/70 last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-3 text-ink-50">{c.institution_name}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      c.status === "error"
                        ? "text-status-overdue"
                        : c.status === "updated"
                          ? "text-status-paid"
                          : "text-ink-300"
                    }
                  >
                    {c.status}
                  </span>
                  {c.status === "error" && c.last_error && (
                    <p className="mt-1 max-w-xs text-xs text-status-overdue">{c.last_error}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-ink-300">
                  {c.last_synced_at
                    ? new Date(c.last_synced_at).toLocaleString("pt-BR")
                    : "Nunca"}
                </td>
                <td className="px-4 py-3">
                  <ResyncButton connectionId={c.id} />
                </td>
              </tr>
            ))}
            {(!connections || connections.length === 0) && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-ink-500">
                  Nenhuma conta bancária conectada ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink-50">
        Transações pendentes de conciliação
      </h2>
      <div className="card-premium mt-3 overflow-x-auto rounded-md">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-white/[0.03] text-left text-xs text-ink-300">
              <th className="px-4 py-3 font-medium">Data</th>
              <th className="px-4 py-3 font-medium">Banco</th>
              <th className="px-4 py-3 font-medium">Descrição</th>
              <th className="px-4 py-3 font-medium">Valor</th>
              <th className="px-4 py-3 font-medium">Ação</th>
            </tr>
          </thead>
          <tbody>
            {pending?.map((t) => (
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
                <td className="px-4 py-3">
                  <ReconcileForm
                    stagingId={t.id}
                    description={t.description}
                    categories={categories ?? []}
                  />
                </td>
              </tr>
            ))}
            {(!pending || pending.length === 0) && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-500">
                  Nenhuma transação pendente de conciliação.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
