"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { eq } from "drizzle-orm";
import { withUser, sequential } from "@/lib/db";
import { enrollments, plans, students, teachers } from "@/lib/db/schema";
import { logDbError } from "@/lib/db/errors";
import { FORBIDDEN_MESSAGE, getActionUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";

const MAX_ROWS = 1000;

const ImportRowSchema = z.object({
  fullName: z.string().trim().min(2, { error: "Nome do aluno é obrigatório." }).max(150),
  payerName: z.string().trim().max(150).nullable().optional(),
  cpf: z.string().trim().max(20).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.union([z.email().max(254), z.literal("")]).nullable().optional(),
  planName: z.string().trim().min(1, { error: "Plano é obrigatório." }).max(100),
  teacherName: z.string().trim().max(150).nullable().optional(),
  monthlyValue: z.coerce.number().min(0, { error: "Valor da mensalidade inválido." }).max(99_999_999),
  dueDay: z.coerce.number().int().min(1).max(28, { error: "Dia de vencimento inválido (1-28)." }),
});

export type ImportStudentRow = z.input<typeof ImportRowSchema>;

export type ImportRowResult = {
  row: number;
  fullName: string;
  success: boolean;
  error?: string;
};

export async function importStudents(rows: ImportStudentRow[]): Promise<ImportRowResult[]> {
  const user = await getActionUser(Policies.manageInvoices);
  if (!user) return [{ row: 0, fullName: "", success: false, error: FORBIDDEN_MESSAGE }];
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) {
    return [{ row: 0, fullName: "", success: false, error: `Envie no máximo ${MAX_ROWS} linhas por vez.` }];
  }

  return withUser(user.id, async (tx) => {
    const [activePlans, activeTeachers] = await sequential([
      () => tx.select({ id: plans.id, name: plans.name }).from(plans).where(eq(plans.active, true)),
      () => tx.select({ id: teachers.id, fullName: teachers.fullName }).from(teachers).where(eq(teachers.active, true)),
    ]);

    const planByName = new Map(activePlans.map((p) => [p.name.trim().toLowerCase(), p.id]));
    const teacherByName = new Map(activeTeachers.map((t) => [t.fullName.trim().toLowerCase(), t.id]));

    const results: ImportRowResult[] = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const parsed = ImportRowSchema.safeParse(rows[i]);

      if (!parsed.success) {
        const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
        results.push({
          row: rowNumber,
          fullName: String(rows[i]?.fullName ?? "").slice(0, 150),
          success: false,
          error: firstError ?? "Dados inválidos.",
        });
        continue;
      }

      const { fullName, payerName, cpf, phone, email, planName, teacherName, monthlyValue, dueDay } = parsed.data;

      const planId = planByName.get(planName.toLowerCase());
      if (!planId) {
        results.push({ row: rowNumber, fullName, success: false, error: `Plano "${planName}" não encontrado.` });
        continue;
      }

      const teacherId = teacherName ? teacherByName.get(teacherName.toLowerCase()) : undefined;
      if (teacherName && !teacherId) {
        results.push({ row: rowNumber, fullName, success: false, error: `Professor "${teacherName}" não encontrado.` });
        continue;
      }

      // Savepoint por linha: uma linha com erro não desfaz as demais, e aluno
      // + matrícula de uma mesma linha entram juntos ou não entram.
      try {
        await tx.transaction(async (row) => {
          const [student] = await row
            .insert(students)
            .values({
              fullName,
              payerName: payerName || null,
              cpf: cpf || null,
              phone: phone || null,
              email: email || null,
            })
            .returning({ id: students.id });
          await row.insert(enrollments).values({
            studentId: student.id,
            planId,
            teacherId: teacherId || null,
            monthlyValue,
            dueDay,
          });
        });
        results.push({ row: rowNumber, fullName, success: true });
      } catch (err) {
        logDbError("importStudents", err);
        results.push({ row: rowNumber, fullName, success: false, error: "Erro ao cadastrar aluno e matrícula." });
      }
    }

    revalidatePath("/alunos");
    return results;
  });
}
