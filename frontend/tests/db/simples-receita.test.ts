import { describe, expect, it } from "vitest";
import { asUser, ensureUser } from "./helpers";

describe("receita bruta do Simples", () => {
  it("exclui saldo inicial e estornos, prioriza a declarada e não projeta o RBT12", async () => {
    const owner = await ensureUser("rls-owner@teste.local", "owner");
    await asUser(owner, async (c) => {
      await c.query(`update public.app_settings set value = 'null'::jsonb where key = 'company_start_month'`);
      const { rows: [p] } = await c.query(
        `insert into public.bank_providers (provider, label, active) values ('asaas', '__simples_test__', true) returning id`
      );
      const ins = (date: string, type: string, amount: number, source: string, desc: string) =>
        c.query(
          `insert into public.cash_transactions (date, description, amount, type, source, bank_provider_id, dedupe_key)
           values ($1, $5, $3, $2, $4, $6, gen_random_uuid()::text)`,
          [date, type, amount, source, desc, p.id]
        );
      await ins("2001-03-15", "entrada", 1000, "opening", "Saldo inicial");
      await ins("2001-03-20", "entrada", 500, "asaas", "Cobrança recebida - fatura 1");
      await ins("2001-03-20", "saida", 200, "asaas", "Estorno - fatura 1");
      await ins("2001-03-20", "entrada", 26.2, "asaas", "Estorno da taxa de cartão - fatura 1");
      await ins("2001-04-10", "entrada", 300, "asaas", "Cobrança recebida - fatura 2");

      const mes = async (m: string) =>
        (await c.query(`select * from public.v_receita_bruta_mensal where reference_month = $1`, [m])).rows[0];
      const marco = await mes("2001-03-01");
      expect(Number(marco.receita_calculada)).toBe(300);
      expect(marco.coberto).toBe(false);
      expect((await mes("2001-04-01")).coberto).toBe(true);

      const apurar = async () =>
        (await c.query(`select * from public.simples_apuracao('2001-04-01')`)).rows[0];
      let a = await apurar();
      expect(a.receita_completa).toBe(true);
      expect(Number(a.receita_mes)).toBe(300);
      expect(a.meses_faltantes).toBe(12);

      await c.query(`insert into public.simples_receita_informada (reference_month, receita_bruta) values ('2001-03-01', 1000)`);
      a = await apurar();
      expect(a.meses_faltantes).toBe(11);
      expect(Number(a.rbt12)).toBe(1000);
    });
  });
});
