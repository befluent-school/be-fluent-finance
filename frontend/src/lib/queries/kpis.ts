import "server-only";
import { and, count, eq, lt, sql } from "drizzle-orm";
import { sequential, type Tx } from "@/lib/db";
import { cacTargets, enrollments, ltvCacTargets, revenueTargets, tasks } from "@/lib/db/schema";

/**
 * Consultas às views de indicadores (db/migrations/0011). As views usam
 * security_invoker: o RLS das tabelas de origem vale para quem consulta.
 */

export async function getMrr(tx: Tx): Promise<number> {
  const { rows } = await tx.execute<{ mrr: number }>(sql`select mrr from public.v_mrr`);
  return Number(rows[0]?.mrr ?? 0);
}

export type PlanTicket = {
  plan_id: string;
  plan_name: string;
  active_students: number;
  ticket_medio: number;
  ltv_medio: number;
};

export async function getTicketByPlan(tx: Tx): Promise<PlanTicket[]> {
  const { rows } = await tx.execute<PlanTicket>(
    sql`select plan_id, plan_name, active_students, ticket_medio, ltv_medio from public.v_ticket_medio_por_plano`
  );
  return rows.map((r) => ({
    ...r,
    active_students: Number(r.active_students),
    ticket_medio: Number(r.ticket_medio),
    ltv_medio: Number(r.ltv_medio ?? 0),
  }));
}

export type CacMonth = { marketing_spend: number; new_students: number; cac: number | null };

export async function getCacForMonth(tx: Tx, referenceMonth: string): Promise<CacMonth | null> {
  const { rows } = await tx.execute<CacMonth>(
    sql`select marketing_spend, new_students, cac from public.v_cac_by_month where reference_month = ${referenceMonth}::date`
  );
  const r = rows[0];
  return r
    ? {
        marketing_spend: Number(r.marketing_spend),
        new_students: Number(r.new_students),
        cac: r.cac == null ? null : Number(r.cac),
      }
    : null;
}

export async function getInadimplencia(tx: Tx): Promise<{ total_atrasado: number; faturas_atrasadas: number }> {
  const { rows } = await tx.execute<{ total_atrasado: number; faturas_atrasadas: number }>(
    sql`select total_atrasado, faturas_atrasadas from public.v_inadimplencia_atual`
  );
  return {
    total_atrasado: Number(rows[0]?.total_atrasado ?? 0),
    faturas_atrasadas: Number(rows[0]?.faturas_atrasadas ?? 0),
  };
}

export async function getMonthTargets(tx: Tx, referenceMonth: string) {
  const [[revenue], [cac], [ltvCac]] = await sequential([
    () => tx.select({ targetAmount: revenueTargets.targetAmount }).from(revenueTargets).where(eq(revenueTargets.referenceMonth, referenceMonth)),
    () => tx.select({ maxCac: cacTargets.maxCac }).from(cacTargets).where(eq(cacTargets.referenceMonth, referenceMonth)),
    () => tx.select({ minRatio: ltvCacTargets.minRatio }).from(ltvCacTargets).where(eq(ltvCacTargets.referenceMonth, referenceMonth)),
    ]);
  return {
    revenueTarget: revenue?.targetAmount ?? null,
    maxCac: cac?.maxCac ?? null,
    minLtvCacRatio: ltvCac?.minRatio ?? null,
  };
}

export async function countActiveEnrollments(tx: Tx): Promise<number> {
  const [{ value }] = await tx.select({ value: count() }).from(enrollments).where(eq(enrollments.status, "active"));
  return value;
}

export async function countOverdueTasks(tx: Tx, today: string): Promise<number> {
  const [{ value }] = await tx
    .select({ value: count() })
    .from(tasks)
    .where(and(eq(tasks.completed, false), lt(tasks.dueDate, today)));
  return value;
}
