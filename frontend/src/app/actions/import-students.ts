"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";

const ImportRowSchema = z.object({
  fullName: z.string().min(2, { error: "Nome do aluno é obrigatório." }),
  payerName: z.string().nullable().optional(),
  cpf: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.union([z.email(), z.literal("")]).nullable().optional(),
  planName: z.string().min(1, { error: "Plano é obrigatório." }),
  teacherName: z.string().nullable().optional(),
  monthlyValue: z.coerce.number().min(0, { error: "Valor da mensalidade inválido." }),
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
  const supabase = await createClient();

  const [{ data: plans }, { data: teachers }] = await Promise.all([
    supabase.from("plans").select("id, name").eq("active", true),
    supabase.from("teachers").select("id, full_name").eq("active", true),
  ]);

  const planByName = new Map((plans ?? []).map((p) => [p.name.trim().toLowerCase(), p.id]));
  const teacherByName = new Map(
    (teachers ?? []).map((t) => [t.full_name.trim().toLowerCase(), t.id])
  );

  const results: ImportRowResult[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 1;
    const parsed = ImportRowSchema.safeParse(rows[i]);

    if (!parsed.success) {
      const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
      results.push({
        row: rowNumber,
        fullName: String(rows[i]?.fullName ?? ""),
        success: false,
        error: firstError ?? "Dados inválidos.",
      });
      continue;
    }

    const {
      fullName,
      payerName,
      cpf,
      phone,
      email,
      planName,
      teacherName,
      monthlyValue,
      dueDay,
    } = parsed.data;

    const planId = planByName.get(planName.trim().toLowerCase());
    if (!planId) {
      results.push({
        row: rowNumber,
        fullName,
        success: false,
        error: `Plano "${planName}" não encontrado.`,
      });
      continue;
    }

    const teacherId = teacherName ? teacherByName.get(teacherName.trim().toLowerCase()) : undefined;
    if (teacherName && !teacherId) {
      results.push({
        row: rowNumber,
        fullName,
        success: false,
        error: `Professor "${teacherName}" não encontrado.`,
      });
      continue;
    }

    const { data: student, error: studentError } = await supabase
      .from("students")
      .insert({
        full_name: fullName,
        payer_name: payerName || null,
        cpf: cpf || null,
        phone: phone || null,
        email: email || null,
      })
      .select("id")
      .single();

    if (studentError || !student) {
      results.push({
        row: rowNumber,
        fullName,
        success: false,
        error: "Erro ao cadastrar aluno.",
      });
      continue;
    }

    const { error: enrollmentError } = await supabase.from("enrollments").insert({
      student_id: student.id,
      plan_id: planId,
      teacher_id: teacherId || null,
      monthly_value: monthlyValue,
      due_day: dueDay,
    });

    if (enrollmentError) {
      results.push({
        row: rowNumber,
        fullName,
        success: false,
        error: "Aluno cadastrado, mas houve erro ao criar a matrícula.",
      });
      continue;
    }

    results.push({ row: rowNumber, fullName, success: true });
  }

  revalidatePath("/alunos");
  return results;
}
