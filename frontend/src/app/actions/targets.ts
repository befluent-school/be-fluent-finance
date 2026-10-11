"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { withUser } from "@/lib/db";
import { cacTargets, ltvCacTargets, revenueTargets, studentTargets } from "@/lib/db/schema";
import { logDbError } from "@/lib/db/errors";
import { FORBIDDEN_MESSAGE, getActionUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { money, referenceMonthDate } from "@/lib/validation";

export type TargetsState = { message?: string; success?: boolean } | undefined;

function done(): TargetsState {
  revalidatePath("/metas");
  revalidatePath("/dashboard");
  return { success: true };
}

const RevenueTargetSchema = z.object({
  referenceMonth: referenceMonthDate,
  targetAmount: money,
});

export async function upsertRevenueTarget(
  _state: TargetsState,
  formData: FormData
): Promise<TargetsState> {
  const user = await getActionUser(Policies.ownerOrSocio);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const parsed = RevenueTargetSchema.safeParse({
    referenceMonth: formData.get("referenceMonth"),
    targetAmount: formData.get("targetAmount"),
  });
  if (!parsed.success) {
    return { message: "Valor de meta de faturamento inválido." };
  }

  try {
    await withUser(user.id, (tx) =>
      tx
        .insert(revenueTargets)
        .values({ referenceMonth: parsed.data.referenceMonth, targetAmount: parsed.data.targetAmount })
        .onConflictDoUpdate({
          target: revenueTargets.referenceMonth,
          set: { targetAmount: parsed.data.targetAmount },
        })
    );
  } catch (err) {
    logDbError("upsertRevenueTarget", err);
    return { message: "Erro ao salvar meta de faturamento." };
  }
  return done();
}

const StudentTargetSchema = z.object({
  referenceMonth: referenceMonthDate,
  planId: z.uuid(),
  targetCount: z.coerce.number().int().min(0, { error: "Valor inválido." }).max(100_000),
});

export async function upsertStudentTarget(
  _state: TargetsState,
  formData: FormData
): Promise<TargetsState> {
  const user = await getActionUser(Policies.ownerOrSocio);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const parsed = StudentTargetSchema.safeParse({
    referenceMonth: formData.get("referenceMonth"),
    planId: formData.get("planId"),
    targetCount: formData.get("targetCount"),
  });
  if (!parsed.success) {
    return { message: "Meta de alunos por plano inválida." };
  }

  try {
    await withUser(user.id, (tx) =>
      tx
        .insert(studentTargets)
        .values({
          referenceMonth: parsed.data.referenceMonth,
          planId: parsed.data.planId,
          targetCount: parsed.data.targetCount,
        })
        .onConflictDoUpdate({
          target: [studentTargets.referenceMonth, studentTargets.planId],
          set: { targetCount: parsed.data.targetCount },
        })
    );
  } catch (err) {
    logDbError("upsertStudentTarget", err);
    return { message: "Erro ao salvar meta de alunos." };
  }
  return done();
}

const CacTargetSchema = z.object({
  referenceMonth: referenceMonthDate,
  maxCac: money,
});

export async function upsertCacTarget(
  _state: TargetsState,
  formData: FormData
): Promise<TargetsState> {
  const user = await getActionUser(Policies.ownerOrSocio);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const parsed = CacTargetSchema.safeParse({
    referenceMonth: formData.get("referenceMonth"),
    maxCac: formData.get("maxCac"),
  });
  if (!parsed.success) {
    return { message: "Valor de CAC máximo inválido." };
  }

  try {
    await withUser(user.id, (tx) =>
      tx
        .insert(cacTargets)
        .values({ referenceMonth: parsed.data.referenceMonth, maxCac: parsed.data.maxCac })
        .onConflictDoUpdate({ target: cacTargets.referenceMonth, set: { maxCac: parsed.data.maxCac } })
    );
  } catch (err) {
    logDbError("upsertCacTarget", err);
    return { message: "Erro ao salvar meta de CAC." };
  }
  return done();
}

const LtvCacTargetSchema = z.object({
  referenceMonth: referenceMonthDate,
  minRatio: z.coerce.number().min(0, { error: "Valor inválido." }).max(9999),
});

export async function upsertLtvCacTarget(
  _state: TargetsState,
  formData: FormData
): Promise<TargetsState> {
  const user = await getActionUser(Policies.ownerOrSocio);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const parsed = LtvCacTargetSchema.safeParse({
    referenceMonth: formData.get("referenceMonth"),
    minRatio: formData.get("minRatio"),
  });
  if (!parsed.success) {
    return { message: "Valor de razão LTV:CAC inválido." };
  }

  try {
    await withUser(user.id, (tx) =>
      tx
        .insert(ltvCacTargets)
        .values({ referenceMonth: parsed.data.referenceMonth, minRatio: parsed.data.minRatio })
        .onConflictDoUpdate({ target: ltvCacTargets.referenceMonth, set: { minRatio: parsed.data.minRatio } })
    );
  } catch (err) {
    logDbError("upsertLtvCacTarget", err);
    return { message: "Erro ao salvar meta de LTV:CAC." };
  }
  return done();
}
