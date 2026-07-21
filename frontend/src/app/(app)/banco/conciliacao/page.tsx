import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCurrencyBRL } from "@shared/finance";
import { ReconcileForm } from "./reconcile-form";
import { ImportStatementDialog } from "./import-statement-dialog";

type StagingRow = {
  id: string;
  date: string;
  description: string;
  amount: number;
  pluggy_type: "DEBIT" | "CREDIT";
  bank_statement_imports: { account_label: string } | null;
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

  const [{ data: pending }, { data: categories }] = await Promise.all([
    supabase
      .from("bank_transactions_staging")
      .select("id, date, description, amount, pluggy_type, bank_statement_imports(account_label)")
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
          Importe o extrato do seu banco (CSV/OFX) — as transações aguardam confirmação antes
          de virarem lançamentos reais no fluxo de caixa.
        </p>
        <ImportStatementDialog categoryNames={(categories ?? []).map((c) => c.name)} />
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

      <h2 className="mt-8 text-lg font-semibold text-ink-50">
        Transações pendentes de conciliação
      </h2>
      <div className="card-premium mt-3 overflow-x-auto rounded-md">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-white/[0.03] text-left text-xs text-ink-300">
              <th className="px-4 py-3 font-medium">Data</th>
              <th className="px-4 py-3 font-medium">Conta</th>
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
                  {t.bank_statement_imports?.account_label ?? "—"}
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
