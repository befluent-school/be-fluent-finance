import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ownerPool, ensureUser } from "./helpers";

process.env.APP_SECRET ??= "0".repeat(64);
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";

const { withUser } = await import("@/lib/db");

const DAY = "2002-05-05";

describe("regras de categorização aprendidas", () => {
  afterAll(async () => {
    await ownerPool.query("delete from public.cash_transactions where date = $1 and dedupe_key like '__rule_%'", [DAY]);
    await ownerPool.query("delete from public.categorization_rules where pattern = 'OKTTO SOLUCOES'");
  });

  it("aplica a regra do usuário a lançamentos parecidos, sem tocar entradas nem os já categorizados", async () => {
    const owner = await ensureUser("rls-owner@teste.local", "owner");
    const cat = (await ownerPool.query("select id from public.cost_categories where name = 'Outro'")).rows[0].id;
    const mkt = (await ownerPool.query("select id from public.cost_categories where name = 'Marketing e Vendas'")).rows[0].id;
    const ins = (key: string, type: string, desc: string, categoryId: string | null = null) =>
      ownerPool.query(
        `insert into public.cash_transactions (date, description, amount, type, source, dedupe_key, category_id)
         values ($1, $2, 9.33, $3, 'inter', $4, $5)`,
        [DAY, desc, type, key, categoryId]
      );
    await ins("__rule_a", "saida", "Pix enviado — PIX ENVIADO - Cp :02843443-OKTTO SOLUCOES EM TECNOLOGIA (Inter PJ)");
    await ins("__rule_b", "saida", "Pix enviado — PIX ENVIADO - Cp :02843443-Oktto Soluções em Tecnologia (Inter PJ)");
    await ins("__rule_entrada", "entrada", "Pix recebido — OKTTO SOLUCOES (Inter PJ)");
    await ins("__rule_manual", "saida", "Pix enviado — OKTTO SOLUCOES (Inter PJ)", mkt);
    await ownerPool.query(
      "insert into public.categorization_rules (pattern, type, category_id) values ('OKTTO SOLUCOES', 'saida', $1)",
      [cat]
    );

    await withUser(owner, (tx) => tx.execute(sql`select public.categorizar_lancamentos_bancarios()`));

    const { rows } = await ownerPool.query(
      `select ct.dedupe_key, cc.name from public.cash_transactions ct
         left join public.cost_categories cc on cc.id = ct.category_id
        where ct.date = $1 and ct.dedupe_key like '__rule_%'`,
      [DAY]
    );
    const got = Object.fromEntries(rows.map((r) => [r.dedupe_key, r.name]));
    expect(got.__rule_a).toBe("Outro");
    expect(got.__rule_b).toBe("Outro"); // acento/maiúsculas não importam
    expect(got.__rule_entrada).toBeNull(); // regra é só para saída
    expect(got.__rule_manual).toBe("Marketing e Vendas");
  });
});
