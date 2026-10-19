import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ownerPool, ensureUser } from "./helpers";

process.env.APP_SECRET ??= "0".repeat(64);
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";

const { runTool } = await import("@/lib/abelha/tools");
type Ctx = import("@/lib/abelha/tools").ToolContext;
const newCtx = (): Ctx => ({ userId: owner, proposals: [], changes: [] });

const LABEL = "__abelha_test__";
let providerId = "";
let owner = "";

describe("ferramentas da Abelha", () => {
  beforeAll(async () => {
    owner = await ensureUser("rls-owner@teste.local", "owner");
    // Sobras de uma execução interrompida (ex.: banco caiu no meio do teste).
    await ownerPool.query(
      "delete from public.cash_transactions where bank_provider_id in (select id from public.bank_providers where label = $1)",
      [LABEL]
    );
    await ownerPool.query("delete from public.bank_providers where label = $1", [LABEL]);
    await ownerPool.query("delete from public.categorization_rules where pattern = 'FORNECEDOR ZETA'");
    const { rows } = await ownerPool.query(
      `insert into public.bank_providers (provider, label, active) values ('manual', $1, true) returning id`,
      [LABEL]
    );
    providerId = rows[0].id;
    for (const [d, desc, v, t] of [
      ["2003-03-03", "Pix recebido — ALUNO TESTE", 240, "entrada"],
      ["2003-03-04", "Pix enviado — FORNECEDOR ZETA LTDA", 100, "saida"],
    ] as const) {
      await ownerPool.query(
        `insert into public.cash_transactions (date, description, amount, type, source, dedupe_key, bank_provider_id)
         values ($1, $2, $3, $4, 'inter', $5, $6)`,
        [d, desc, v, t, `__abelha_${d}`, providerId]
      );
    }
  });

  afterAll(async () => {
    await ownerPool.query("delete from public.cash_transactions where bank_provider_id = $1", [providerId]);
    await ownerPool.query("delete from public.bank_providers where id = $1", [providerId]);
    await ownerPool.query("delete from public.categorization_rules where pattern = 'FORNECEDOR ZETA'");
  });

  it("conferir_extrato: acha o que falta e propõe importar só isso", async () => {
    const ctx = newCtx();
    const r = (await runTool(
      "conferir_extrato",
      {
        conta: LABEL,
        saldo_antes: 1000,
        linhas: [
          { data: "2003-03-03", descricao: "Pix recebido ALUNO TESTE", valor: 240 },
          { data: "2003-03-04", descricao: "Pix enviado FORNECEDOR ZETA", valor: -100 },
          { data: "2003-03-04", descricao: "Tarifa", valor: -9.9 },
        ],
        saldos_diarios: [
          { data: "2003-03-03", saldo: 1240 },
          { data: "2003-03-04", saldo: 1130.1 },
        ],
      },
      ctx
    )) as { faltando_no_sistema: number; batem_com_o_sistema: number };
    expect(r.batem_com_o_sistema).toBe(2);
    expect(r.faltando_no_sistema).toBe(1);
    expect(ctx.proposals).toHaveLength(1);
    expect(ctx.proposals[0].rows).toEqual([
      { date: "2003-03-04", description: "Tarifa", amount: 9.9, type: "DEBIT", categoryId: null },
    ]);
  });

  it("conferir_extrato: transcrição que não fecha com o saldo do dia não gera proposta", async () => {
    const ctx = newCtx();
    const r = (await runTool(
      "conferir_extrato",
      {
        conta: LABEL,
        saldo_antes: 1000,
        linhas: [{ data: "2003-03-05", descricao: "Tarifa", valor: -9.9 }],
        saldos_diarios: [{ data: "2003-03-05", saldo: 991 }],
      },
      ctx
    )) as { erros_de_transcricao: unknown[] };
    expect(r.erros_de_transcricao).toHaveLength(1);
    expect(ctx.proposals).toHaveLength(0);
  });

  it("categorizar com regra: aplica e deixa a regra gravada", async () => {
    const { rows } = await ownerPool.query("select id from public.cash_transactions where dedupe_key = '__abelha_2003-03-04'");
    const ctx = newCtx();
    const r = (await runTool(
      "categorizar",
      { ids: [rows[0].id], categoria: "marketing e vendas", sempre_que_contiver: "FORNECEDOR ZETA" },
      ctx
    )) as { atualizados: number };
    expect(r.atualizados).toBe(1);
    const rule = await ownerPool.query("select type from public.categorization_rules where pattern = 'FORNECEDOR ZETA'");
    expect(rule.rows).toEqual([{ type: "saida" }]);
    expect(ctx.changes[0]).toContain("Marketing e Vendas");
  });
});
