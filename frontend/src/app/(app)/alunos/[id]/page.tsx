import { notFound } from "next/navigation";
import * as z from "zod";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { withUser, sequential } from "@/lib/db";
import {
  invoices as invoicesTable,
  plans as plansTable,
  students as studentsTable,
  teachers as teachersTable,
} from "@/lib/db/schema";
import { toPlan, toTeacher } from "@/lib/queries/mappers";
import { formatCurrencyBRL } from "@shared/finance";
import { StatusBadge } from "@/components/ui/status-badge";
import { EditStudentDialog } from "./edit-student-dialog";
import { DeleteStudentButton } from "./delete-student-button";

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
  const user = await requireUser();
  if (!z.uuid().safeParse(id).success) notFound();

  const data = await withUser(user.id, async (tx) => {
    const row = await tx.query.students.findFirst({
      where: eq(studentsTable.id, id),
      columns: { id: true, fullName: true, payerName: true, cpf: true, phone: true, email: true },
      with: {
        enrollments: {
          columns: { id: true, status: true, monthlyValue: true, dueDay: true, planId: true, teacherId: true },
          with: { plan: { columns: { name: true } }, teacher: { columns: { fullName: true } } },
        },
      },
    });
    if (!row) return null;

    const student: StudentDetail = {
      id: row.id,
      full_name: row.fullName,
      payer_name: row.payerName,
      cpf: row.cpf,
      phone: row.phone,
      email: row.email,
      enrollments: row.enrollments.map((e) => ({
        id: e.id,
        status: e.status,
        monthly_value: e.monthlyValue,
        due_day: e.dueDay,
        plan_id: e.planId,
        teacher_id: e.teacherId,
        plans: e.plan ? { name: e.plan.name } : null,
        teachers: e.teacher ? { full_name: e.teacher.fullName } : null,
      })),
    };

    const enrollmentIds = student.enrollments.map((e) => e.id);
    const [invoiceRows, planRows, teacherRows] = await sequential([
      () => enrollmentIds.length > 0
        ? tx
            .select({
              id: invoicesTable.id,
              reference_month: invoicesTable.referenceMonth,
              amount: invoicesTable.amount,
              due_date: invoicesTable.dueDate,
              paid_date: invoicesTable.paidDate,
              payment_method: invoicesTable.paymentMethod,
              status: invoicesTable.status,
            })
            .from(invoicesTable)
            .where(inArray(invoicesTable.enrollmentId, enrollmentIds))
            .orderBy(desc(invoicesTable.referenceMonth))
        : Promise.resolve([] as InvoiceRow[]),
      () => tx.select().from(plansTable).where(eq(plansTable.active, true)).orderBy(asc(plansTable.name)),
      () => tx.select().from(teachersTable).where(eq(teachersTable.active, true)).orderBy(asc(teachersTable.fullName)),
    ]);
    return { student, invoices: invoiceRows, plans: planRows.map(toPlan), teachers: teacherRows.map(toTeacher) };
  });

  if (!data) {
    notFound();
  }

  const { student, invoices, plans, teachers } = data;

  const enrollment = student.enrollments[0];

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink-50">{student.full_name}</h1>
        <div className="flex items-center gap-2">
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
            plans={plans}
            teachers={teachers}
          />
          <DeleteStudentButton studentId={student.id} studentName={student.full_name} />
        </div>
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
