"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";

const PlanSchema = z.object({
  name: z.string().min(2, { error: "Informe o nome do plano." }),
  lessonsPerWeek: z.coerce.number().int().min(1, { error: "Aulas por semana inválido." }),
  monthlyValue: z.coerce.number().min(0, { error: "Valor inválido." }),
  avgDurationMonths: z.coerce.number().int().min(1, { error: "Duração média inválida." }),
});

export type PlanState =
  | { errors?: Record<string, string[]>; message?: string; success?: boolean }
  | undefined;

export async function createPlan(_state: PlanState, formData: FormData): Promise<PlanState> {
  const validated = PlanSchema.safeParse({
    name: formData.get("name"),
    lessonsPerWeek: formData.get("lessonsPerWeek"),
    monthlyValue: formData.get("monthlyValue"),
    avgDurationMonths: formData.get("avgDurationMonths"),
  });

  if (!validated.success) {
    return { errors: validated.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("plans").insert({
    name: validated.data.name,
    lessons_per_week: validated.data.lessonsPerWeek,
    monthly_value: validated.data.monthlyValue,
    avg_duration_months: validated.data.avgDurationMonths,
  });

  if (error) {
    return { message: "Erro ao criar plano. Verifique se já existe um plano com esse nome." };
  }

  revalidatePath("/planos");
  return { success: true };
}

const UpdatePlanSchema = PlanSchema.extend({
  id: z.uuid(),
  active: z.coerce.boolean(),
});

export async function updatePlan(_state: PlanState, formData: FormData): Promise<PlanState> {
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

  const supabase = await createClient();
  const { error } = await supabase
    .from("plans")
    .update({
      name: validated.data.name,
      lessons_per_week: validated.data.lessonsPerWeek,
      monthly_value: validated.data.monthlyValue,
      avg_duration_months: validated.data.avgDurationMonths,
      active: validated.data.active,
    })
    .eq("id", validated.data.id);

  if (error) {
    return { message: "Erro ao atualizar plano. Verifique se já existe um plano com esse nome." };
  }

  revalidatePath("/planos");
  revalidatePath("/alunos");
  return { success: true };
}
