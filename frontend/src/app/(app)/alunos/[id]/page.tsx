import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatCurrencyBRL } from "@shared/finance";
import type { Plan, Teacher } from "@shared/types";
import { StatusBadge } from "@/components/ui/status-badge";
import { EditStudentDialog } from "./edit-student-dialog";

type InvoiceRow = {
  id: string;
  reference_month: string;
  amount: number;
  due_date: string;
  paid_date: string | null;
  payment_method: string | null;
  status: string;
};

type StudentDetail = {
  id: string;
  full_name: string;
  payer_name: string | null;
  cpf: string | null;
  phone: string | null;
  email: string | null;
  enrollments: {
    id: string;
    status: string;
    monthly_value: number;
    due_day: number;
    plan_id: string;
    teacher_id: string | null;
    plans: { name: string } | null;
    teachers: { full_name: string } | null;
  }[];
};

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: student } = await supabase
    .from("students")
    .select(
      "id, full_name, payer_name, cpf, phone, email, enrollments(id, status, monthly_value, due_day, plan_id, teacher_id, plans(name), teachers(full_name))"
    )
    .eq("id", id)
    .single<StudentDetail>();

  if (!student) {
    notFound();
  }

  const enrollmentIds = student.enrollments.map((e: { id: string }) => e.id);

  const [{ data: invoices }, { data: plans }, { data: teachers }] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, reference_month, amount, due_date, paid_date, payment_method, status")
      .in("enrollment_id", enrollmentIds.length > 0 ? enrollmentIds : [""])
      .order("reference_month", { ascending: false })
      .returns<InvoiceRow[]>(),
    supabase.from("plans").select("*").eq("active", true).returns<Plan[]>(),
    supabase.from("teachers").select("*").eq("active", true).returns<Teacher[]>(),
  ]);

  const enrollment = student.enrollments[0];

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink-50">{student.full_name}</h1>
        <EditStudentDialog
          student={student}
          enrollment={
            enrollment
              ? {
                  id: enrollment.id,
                  monthly_value: enrollment.monthly_value,
                  due_day: enrollment.due_day,
                  plan_id: enrollment.plan_id,
                  teacher_id: enrollment.teacher_id,
                }
              : null
          }
          plans={plans ?? []}
          teachers={teachers ?? []}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-300">
        {student.payer_name && <span>Responsável: {student.payer_name}</span>}
        {student.phone && <span>{student.phone}</span>}
        {student.email && <span>{student.email}</span>}
        {student.cpf && <span>CPF: {student.cpf}</span>}
      </div>

      {enrollment && (
        <div className="mt-4 inline-flex flex-wrap items-center gap-4 rounded-md border border-ink-700 bg-ink-800/40 px-4 py-3 text-sm">
          <span>
            Plano: <strong className="text-ink-50">{enrollment.plans?.name}</strong>
          </span>
          <span>
            Mensalidade:{" "}
            <strong className="font-tabular text-ink-50">
              {formatCurrencyBRL(enrollment.monthly_value)}
            </strong>
          </span>
          <span>
            Professor:{" "}
            <strong className="text-ink-50">
              {enrollment.teachers?.full_name ?? "A definir"}
            </strong>
          </span>
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Histórico de pagamentos</h2>
      <div className="mt-3 card-premium overflow-x-auto rounded-md">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-white/[0.03] text-left text-xs text-ink-300">
              <th className="px-4 py-3 font-medium">Mês de referência</th>
              <th className="px-4 py-3 font-medium">Valor</th>
              <th className="px-4 py-3 font-medium">Vencimento</th>
              <th className="px-4 py-3 font-medium">Pagamento</th>
              <th className="px-4 py-3 font-medium">Forma</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {invoices?.map((invoice) => (
              <tr
                key={invoice.id}
                className="border-b border-ink-700/70 last:border-0 hover:bg-white/[0.03]"
              >
                <td className="px-4 py-3">
                  {new Date(invoice.reference_month).toLocaleDateString("pt-BR", {
                    month: "long",
                    year: "numeric",
                  })}
                </td>
                <td className="font-tabular px-4 py-3">{formatCurrencyBRL(invoice.amount)}</td>
                <td className="font-tabular px-4 py-3">
                  {new Date(invoice.due_date).toLocaleDateString("pt-BR")}
                </td>
                <td className="font-tabular px-4 py-3">
                  {invoice.paid_date
                    ? new Date(invoice.paid_date).toLocaleDateString("pt-BR")
                    : "—"}
                </td>
                <td className="px-4 py-3">{invoice.payment_method ?? "—"}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={invoice.status} />
                </td>
              </tr>
            ))}
            {(!invoices || invoices.length === 0) && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-500">
                  Nenhuma mensalidade lançada ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
