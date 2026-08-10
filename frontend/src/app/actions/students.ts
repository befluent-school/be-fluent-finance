"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";

const EnrollStudentSchema = z.object({
  fullName: z.string().min(2, { error: "Informe o nome do aluno." }),
  payerName: z.string().nullable().optional(),
  cpf: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.union([z.email(), z.literal("")]).nullable().optional(),
  planId: z.uuid({ error: "Selecione um plano." }),
  teacherId: z.union([z.uuid(), z.literal("")]).nullable().optional(),
  monthlyValue: z.coerce.number().min(0, { error: "Valor inválido." }),
  dueDay: z.coerce.number().int().min(1).max(28, { error: "Dia de vencimento inválido (1-28)." }),
});

export type EnrollStudentState =
  | { errors?: Record<string, string[]>; message?: string; success?: boolean }
  | undefined;

export async function enrollStudent(
  _state: EnrollStudentState,
  formData: FormData
): Promise<EnrollStudentState> {
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

  const supabase = await createClient();

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
    return { message: "Erro ao cadastrar aluno. Verifique os dados e tente novamente." };
  }

  const { error: enrollmentError } = await supabase.from("enrollments").insert({
    student_id: student.id,
    plan_id: planId,
    teacher_id: teacherId || null,
    monthly_value: monthlyValue,
    due_day: dueDay,
  });

  if (enrollmentError) {
    return { message: "Aluno cadastrado, mas houve erro ao criar a matrícula." };
  }

  revalidatePath("/alunos");
  return { success: true };
}

const UpdateStudentSchema = z.object({
  studentId: z.uuid(),
  fullName: z.string().min(2, { error: "Informe o nome do aluno." }),
  payerName: z.string().nullable().optional(),
  cpf: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.union([z.email(), z.literal("")]).nullable().optional(),
  enrollmentId: z.union([z.uuid(), z.literal("")]).nullable().optional(),
  planId: z.union([z.uuid(), z.literal("")]).nullable().optional(),
  teacherId: z.union([z.uuid(), z.literal("")]).nullable().optional(),
  monthlyValue: z.coerce.number().min(0).nullable().optional(),
  dueDay: z.coerce.number().int().min(1).max(28).nullable().optional(),
});

export type UpdateStudentState =
  | { errors?: Record<string, string[]>; message?: string; success?: boolean }
  | undefined;

export async function updateStudent(
  _state: UpdateStudentState,
  formData: FormData
): Promise<UpdateStudentState> {
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

  const supabase = await createClient();

  const { error: studentError } = await supabase
    .from("students")
    .update({
      full_name: fullName,
      payer_name: payerName || null,
      cpf: cpf || null,
      phone: phone || null,
      email: email || null,
    })
    .eq("id", studentId);

  if (studentError) {
    return { message: "Erro ao atualizar aluno." };
  }

  if (enrollmentId) {
    const { error: enrollmentError } = await supabase
      .from("enrollments")
      .update({
        plan_id: planId || undefined,
        teacher_id: teacherId || null,
        monthly_value: monthlyValue ?? undefined,
        due_day: dueDay ?? undefined,
      })
      .eq("id", enrollmentId);

    if (enrollmentError) {
      return { message: "Aluno atualizado, mas houve erro ao atualizar a matrícula." };
    }
  }

  revalidatePath("/alunos");
  revalidatePath(`/alunos/${studentId}`);
  return { success: true };
}

export async function deleteStudent(studentId: string): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { error } = await supabase.from("students").delete().eq("id", studentId);

  if (error) {
    return { error: "Erro ao excluir aluno. Tente novamente." };
  }

  revalidatePath("/alunos");
  redirect("/alunos");
}
