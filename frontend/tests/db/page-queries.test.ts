import { describe, expect, it } from "vitest";
import { ensureUser } from "./helpers";

process.env.APP_SECRET ??= "0".repeat(64);
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";

const { withUser } = await import("@/lib/db");
const { getBankDivergences } = await import("@/lib/queries/bank-check");
const { listPayrollForMonth, getPayrollTotals } = await import("@/lib/queries/payroll");

/**
 * As consultas das páginas rodam de verdade no banco: um erro de SQL (coluna
 * inexistente, literal sem aspas) quebra o teste em vez de quebrar a tela.
 */
describe("consultas usadas pelas páginas", () => {
  it("Dashboard: conferência de saldo com o banco", async () => {
    const owner = await ensureUser("rls-owner@teste.local", "owner");
    const rows = await withUser(owner, (tx) => getBankDivergences(tx));
    expect(Array.isArray(rows)).toBe(true);
  });

  it("Professores: folha do mês com alunos ativos e receita", async () => {
    const owner = await ensureUser("rls-owner@teste.local", "owner");
    const [rows, totals] = await withUser(owner, async (tx) => [
      await listPayrollForMonth(tx, "2026-10-01"),
      await getPayrollTotals(tx, "2026-10-01"),
    ]);
    expect(Array.isArray(rows)).toBe(true);
    expect(typeof totals.confirmado).toBe("number");
  });
});
