import type { Plan, Teacher } from "@shared/types";
import type { plans, teachers } from "@/lib/db/schema";

/**
 * Os componentes e @shared/types usam os nomes de coluna do banco
 * (snake_case, como o Supabase devolvia); o Drizzle devolve camelCase.
 * Estes conversores mantêm os componentes de UI inalterados.
 */

export function toPlan(row: typeof plans.$inferSelect): Plan {
  return {
    id: row.id,
    name: row.name,
    lessons_per_week: row.lessonsPerWeek,
    monthly_value: row.monthlyValue,
    avg_duration_months: row.avgDurationMonths,
    active: row.active,
  };
}

export function toTeacher(row: typeof teachers.$inferSelect): Teacher {
  return {
    id: row.id,
    full_name: row.fullName,
    payment_rule_text: row.paymentRuleText,
    payment_reference_value: row.paymentReferenceValue,
    active: row.active,
  };
}
