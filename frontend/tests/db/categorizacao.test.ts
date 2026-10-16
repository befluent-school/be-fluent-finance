import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ownerPool, ensureUser } from "./helpers";

process.env.APP_SECRET ??= "0".repeat(64);
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";

const { withUser } = await import("@/lib/db");

const DAY = "2002-03-03";
const TEACHER = "Professora Teste Categorizacao";

describe("categorização automática dos lançamentos bancários", () => {
  afterAll(async () => {
    await ownerPool.query("delete from public.cash_transactions where date = $1 and dedupe_key like '__cat_%'", [DAY]);
    await ownerPool.query("delete from public.teachers where full_name = $1", [TEACHER]);
  });

  it("categoriza pelas descrições reais e respeita o que não deve mexer", async () => {
    const owner = await ensureUser("rls-owner@teste.local", "owner");
    await ownerPool.query("insert into public.teachers (full_name) values ($1) on conflict do nothing", [TEACHER]);
    const manual = await ownerPool.query("select id from public.cost_categories where name = 'Outro'");
    const ins = (key: string, type: string, source: string, desc: string, categoryId: string | null = null) =>
      ownerPool.query(
        `insert into public.cash_transactions (date, description, amount, type, source, dedupe_key, category_id)
         values ($1, $2, 10, $3, $4, $5, $6)`,
        [DAY, desc, type, source, key, categoryId]
      );
    await ins("__cat_cobranca", "entrada", "asaas", "Cobrança recebida - fatura nr. 1 Fulana (ASAAS)");
    await ins("__cat_taxa", "saida", "asaas", "Taxa de notificação por WhatsApp da fatura 1 (ASAAS)");
    await ins("__cat_darf", "saida", "inter", "Pagamento Darf Numerado — PAGAMENTO DARF (Inter PJ)");
    await ins("__cat_rocket", "saida", "inter", "Pix enviado — PIX ENVIADO - Cp :02843443-ROCKET MKT (Inter PJ)");
    await ins("__cat_prof", "saida", "inter", "Pix enviado — PIX ENVIADO - Cp :18236120-PROFESSORA TESTE (Inter PJ)");
    await ins("__cat_antecipacao", "entrada", "asaas", "Antecipação - fatura nr. 2 Ciclano (ASAAS)");
    await ins("__cat_estorno", "entrada", "asaas", "Estorno da taxa do Pix (ASAAS)");
    await ins("__cat_lanche", "saida", "inter", "Pix enviado — PIX ENVIADO - Cp :1-LANCHONETE (Inter PJ)");
    await ins("__cat_manual", "entrada", "asaas", "Cobrança recebida - fatura nr. 3 Beltrano (ASAAS)", manual.rows[0].id);

    await withUser(owner, (tx) => tx.execute(sql`select public.categorizar_lancamentos_bancarios()`));

    const { rows } = await ownerPool.query(
      `select ct.dedupe_key, cc.name from public.cash_transactions ct
         left join public.cost_categories cc on cc.id = ct.category_id
        where ct.date = $1 and ct.dedupe_key like '__cat_%'`,
      [DAY]
    );
    const cat = Object.fromEntries(rows.map((r) => [r.dedupe_key, r.name]));
    expect(cat.__cat_cobranca).toBe("Mensalidade de Aluno");
    expect(cat.__cat_taxa).toBe("Taxas Asaas");
    expect(cat.__cat_darf).toBe("Impostos");
    expect(cat.__cat_rocket).toBe("Marketing e Vendas");
    expect(cat.__cat_prof).toBe("Pagamento Professores");
    // Antecipação e estorno entram no cálculo da receita pela descrição.
    expect(cat.__cat_antecipacao).toBeNull();
    expect(cat.__cat_estorno).toBeNull();
    // Pix para quem não é professor nem fornecedor conhecido fica para o usuário.
    expect(cat.__cat_lanche).toBeNull();
    // Categoria escolhida à mão nunca é sobrescrita.
    expect(cat.__cat_manual).toBe("Outro");
  });
});
