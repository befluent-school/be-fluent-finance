"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";
import { and, eq } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { enrollments, students } from "@/lib/db/schema";
import { logDbError } from "@/lib/db/errors";
import { FORBIDDEN_MESSAGE, getActionUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const StudentFields = {
  fullName: z.string().trim().min(2, { error: "Informe o nome do aluno." }).max(150),
  payerName: optionalText(150),
  cpf: optionalText(20),
  phone: optionalText(30),
  email: z.union([z.email().max(254), z.literal("")]).nullable().optional(),
};

const EnrollStudentSchema = z.object({
  ...StudentFields,
  planId: z.uuid({ error: "Selecione um plano." }),
  teacherId: z.union([z.uuid(), z.literal("")]).nullable().optional(),
  monthlyValue: z.coerce.number().min(0, { error: "Valor inválido." }).max(99_999_999),
  dueDay: z.coerce.number().int().min(1).max(28, { error: "Dia de vencimento inválido (1-28)." }),
});

export type EnrollStudentState =
  | { errors?: Record<string, string[]>; message?: string; success?: boolean }
  | undefined;

export async function enrollStudent(
  _state: EnrollStudentState,
  formData: FormData
): Promise<EnrollStudentState> {
  const user = await getActionUser(Policies.manageInvoices);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const validated = EnrollStudentSchema.safeParse({
    fullName: formData.get("fullName"),
    payerName: formData.get("payerName"),
    cpf: formData.get("cpf"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    planId: formData.get("planId"),
    teacherId: formData.get("teacherId"),
    monthlyValue: formData.get("monthlyValue"),
    dueDay: formData.get("dueDay"),
  });

  if (!validated.success) {
    return { errors: validated.error.flatten().fieldErrors };
  }

  const { fullName, payerName, cpf, phone, email, planId, teacherId, monthlyValue, dueDay } =
    validated.data;

  try {
    // Aluno + matrícula na mesma transação: ou entram os dois, ou nenhum
    // (antes um erro na matrícula deixava o aluno cadastrado sem plano).
    await withUser(user.id, async (tx) => {
      const [student] = await tx
        .insert(students)
        .values({
          fullName,
          payerName: payerName || null,
          cpf: cpf || null,
          phone: phone || null,
          email: email || null,
        })
        .returning({ id: students.id });

      await tx.insert(enrollments).values({
        studentId: student.id,
        planId,
        teacherId: teacherId || null,
        monthlyValue,
        dueDay,
      });
    });
  } catch (err) {
    logDbError("enrollStudent", err);
    return { message: "Erro ao cadastrar aluno. Verifique os dados e tente novamente." };
  }

  revalidatePath("/alunos");
  return { success: true };
}

const UpdateStudentSchema = z.object({
  studentId: z.uuid(),
  ...StudentFields,
  enrollmentId: z.union([z.uuid(), z.literal("")]).nullable().optional(),
  planId: z.union([z.uuid(), z.literal("")]).nullable().optional(),
  teacherId: z.union([z.uuid(), z.literal("")]).nullable().optional(),
  monthlyValue: z.coerce.number().min(0).max(99_999_999).nullable().optional(),
  dueDay: z.coerce.number().int().min(1).max(28).nullable().optional(),
});

export type UpdateStudentState =
  | { errors?: Record<string, string[]>; message?: string; success?: boolean }
  | undefined;

export async function updateStudent(
  _state: UpdateStudentState,
  formData: FormData
): Promise<UpdateStudentState> {
  const user = await getActionUser(Policies.manageInvoices);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const validated = UpdateStudentSchema.safeParse({
    studentId: formData.get("studentId"),
    fullName: formData.get("fullName"),
    payerName: formData.get("payerName"),
    cpf: formData.get("cpf"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    enrollmentId: formData.get("enrollmentId"),
    planId: formData.get("planId"),
    teacherId: formData.get("teacherId"),
    monthlyValue: formData.get("monthlyValue"),
    dueDay: formData.get("dueDay"),
  });

  if (!validated.success) {
    return { errors: validated.error.flatten().fieldErrors };
  }

  const {
    studentId,
    fullName,
    payerName,
    cpf,
    phone,
    email,
    enrollmentId,
    planId,
    teacherId,
    monthlyValue,
    dueDay,
  } = validated.data;

  try {
    const result = await withUser(user.id, async (tx) => {
      const updated = await tx
        .update(students)
        .set({
          fullName,
          payerName: payerName || null,
          cpf: cpf || null,
          phone: phone || null,
          email: email || null,
        })
        .where(eq(students.id, studentId))
        .returning({ id: students.id });
      if (updated.length === 0) return "not_found" as const;

      if (enrollmentId) {
        // A matrícula precisa ser deste aluno (antes bastava saber o id de qualquer matrícula).
        await tx
          .update(enrollments)
          .set({
            ...(planId ? { planId } : {}),
            teacherId: teacherId || null,
            ...(monthlyValue != null ? { monthlyValue } : {}),
            ...(dueDay != null ? { dueDay } : {}),
          })
          .where(and(eq(enrollments.id, enrollmentId), eq(enrollments.studentId, studentId)));
      }
      return "ok" as const;
    });
    if (result === "not_found") return { message: "Aluno não encontrado." };
  } catch (err) {
    logDbError("updateStudent", err);
    return { message: "Erro ao atualizar aluno." };
  }

  revalidatePath("/alunos");
  revalidatePath(`/alunos/${studentId}`);
  return { success: true };
}

export async function deleteStudent(studentId: string): Promise<{ error?: string }> {
  const user = await getActionUser(Policies.manageInvoices);
  if (!user) return { error: FORBIDDEN_MESSAGE };
  if (!z.uuid().safeParse(studentId).success) return { error: "Aluno inválido." };

  try {
    const deleted = await withUser(user.id, (tx) =>
      tx.delete(students).where(eq(students.id, studentId)).returning({ id: students.id })
    );
    if (deleted.length === 0) return { error: "Aluno não encontrado." };
  } catch (err) {
    logDbError("deleteStudent", err);
    return { error: "Erro ao excluir aluno. Tente novamente." };
  }

  revalidatePath("/alunos");
  redirect("/alunos");
}
