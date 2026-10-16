import { describe, expect, it } from "vitest";
import { asUser, ensureUser } from "./helpers";

describe("saldo acumulado ancorado no saldo inicial", () => {
  it("ignora lançamentos anteriores ao saldo inicial e o aplica primeiro no dia", async () => {
    const owner = await ensureUser("rls-owner@teste.local", "owner");
    await asUser(owner, async (c) => {
      const { rows: [p] } = await c.query(
        `insert into public.bank_providers (provider, label, active) values ('asaas', '__saldo_test__', true) returning id`
      );
      const ins = (date: string, type: string, amount: number, source: string, createdAt: string, key: string) =>
        c.query(
          `insert into public.cash_transactions
             (date, description, amount, type, source, bank_provider_id, dedupe_key, created_at)
           values ($1, $5, $3, $2, $4, $6, $5, $7)`,
          [date, type, amount, source, key, p.id, createdAt]
        );
      await ins("2020-01-10", "entrada", 50, "asaas", "2020-01-10T10:00:00Z", "__t_antes");
      await ins("2020-01-15", "saida", 30, "asaas", "2020-01-15T10:00:00Z", "__t_mesmo_dia");
      await ins("2020-01-15", "entrada", 100, "opening", "2020-02-01T10:00:00Z", "__t_abertura");
      await ins("2020-01-16", "entrada", 20, "asaas", "2020-01-16T10:00:00Z", "__t_depois");

      const { rows } = await c.query(
        `select dedupe_key, running_balance::float as saldo, in_balance
           from public.cash_transactions_with_balance
          where bank_provider_id = $1
          order by seq`,
        [p.id]
      );
      expect(rows.map((r) => r.dedupe_key)).toEqual(["__t_antes", "__t_abertura", "__t_mesmo_dia", "__t_depois"]);
      expect(rows[0].in_balance).toBe(false);
      expect(rows[0].saldo).toBeNull();
      expect(rows[2].saldo - rows[1].saldo).toBeCloseTo(-30);
      expect(rows[3].saldo - rows[2].saldo).toBeCloseTo(20);
    });
  });
});
