"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { eq, sql } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { teachers } from "@/lib/db/schema";
import { logDbError } from "@/lib/db/errors";
import { FORBIDDEN_MESSAGE, getActionUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";

const PAYMENT_TYPES = ["por_hora", "comissao", "repasse_integral", "fixo", "outro"] as const;

const TeacherSchema = z.object({
  fullName: z.string().trim().min(2, { error: "Informe o nome do professor." }).max(150),
  paymentType: z.enum(PAYMENT_TYPES).default("outro"),
  paymentRuleText: z.string().max(500).nullable().optional(),
  paymentReferenceValue: z.coerce.number().min(0).max(99_999_999).nullable().optional(),
});

function readTeacher(formData: FormData) {
  const raw = formData.get("paymentReferenceValue");
  return {
    fullName: formData.get("fullName"),
    paymentType: formData.get("paymentType") ?? "outro",
    paymentRuleText: formData.get("paymentRuleText"),
    paymentReferenceValue: raw === null || raw === "" ? null : raw,
  };
}

export type TeacherFormState =
  | { errors?: Record<string, string[]>; message?: string; success?: boolean }
  | undefined;

export type CreateTeacherResult =
  | { success: true; teacher: { id: string; full_name: string } }
  | { success: false; error: string };

/** Mantido para compatibilidade com o cadastro rápido em /alunos. */
export async function createTeacher(formData: FormData): Promise<CreateTeacherResult> {
  const user = await getActionUser(Policies.ownerOrSocio);
  if (!user) return { success: false, error: FORBIDDEN_MESSAGE };

  const validated = TeacherSchema.safeParse(readTeacher(formData));
  if (!validated.success) {
    return { success: false, error: "Informe o nome do professor." };
  }

  try {
    const [teacher] = await withUser(user.id, (tx) =>
      tx
        .insert(teachers)
        .values({
          fullName: validated.data.fullName,
          paymentType: validated.data.paymentType,
          paymentRuleText: validated.data.paymentRuleText || null,
          paymentReferenceValue: validated.data.paymentReferenceValue || null,
        })
        .returning({ id: teachers.id, full_name: teachers.fullName }),
    );
    revalidatePath("/alunos");
    revalidatePath("/professores");
    return { success: true, teacher };
  } catch (err) {
    logDbError("createTeacher", err);
    return { success: false, error: "Erro ao cadastrar professor. Verifique se o nome já existe." };
  }
}

/** Cadastro completo na tela de Professores (useActionState). */
export async function createTeacherForm(
  _state: TeacherFormState,
  formData: FormData,
): Promise<TeacherFormState> {
  const user = await getActionUser(Policies.ownerOrSocio);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const validated = TeacherSchema.safeParse(readTeacher(formData));
  if (!validated.success) return { errors: validated.error.flatten().fieldErrors };

  try {
    await withUser(user.id, (tx) =>
      tx.insert(teachers).values({
        fullName: validated.data.fullName,
        paymentType: validated.data.paymentType,
        paymentRuleText: validated.data.paymentRuleText || null,
        paymentReferenceValue: validated.data.paymentReferenceValue || null,
      }),
    );
  } catch (err) {
    logDbError("createTeacherForm", err);
    return { message: "Erro ao cadastrar. Verifique se o nome já existe." };
  }

  revalidatePath("/professores");
  revalidatePath("/alunos");
  return { success: true };
}

const UpdateSchema = TeacherSchema.extend({ id: z.uuid() });

export async function updateTeacher(
  _state: TeacherFormState,
  formData: FormData,
): Promise<TeacherFormState> {
  const user = await getActionUser(Policies.ownerOrSocio);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const validated = UpdateSchema.safeParse({ id: formData.get("id"), ...readTeacher(formData) });
  if (!validated.success) return { errors: validated.error.flatten().fieldErrors };

  try {
    await withUser(user.id, (tx) =>
      tx
        .update(teachers)
        .set({
          fullName: validated.data.fullName,
          paymentType: validated.data.paymentType,
          paymentRuleText: validated.data.paymentRuleText || null,
          paymentReferenceValue: validated.data.paymentReferenceValue || null,
          updatedAt: sql`now()`,
        })
        .where(eq(teachers.id, validated.data.id)),
    );
  } catch (err) {
    logDbError("updateTeacher", err);
    return { message: "Erro ao atualizar o professor." };
  }

  revalidatePath("/professores");
  return { success: true };
}

export async function setTeacherActive(
  _state: TeacherFormState,
  formData: FormData,
): Promise<TeacherFormState> {
  const user = await getActionUser(Policies.ownerOrSocio);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { message: "Professor inválido." };
  const active = formData.get("active") === "true";

  try {
    await withUser(user.id, (tx) =>
      tx.update(teachers).set({ active, updatedAt: sql`now()` }).where(eq(teachers.id, id.data)),
    );
  } catch (err) {
    logDbError("setTeacherActive", err);
    return { message: "Erro ao alterar o status do professor." };
  }

  revalidatePath("/professores");
  return { success: true };
}
