"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import * as z from "zod";
import { withUser } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { logDbError } from "@/lib/db/errors";
import { FORBIDDEN_MESSAGE, getActionUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";

export type RolloverState =
  | { ok?: true; summary?: string; error?: string }
  | undefined;

/**
 * Dispara a virada de mês manualmente ("Rodar agora"). Chama a MESMA função
 * SQL que o agendador usa (public.run_monthly_rollover), então o resultado é
 * idêntico e idempotente. Só owner/socio.
 */
export async function runRolloverNow(): Promise<RolloverState> {
  const user = await getActionUser(Policies.manageFinance);
  if (!user) return { error: FORBIDDEN_MESSAGE };

  try {
    const result = await withUser(user.id, async (tx) => {
      const { rows } = await tx.execute<{ result: Record<string, unknown> }>(
        sql`select public.run_monthly_rollover('manual') as result`
      );
      return rows[0]?.result ?? {};
    });

    const inv = Number(result.invoices_created ?? 0);
    const pay = Number(result.payables_created ?? 0);
    const das = Number(result.das_created ?? 0);
    const fixed = Number(result.statuses_fixed ?? 0);

    const summary =
      "skipped" in result
        ? "Automação está desligada nas configurações."
        : `Virada concluída: ${inv} mensalidade(s), ${pay} conta(s) a pagar recorrente(s), ${das} DAS gerado(s), ${fixed} status atualizado(s).`;

    revalidatePath("/automacao");
    revalidatePath("/mensalidades");
    revalidatePath("/contas");
    revalidatePath("/impostos");
    revalidatePath("/dashboard");
    return { ok: true, summary };
  } catch (err) {
    logDbError("runRolloverNow", err);
    return { error: "Erro ao rodar a virada. Tente novamente." };
  }
}

const SettingsSchema = z.object({
  rollover_enabled: z.enum(["on", "off"]),
  invoice_generation_day: z.coerce.number().int().min(1).max(28),
  das_due_day: z.coerce.number().int().min(1).max(28),
  simples_anexo: z.enum(["III", "V"]),
});

export type SettingsState = { ok?: true; error?: string } | undefined;

/** Atualiza as configurações da automação e do Simples. Só owner/socio. */
export async function updateAutomationSettings(
  _state: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const user = await getActionUser(Policies.manageFinance);
  if (!user) return { error: FORBIDDEN_MESSAGE };

  const parsed = SettingsSchema.safeParse({
    rollover_enabled: formData.get("rollover_enabled") ?? "off",
    invoice_generation_day: formData.get("invoice_generation_day"),
    das_due_day: formData.get("das_due_day"),
    simples_anexo: formData.get("simples_anexo"),
  });
  if (!parsed.success) return { error: "Dados inválidos." };

  const entries: [string, unknown][] = [
    ["rollover_enabled", parsed.data.rollover_enabled === "on"],
    ["invoice_generation_day", parsed.data.invoice_generation_day],
    ["das_due_day", parsed.data.das_due_day],
    ["simples_anexo", parsed.data.simples_anexo],
  ];

  try {
    await withUser(user.id, async (tx) => {
      for (const [key, value] of entries) {
        await tx
          .insert(appSettings)
          .values({ key, value })
          .onConflictDoUpdate({ target: appSettings.key, set: { value } });
      }
    });
  } catch (err) {
    logDbError("updateAutomationSettings", err);
    return { error: "Erro ao salvar as configurações." };
  }

  revalidatePath("/automacao");
  revalidatePath("/impostos");
  revalidatePath("/dashboard");
  return { ok: true };
}
