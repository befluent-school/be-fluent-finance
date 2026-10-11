import Link from "next/link";
import { sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { parseYearMonth } from "@/lib/validation";
import { formatCurrencyBRL } from "@shared/finance";
import { StatusBadge } from "@/components/ui/status-badge";
import { GenerateInvoicesButton } from "./generate-invoices-button";
import { MarkPaidForm } from "./mark-paid-form";
import { DeleteInvoiceButton } from "./delete-invoice-button";

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

function addMonths(referenceMonth: string, delta: number): string {
  const [year, month] = referenceMonth.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7);
}

export default async function MensalidadesPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes } = await searchParams;
  const referenceMonth = parseYearMonth(mes, new Date().toISOString().slice(0, 7));
  const previousMonth = addMonths(referenceMonth, -1);
  const nextMonthValue = addMonths(referenceMonth, 1);

  const user = await requireUser();
  const invoices = await withUser(user.id, async (tx) => {
    const { rows } = await tx.execute<{
      id: string;
      amount: number;
      due_date: string;
      paid_date: string | null;
      payment_method: string | null;
      effective_status: string;
      student_id: string | null;
      student_name: string | null;
      plan_name: string | null;
      has_enrollment: boolean;
    }>(sql`
      select i.id, i.amount, i.due_date, i.paid_date, i.payment_method, i.effective_status,
             s.id as student_id, s.full_name as student_name, p.name as plan_name,
             (e.id is not null) as has_enrollment
        from public.invoices_with_effective_status i
        left join public.enrollments e on e.id = i.enrollment_id
        left join public.students s on s.id = e.student_id
        left join public.plans p on p.id = e.plan_id
       where i.reference_month >= ${`${referenceMonth}-01`}::date
         and i.reference_month < ${`${nextMonthValue}-01`}::date
       order by i.due_date`);
    return rows.map(
      (r): InvoiceRow => ({
        id: r.id,
        amount: Number(r.amount),
        due_date: r.due_date,
        paid_date: r.paid_date,
        payment_method: r.payment_method,
        effective_status: r.effective_status,
        enrollments: r.has_enrollment
          ? {
              students: r.student_id ? { id: r.student_id, full_name: r.student_name ?? "" } : null,
              plans: r.plan_name ? { name: r.plan_name } : null,
            }
          : null,
      })
    );
  });

  const totals = invoices.reduce(
    (acc, invoice) => {
      acc[invoice.effective_status as "pago" | "atrasado" | "pendente"] += invoice.amount;
      return acc;
    },
    { pago: 0, atrasado: 0, pendente: 0 }
  );

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/mensalidades?mes=${previousMonth}`}
            className="rounded-md px-2 py-1 text-sm text-ink-300 hover:bg-white/[0.05] hover:text-ink-50"
          >
            ‹
          </Link>
          <p className="text-sm capitalize text-ink-300">
            {new Date(`${referenceMonth}-01`).toLocaleDateString("pt-BR", {
              month: "long",
              year: "numeric",
            })}
          </p>
          <Link
            href={`/mensalidades?mes=${nextMonthValue}`}
            className="rounded-md px-2 py-1 text-sm text-ink-300 hover:bg-white/[0.05] hover:text-ink-50"
          >
            ›
          </Link>
        </div>
        <GenerateInvoicesButton referenceMonth={referenceMonth} />
      </div>

      <div className="mt-4 rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-xs text-ink-300">
        Marcar como pago aqui não lança automaticamente no Fluxo de Caixa. O valor só aparece lá
        quando o extrato bancário correspondente for importado em Conciliação Bancária.
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
              <th className="px-4 py-3 font-medium"></th>
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
                  {invoice.effective_status !== "pago" && (
                    <MarkPaidForm
                      invoiceId={invoice.id}
                      amount={invoice.amount}
                      dueDate={invoice.due_date}
                    />
                  )}
                </td>
                <td className="px-4 py-3">
                  <DeleteInvoiceButton invoiceId={invoice.id} />
                </td>
              </tr>
            ))}
            {(!invoices || invoices.length === 0) && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-ink-500">
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
