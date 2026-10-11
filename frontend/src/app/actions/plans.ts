"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { eq } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { plans } from "@/lib/db/schema";
import { logDbError } from "@/lib/db/errors";
import { FORBIDDEN_MESSAGE, getActionUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";

const PlanSchema = z.object({
  name: z.string().trim().min(2, { error: "Informe o nome do plano." }).max(100),
  lessonsPerWeek: z.coerce.number().int().min(1, { error: "Aulas por semana inválido." }).max(14),
  monthlyValue: z.coerce.number().min(0, { error: "Valor inválido." }).max(99_999_999),
  avgDurationMonths: z.coerce.number().int().min(1, { error: "Duração média inválida." }).max(240),
});

export type PlanState =
  | { errors?: Record<string, string[]>; message?: string; success?: boolean }
  | undefined;

export async function createPlan(_state: PlanState, formData: FormData): Promise<PlanState> {
  const user = await getActionUser(Policies.ownerOrSocio);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const validated = PlanSchema.safeParse({
    name: formData.get("name"),
    lessonsPerWeek: formData.get("lessonsPerWeek"),
    monthlyValue: formData.get("monthlyValue"),
    avgDurationMonths: formData.get("avgDurationMonths"),
  });

  if (!validated.success) {
    return { errors: validated.error.flatten().fieldErrors };
  }

  try {
    await withUser(user.id, (tx) =>
      tx.insert(plans).values({
        name: validated.data.name,
        lessonsPerWeek: validated.data.lessonsPerWeek,
        monthlyValue: validated.data.monthlyValue,
        avgDurationMonths: validated.data.avgDurationMonths,
      })
    );
  } catch (err) {
    logDbError("createPlan", err);
    return { message: "Erro ao criar plano. Verifique se já existe um plano com esse nome." };
  }

  revalidatePath("/planos");
  return { success: true };
}

const UpdatePlanSchema = PlanSchema.extend({
  id: z.uuid(),
  active: z.boolean(),
});

export async function updatePlan(_state: PlanState, formData: FormData): Promise<PlanState> {
  const user = await getActionUser(Policies.ownerOrSocio);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const validated = UpdatePlanSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    lessonsPerWeek: formData.get("lessonsPerWeek"),
    monthlyValue: formData.get("monthlyValue"),
    avgDurationMonths: formData.get("avgDurationMonths"),
    active: formData.get("active") === "on" || formData.get("active") === "true",
  });

  if (!validated.success) {
    return { errors: validated.error.flatten().fieldErrors };
  }

  try {
    const updated = await withUser(user.id, (tx) =>
      tx
        .update(plans)
        .set({
          name: validated.data.name,
          lessonsPerWeek: validated.data.lessonsPerWeek,
          monthlyValue: validated.data.monthlyValue,
          avgDurationMonths: validated.data.avgDurationMonths,
          active: validated.data.active,
        })
        .where(eq(plans.id, validated.data.id))
        .returning({ id: plans.id })
    );
    if (updated.length === 0) return { message: "Plano não encontrado." };
  } catch (err) {
    logDbError("updatePlan", err);
    return { message: "Erro ao atualizar plano. Verifique se já existe um plano com esse nome." };
  }

  revalidatePath("/planos");
  revalidatePath("/alunos");
  return { success: true };
}
