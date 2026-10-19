import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";

export type BankDivergence = { label: string; banco: number; calculado: number };

/**
 * Conferência automática: saldo que o banco informa (última sincronização)
 * × saldo que o sistema calcula. Devolve só as contas com diferença > R$ 1.
 */
export async function getBankDivergences(tx: Tx): Promise<BankDivergence[]> {
  const { rows } = await tx.execute<{ label: string; banco: string; calculado: string }>(sql`
    select p.label, p.bank_balance as banco,
           coalesce((select sum(case when v.type = 'entrada' then v.amount else -v.amount end)
                       from public.cash_transactions_with_balance v
                      where v.bank_provider_id = p.id and v.in_balance), 0) as calculado
      from public.bank_providers p
     where p.active and p.bank_balance is not null`);
  return rows
    .map((row) => ({ label: row.label, banco: Number(row.banco), calculado: Number(row.calculado) }))
    .filter((row) => Math.abs(row.banco - row.calculado) > 1);
}
