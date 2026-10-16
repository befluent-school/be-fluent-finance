import { afterAll, describe, expect, it } from "vitest";
import { ownerPool, ensureUser } from "./helpers";

process.env.APP_SECRET ??= "0".repeat(64);
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";

const { reconcileTransfers } = await import("@/lib/bank/sync");
const { withUser } = await import("@/lib/db");

const DAY = "2002-02-02";

describe("pareamento de transferências entre contas", () => {
  afterAll(async () => {
    await ownerPool.query("delete from public.cash_transactions where date = $1 and dedupe_key like '__tr_%'", [DAY]);
  });

  it("só pareia quando a empresa aparece na transação", async () => {
    const owner = await ensureUser("rls-owner@teste.local", "owner");
    const ins = (key: string, type: string, amount: number, source: string, desc: string) =>
      ownerPool.query(
        `insert into public.cash_transactions (date, description, amount, type, source, dedupe_key)
         values ($1, $2, $3, $4, $5, $6)`,
        [DAY, desc, amount, type, source, key]
      );
    await ins("__tr_mensalidade", "entrada", 240, "asaas", "Cobrança recebida - fatura 1 Fulana (ASAAS)");
    await ins("__tr_pagamento", "saida", 240, "inter", "Pix enviado — Cp :1-Fornecedor (Inter PJ)");
    await ins("__tr_saida", "saida", 500, "asaas", "Transação via Pix com chave para BE FLUENT IDIOMAS E ENSINO LTDA (ASAAS)");
    await ins("__tr_entrada", "entrada", 500, "inter", "Pix recebido — Cp :19540550-BE FLUENT IDIOMAS E ENSINO LTDA (Inter PJ)");

    await withUser(owner, (tx) => reconcileTransfers(tx));

    const { rows } = await ownerPool.query(
      `select ct.dedupe_key, cc.name from public.cash_transactions ct
         left join public.cost_categories cc on cc.id = ct.category_id
        where ct.date = $1 and ct.dedupe_key like '__tr_%' order by ct.dedupe_key`,
      [DAY]
    );
    const cat = Object.fromEntries(rows.map((r) => [r.dedupe_key, r.name]));
    expect(cat.__tr_mensalidade).toBeNull();
    expect(cat.__tr_pagamento).toBeNull();
    expect(cat.__tr_saida).toBe("Transferência entre Contas");
    expect(cat.__tr_entrada).toBe("Transferência entre Contas");
  });
});
