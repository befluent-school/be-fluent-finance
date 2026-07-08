"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { createClient } from "@/lib/supabase/server";

export type TargetsState = { message?: string; success?: boolean } | undefined;

const RevenueTargetSchema = z.object({
  referenceMonth: z.string().min(1),
  targetAmount: z.coerce.number().min(0, { error: "Valor inválido." }),
});

export async function upsertRevenueTarget(
  _state: TargetsState,
  formData: FormData
): Promise<TargetsState> {
  const parsed = RevenueTargetSchema.safeParse({
    referenceMonth: formData.get("referenceMonth"),
    targetAmount: formData.get("targetAmount"),
  });

  if (!parsed.success) {
    return { message: "Valor de meta de faturamento inválido." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("revenue_targets")
    .upsert(
      { reference_month: parsed.data.referenceMonth, target_amount: parsed.data.targetAmount },
      { onConflict: "reference_month" }
    );

  if (error) {
    return { message: "Erro ao salvar meta de faturamento." };
  }

  revalidatePath("/metas");
  revalidatePath("/dashboard");
  return { success: true };
}

const StudentTargetSchema = z.object({
  referenceMonth: z.string().min(1),
  planId: z.uuid(),
  targetCount: z.coerce.number().int().min(0, { error: "Valor inválido." }),
});

export async function upsertStudentTarget(
  _state: TargetsState,
  formData: FormData
): Promise<TargetsState> {
  const parsed = StudentTargetSchema.safeParse({
    referenceMonth: formData.get("referenceMonth"),
    planId: formData.get("planId"),
    targetCount: formData.get("targetCount"),
  });

  if (!parsed.success) {
    return { message: "Meta de alunos por plano inválida." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("student_targets").upsert(
    {
      reference_month: parsed.data.referenceMonth,
      plan_id: parsed.data.planId,
      target_count: parsed.data.targetCount,
    },
    { onConflict: "reference_month,plan_id" }
  );

  if (error) {
    return { message: "Erro ao salvar meta de alunos." };
  }

  revalidatePath("/metas");
  revalidatePath("/dashboard");
  return { success: true };
}

const CacTargetSchema = z.object({
  referenceMonth: z.string().min(1),
  maxCac: z.coerce.number().min(0, { error: "Valor inválido." }),
});

export async function upsertCacTarget(
  _state: TargetsState,
  formData: FormData
): Promise<TargetsState> {
  const parsed = CacTargetSchema.safeParse({
    referenceMonth: formData.get("referenceMonth"),
    maxCac: formData.get("maxCac"),
  });

  if (!parsed.success) {
    return { message: "Valor de CAC máximo inválido." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("cac_targets")
    .upsert(
      { reference_month: parsed.data.referenceMonth, max_cac: parsed.data.maxCac },
      { onConflict: "reference_month" }
    );

  if (error) {
    return { message: "Erro ao salvar meta de CAC." };
  }

  revalidatePath("/metas");
  revalidatePath("/dashboard");
  return { success: true };
}

const LtvCacTargetSchema = z.object({
  referenceMonth: z.string().min(1),
  minRatio: z.coerce.number().min(0, { error: "Valor inválido." }),
});

export async function upsertLtvCacTarget(
  _state: TargetsState,
  formData: FormData
): Promise<TargetsState> {
  const parsed = LtvCacTargetSchema.safeParse({
    referenceMonth: formData.get("referenceMonth"),
    minRatio: formData.get("minRatio"),
  });

  if (!parsed.success) {
    return { message: "Valor de razão LTV:CAC inválido." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("ltv_cac_targets")
    .upsert(
      { reference_month: parsed.data.referenceMonth, min_ratio: parsed.data.minRatio },
      { onConflict: "reference_month" }
    );

  if (error) {
    return { message: "Erro ao salvar meta de LTV:CAC." };
  }

  revalidatePath("/metas");
  revalidatePath("/dashboard");
  return { success: true };
}
