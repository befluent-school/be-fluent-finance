"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { logDbError } from "@/lib/db/errors";
import { FORBIDDEN_MESSAGE, getActionUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { referenceMonthDate } from "@/lib/validation";

export type ReceitaState = { message?: string; success?: boolean } | undefined;

/** Aceita "18.234,35", "18234,35" e "18234.35". */
function parseBrl(raw: string): number | null {
  const s = raw.trim().replace(/^R\$\s*/, "");
  if (s === "") return null;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 && n <= 99_999_999_999.99 ? Math.round(n * 100) / 100 : NaN;
}

export async function saveReceitaInformada(_state: ReceitaState, formData: FormData): Promise<ReceitaState> {
  const user = await getActionUser(Policies.manageFinance);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const entries: { month: string; value: number | null }[] = [];
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("receita_") || typeof raw !== "string") continue;
    const month = key.slice("receita_".length);
    if (!referenceMonthDate.safeParse(month).success) continue;
    const value = parseBrl(raw);
    if (Number.isNaN(value)) {
      return { message: `Valor inválido em ${month.slice(5, 7)}/${month.slice(0, 4)}.` };
    }
    entries.push({ month, value });
  }

  try {
    await withUser(user.id, async (tx) => {
      for (const { month, value } of entries) {
        if (value === null) {
          await tx.execute(sql`delete from public.simples_receita_informada where reference_month = ${month}::date`);
        } else {
          await tx.execute(sql`
            insert into public.simples_receita_informada (reference_month, receita_bruta)
            values (${month}::date, ${value})
            on conflict (reference_month) do update set receita_bruta = excluded.receita_bruta`);
        }
      }
    });
  } catch (err) {
    logDbError("saveReceitaInformada", err);
    return { message: "Erro ao salvar a receita declarada." };
  }

  revalidatePath("/impostos");
  revalidatePath("/dashboard");
  return { success: true };
}
