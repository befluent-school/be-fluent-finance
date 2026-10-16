import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ownerPool } from "./helpers";

const DAY = "2002-04-04";
const SQL = readFileSync(join(__dirname, "../../../db/migrations/0043_remove_duplicatas_inter.sql"), "utf8");
const DESC = "Pix enviado — PIX ENVIADO - Cp :1-Fornecedor X (Inter PJ)";

describe("0043: duplicatas do Inter com chave de tipo antigo", () => {
  afterAll(async () => {
    await ownerPool.query("delete from public.payables where description = '__dup_payable'");
    await ownerPool.query("delete from public.cash_transactions where date = $1 and source = 'inter'", [DAY]);
  });

  it("apaga a cópia antiga, mantém a gêmea e repassa os vínculos", async () => {
    const ins = (key: string) =>
      ownerPool.query(
        `insert into public.cash_transactions (date, description, amount, type, source, dedupe_key)
         values ($1, $2, 33.7, 'saida', 'inter', $3) returning id`,
        [DAY, DESC, key]
      );
    const base = `${DAY}|${DESC.toLowerCase()}|33.7`;
    const old = (await ins(`${base}|entrada|Inter PJ`)).rows[0].id;
    const twin = (await ins(`${base}|saida|Inter PJ`)).rows[0].id;
    // Sem gêmea: só a chave deve ser corrigida.
    const lone = (
      await ownerPool.query(
        `insert into public.cash_transactions (date, description, amount, type, source, dedupe_key)
         values ($1, 'Pix enviado — sozinho (Inter PJ)', 10, 'saida', 'inter', $2) returning id`,
        [DAY, `${DAY}|pix enviado — sozinho (inter pj)|10|entrada|Inter PJ`]
      )
    ).rows[0].id;
    await ownerPool.query(
      `insert into public.payables (description, reference_month, amount, due_date, cash_transaction_id)
       values ('__dup_payable', '2002-04-01', 33.7, $1, $2)`,
      [DAY, old]
    );

    const client = await ownerPool.connect();
    try {
      await client.query("begin");
      await client.query(SQL);
      await client.query("commit");
    } finally {
      client.release();
    }

    const { rows } = await ownerPool.query(
      "select id, dedupe_key from public.cash_transactions where date = $1 and source = 'inter' order by amount",
      [DAY]
    );
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(old);
    expect(ids).toContain(twin);
    expect(rows.find((r) => r.id === lone)?.dedupe_key).toContain("|10|saida|");
    const payable = await ownerPool.query("select cash_transaction_id from public.payables where description = '__dup_payable'");
    expect(payable.rows[0].cash_transaction_id).toBe(twin);
  });
});
