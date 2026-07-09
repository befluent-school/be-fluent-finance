import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCurrencyBRL } from "@shared/finance";
import type { Plan, Teacher } from "@shared/types";
import { StatusBadge } from "@/components/ui/status-badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { initials } from "@/lib/utils";
import { EnrollStudentForm } from "./enroll-student-form";
import { ImportStudentsDialog } from "./import-students-dialog";

type StudentRow = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  enrollments: {
    status: string;
    monthly_value: number;
    plan_id: string;
    plans: { name: string } | null;
    teachers: { full_name: string } | null;
  }[];
};

export default async function AlunosPage({
  searchParams,
}: {
  searchParams: Promise<{ plano?: string }>;
}) {
  const { plano } = await searchParams;
  const supabase = await createClient();

  const [{ data: students }, { data: plans }, { data: teachers }] = await Promise.all([
    supabase
      .from("students")
      .select(
        "id, full_name, phone, email, active, enrollments(status, monthly_value, plan_id, plans(name), teachers(full_name))"
      )
      .order("full_name")
      .returns<StudentRow[]>(),
    supabase.from("plans").select("*").eq("active", true).returns<Plan[]>(),
    supabase.from("teachers").select("*").eq("active", true).returns<Teacher[]>(),
  ]);

  const activeStudents = (students ?? []).filter((s) =>
    s.enrollments.some((e) => e.status === "active")
  );

  const countByPlan = new Map<string, number>();
  for (const student of activeStudents) {
    const planId = student.enrollments[0]?.plan_id;
    if (planId) countByPlan.set(planId, (countByPlan.get(planId) ?? 0) + 1);
  }

  const filteredStudents = plano
    ? (students ?? []).filter((s) => s.enrollments[0]?.plan_id === plano)
    : students;

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-300">Cadastro e matrículas de mentoria individual.</p>
        <div className="flex gap-3">
          <ImportStudentsDialog />
          <EnrollStudentForm plans={plans ?? []} teachers={teachers ?? []} />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {(plans ?? []).map((plan) => (
          <Link key={plan.id} href={`/alunos?plano=${plan.id}`}>
            <KpiCard label={plan.name} value={String(countByPlan.get(plan.id) ?? 0)} hint="alunos ativos" />
          </Link>
        ))}
      </div>

      {plano && (
        <div className="mt-4 flex items-center gap-2 text-sm text-ink-300">
          <span>
            Filtrando por: <span className="text-ink-50">{plans?.find((p) => p.id === plano)?.name}</span>
          </span>
          <Link href="/alunos" className="text-amber-400 hover:text-amber-300">
            Limpar filtro
          </Link>
        </div>
      )}

      <div className="mt-6 card-premium overflow-x-auto rounded-md">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-white/[0.03] text-left text-xs text-ink-300">
              <th className="px-4 py-3 font-medium">Aluno</th>
              <th className="px-4 py-3 font-medium">Plano</th>
              <th className="px-4 py-3 font-medium">Professor</th>
              <th className="px-4 py-3 font-medium">Mensalidade</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredStudents?.map((student) => {
              const enrollment = student.enrollments[0];
              return (
                <tr
                  key={student.id}
                  className="border-b border-ink-700/70 last:border-0 hover:bg-white/[0.03]"
                >
                  <td className="px-4 py-3">
                    <Link href={`/alunos/${student.id}`} className="flex items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-xs font-semibold text-amber-400">
                        {initials(student.full_name)}
                      </span>
                      <span className="font-medium text-ink-50 hover:text-amber-400">
                        {student.full_name}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">{enrollment?.plans?.name ?? "—"}</td>
                  <td className="px-4 py-3">{enrollment?.teachers?.full_name ?? "A definir"}</td>
                  <td className="font-tabular px-4 py-3">
                    {enrollment ? formatCurrencyBRL(enrollment.monthly_value) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {enrollment ? <StatusBadge status={enrollment.status} /> : "—"}
                  </td>
                </tr>
              );
            })}
            {filteredStudents?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-500">
                  {plano ? "Nenhum aluno neste plano." : "Nenhum aluno cadastrado ainda."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
