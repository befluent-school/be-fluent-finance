import { createClient } from "@/lib/supabase/server";
import { formatCurrencyBRL } from "@shared/finance";
import { StatusBadge } from "@/components/ui/status-badge";
import { GenerateInvoicesButton } from "./generate-invoices-button";
import { MarkPaidForm } from "./mark-paid-form";

type InvoiceRow = {
  id: string;
  amount: number;
  due_date: string;
  paid_date: string | null;
  payment_method: string | null;
  effective_status: string;
  enrollments: {
    students: { id: string; full_name: string } | null;
    plans: { name: string } | null;
  } | null;
};

function nextMonth(referenceMonth: string): string {
  const [year, month] = referenceMonth.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return next.toISOString().slice(0, 7);
}

export default async function MensalidadesPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes } = await searchParams;
  const referenceMonth = mes ?? new Date().toISOString().slice(0, 7);

  const supabase = await createClient();
  const { data: invoices } = await supabase
    .from("invoices_with_effective_status")
    .select(
      "id, amount, due_date, paid_date, payment_method, effective_status, enrollments(students(id, full_name), plans(name))"
    )
    .gte("reference_month", `${referenceMonth}-01`)
    .lt("reference_month", `${nextMonth(referenceMonth)}-01`)
    .order("due_date")
    .returns<InvoiceRow[]>();

  const totals = (invoices ?? []).reduce(
    (acc, invoice) => {
      acc[invoice.effective_status as "pago" | "atrasado" | "pendente"] += invoice.amount;
      return acc;
    },
    { pago: 0, atrasado: 0, pendente: 0 }
  );

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-ink-300">
            Mês de referência:{" "}
            {new Date(`${referenceMonth}-01`).toLocaleDateString("pt-BR", {
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        <GenerateInvoicesButton referenceMonth={referenceMonth} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-md border border-ink-700 bg-status-paid-bg p-4">
          <p className="text-sm text-status-paid">Pago</p>
          <p className="font-display font-tabular text-xl font-bold text-status-paid">
            {formatCurrencyBRL(totals.pago)}
          </p>
        </div>
        <div className="rounded-md border border-ink-700 bg-status-overdue-bg p-4">
          <p className="text-sm text-status-overdue">Atrasado</p>
          <p className="font-display font-tabular text-xl font-bold text-status-overdue">
            {formatCurrencyBRL(totals.atrasado)}
          </p>
        </div>
        <div className="rounded-md border border-ink-700 bg-status-pending-bg p-4">
          <p className="text-sm text-status-pending">Pendente</p>
          <p className="font-display font-tabular text-xl font-bold text-status-pending">
            {formatCurrencyBRL(totals.pendente)}
          </p>
        </div>
      </div>

      <div className="mt-6 card-premium overflow-x-auto rounded-md">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-white/[0.03] text-left text-xs text-ink-300">
              <th className="px-4 py-3 font-medium">Aluno</th>
              <th className="px-4 py-3 font-medium">Plano</th>
              <th className="px-4 py-3 font-medium">Valor</th>
              <th className="px-4 py-3 font-medium">Vencimento</th>
              <th className="px-4 py-3 font-medium">Forma</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Ação</th>
            </tr>
          </thead>
          <tbody>
            {invoices?.map((invoice) => (
              <tr
                key={invoice.id}
                className="border-b border-ink-700/70 last:border-0 hover:bg-white/[0.03]"
              >
                <td className="px-4 py-3">{invoice.enrollments?.students?.full_name ?? "—"}</td>
                <td className="px-4 py-3">{invoice.enrollments?.plans?.name ?? "—"}</td>
                <td className="font-tabular px-4 py-3">{formatCurrencyBRL(invoice.amount)}</td>
                <td className="font-tabular px-4 py-3">
                  {new Date(invoice.due_date).toLocaleDateString("pt-BR")}
                </td>
                <td className="px-4 py-3">{invoice.payment_method ?? "—"}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={invoice.effective_status} />
                </td>
                <td className="px-4 py-3">
                  {invoice.effective_status !== "pago" && <MarkPaidForm invoiceId={invoice.id} />}
                </td>
              </tr>
            ))}
            {(!invoices || invoices.length === 0) && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-500">
                  Nenhuma mensalidade gerada para este mês ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
