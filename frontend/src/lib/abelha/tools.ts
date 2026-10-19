import "server-only";
import { sql } from "drizzle-orm";
import * as z from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { withUser } from "@/lib/db";
import { isoDate } from "@/lib/validation";

/**
 * Ferramentas da Abelha (assistente financeira). Cada ferramenta roda numa
 * transação própria com o RLS do usuário logado — a IA nunca enxerga nem
 * altera mais do que o próprio usuário poderia pela tela.
 *
 * Escritas permitidas direto: categorizar, criar categoria, anotar lançamento.
 * Importar lançamentos NUNCA é direto: vira uma proposta que o usuário confirma
 * com um botão (ver `Proposal`).
 */

export type ImportProposal = {
  kind: "importacao";
  accountLabel: string;
  resumo: string;
  rows: { date: string; description: string; amount: number; type: "CREDIT" | "DEBIT"; categoryId: null }[];
};

export type ToolContext = { userId: string; proposals: ImportProposal[]; changes: string[] };

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const TRANSFER = "Transferência entre Contas";

async function q(userId: string, query: ReturnType<typeof sql>): Promise<Row[]> {
  const { rows } = await withUser(userId, (tx) => tx.execute(query));
  return rows as Row[];
}

const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

async function findProvider(userId: string, conta: string) {
  const providers = await q(userId, sql`select id, label, provider from public.bank_providers where active`);
  const c = norm(conta);
  const match = providers.find(
    (p) => norm(String(p.label)) === c || norm(String(p.provider)) === c || c.includes(norm(String(p.provider))) || norm(String(p.label)).includes(c)
  );
  return { match, providers };
}

// ── definições (o que a IA vê) ─────────────────────────────────────────────
export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: "resumo_financeiro",
    description:
      "Saldo de cada conta (sistema × banco), entradas/saídas/faturamento dos últimos 12 meses e quantas pendências existem. Use para responder perguntas gerais e antes de afirmar qualquer número.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "listar_pendencias",
    description:
      "Lançamentos vindos dos bancos que ainda não têm categoria, do maior para o menor valor. Traz 'possivel_aluno' quando o nome na descrição bate com um aluno cadastrado.",
    input_schema: {
      type: "object",
      properties: { limite: { type: "integer", minimum: 1, maximum: 60, description: "padrão 20" } },
    },
  },
  {
    name: "buscar_lancamentos",
    description:
      "Procura lançamentos do fluxo de caixa. Use para achar a transação de um comprovante (valor + data aproximada) ou responder perguntas sobre gastos/recebimentos.",
    input_schema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "trecho da descrição (sem acento importa pouco)" },
        de: { type: "string", description: "YYYY-MM-DD" },
        ate: { type: "string", description: "YYYY-MM-DD" },
        tipo: { type: "string", enum: ["entrada", "saida"] },
        valor: { type: "number", description: "valor exato em reais (positivo)" },
        conta: { type: "string", description: "ex.: Inter, ASAAS" },
        sem_categoria: { type: "boolean" },
        categoria: { type: "string" },
        limite: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: "listar_categorias",
    description: "Categorias existentes (nome, tipo fixa/variável, quantos lançamentos usam).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "categorizar",
    description:
      "Aplica uma categoria existente a lançamentos (pelos ids). Se 'sempre_que_contiver' for informado, grava uma regra: lançamentos futuros e atuais sem categoria cuja descrição contenha esse trecho recebem a mesma categoria automaticamente. Só use depois que o usuário concordar.",
    input_schema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 200 },
        categoria: { type: "string", description: "nome exato de uma categoria existente" },
        sempre_que_contiver: { type: "string", description: "trecho do favorecido/pagador, ex.: ROCKET MARKETING" },
      },
      required: ["ids", "categoria"],
    },
  },
  {
    name: "criar_categoria",
    description: "Cria uma categoria nova. Só quando nenhuma existente servir e o usuário aprovar o nome.",
    input_schema: {
      type: "object",
      properties: { nome: { type: "string" }, tipo: { type: "string", enum: ["fixa", "variavel"] } },
      required: ["nome", "tipo"],
    },
  },
  {
    name: "anotar_lancamento",
    description:
      "Acrescenta uma observação a um lançamento (ex.: dados de um comprovante/nota: favorecido, número da NF, finalidade).",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" }, nota: { type: "string" } },
      required: ["id", "nota"],
    },
  },
  {
    name: "conferir_extrato",
    description:
      "Compara as linhas transcritas de um extrato bancário com o que está no sistema para aquela conta. Valida a transcrição pelos saldos diários (se informados), lista o que falta no sistema e o que sobra. Se faltar algo, cria uma proposta de importação que o usuário confirma com um botão. Envie no máximo 300 linhas por chamada (divida por período).",
    input_schema: {
      type: "object",
      properties: {
        conta: { type: "string", description: "conta do extrato, ex.: Inter, ASAAS" },
        linhas: {
          type: "array",
          maxItems: 300,
          items: {
            type: "object",
            properties: {
              data: { type: "string", description: "YYYY-MM-DD" },
              descricao: { type: "string" },
              valor: { type: "number", description: "positivo = entrada, negativo = saída" },
            },
            required: ["data", "descricao", "valor"],
          },
        },
        saldo_antes: { type: "number", description: "saldo da conta antes da primeira linha (para validar a transcrição)" },
        saldos_diarios: {
          type: "array",
          items: {
            type: "object",
            properties: { data: { type: "string" }, saldo: { type: "number" } },
            required: ["data", "saldo"],
          },
          description: "'Saldo do dia' que o extrato mostra",
        },
      },
      required: ["conta", "linhas"],
    },
  },
];

// ── execução ───────────────────────────────────────────────────────────────
const Uuid = z.uuid();
const Inputs = {
  listar_pendencias: z.object({ limite: z.number().int().min(1).max(60).optional() }),
  buscar_lancamentos: z.object({
    texto: z.string().max(120).optional(),
    de: isoDate.optional(),
    ate: isoDate.optional(),
    tipo: z.enum(["entrada", "saida"]).optional(),
    valor: z.number().positive().optional(),
    conta: z.string().max(60).optional(),
    sem_categoria: z.boolean().optional(),
    categoria: z.string().max(100).optional(),
    limite: z.number().int().min(1).max(100).optional(),
  }),
  categorizar: z.object({
    ids: z.array(Uuid).min(1).max(200),
    categoria: z.string().min(1).max(100),
    sempre_que_contiver: z.string().trim().min(3).max(120).optional(),
  }),
  criar_categoria: z.object({ nome: z.string().trim().min(2).max(100), tipo: z.enum(["fixa", "variavel"]) }),
  anotar_lancamento: z.object({ id: Uuid, nota: z.string().trim().min(2).max(1000) }),
  conferir_extrato: z.object({
    conta: z.string().min(2).max(60),
    linhas: z
      .array(z.object({ data: isoDate, descricao: z.string().min(1).max(300), valor: z.number().finite() }))
      .min(1)
      .max(300),
    saldo_antes: z.number().finite().optional(),
    saldos_diarios: z.array(z.object({ data: isoDate, saldo: z.number().finite() })).max(400).optional(),
  }),
};

export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<unknown> {
  const { userId } = ctx;
  switch (name) {
    case "resumo_financeiro": {
      const contas = await q(
        userId,
        sql`select p.label as conta, p.bank_balance as saldo_banco, p.bank_balance_at as saldo_banco_em,
                   coalesce((select sum(case when v.type = 'entrada' then v.amount else -v.amount end)
                               from public.cash_transactions_with_balance v
                              where v.bank_provider_id = p.id and v.in_balance), 0) as saldo_sistema
              from public.bank_providers p where p.active order by p.label`
      );
      const meses = await q(
        userId,
        sql`select to_char(ct.date, 'YYYY-MM') as mes,
                   sum(ct.amount) filter (where ct.type = 'entrada' and coalesce(c.name, '') <> ${TRANSFER}) as entradas,
                   sum(ct.amount) filter (where ct.type = 'saida' and coalesce(c.name, '') <> ${TRANSFER}) as saidas,
                   (select r.receita_calculada from public.v_receita_bruta_mensal r
                     where r.reference_month = date_trunc('month', min(ct.date))::date) as faturamento
              from public.cash_transactions ct
              left join public.cost_categories c on c.id = ct.category_id
             where ct.source <> 'opening' and ct.date >= (current_date - interval '12 months')
             group by 1 order by 1`
      );
      const [pend] = await q(
        userId,
        sql`select count(*) as sem_categoria, coalesce(sum(amount), 0) as valor
              from public.cash_transactions where category_id is null and source <> 'opening'`
      );
      return {
        contas: contas.map((c) => ({
          conta: c.conta,
          saldo_sistema: num(c.saldo_sistema),
          saldo_banco: num(c.saldo_banco),
          saldo_banco_em: c.saldo_banco_em,
          diferenca: c.saldo_banco === null ? null : Math.round((Number(c.saldo_sistema) - Number(c.saldo_banco)) * 100) / 100,
        })),
        meses: meses.map((m) => ({ mes: m.mes, entradas: num(m.entradas), saidas: num(m.saidas), faturamento: num(m.faturamento) })),
        pendencias: { sem_categoria: Number(pend?.sem_categoria ?? 0), valor: num(pend?.valor) },
      };
    }

    case "listar_pendencias": {
      const { limite = 20 } = Inputs.listar_pendencias.parse(input ?? {});
      const rows = await q(
        userId,
        sql`select ct.id, ct.date, ct.description, ct.amount, ct.type, p.label as conta,
                   (select s.full_name from public.students s
                     where s.active
                       and position(array_to_string((string_to_array(public.normalizar_nome(s.full_name), ' '))[1:2], ' ')
                                    in public.normalizar_nome(ct.description)) > 0
                     limit 1) as possivel_aluno
              from public.cash_transactions ct
              left join public.bank_providers p on p.id = ct.bank_provider_id
             where ct.category_id is null and ct.source <> 'opening'
             order by ct.amount desc, ct.date desc
             limit ${limite}`
      );
      const [tot] = await q(
        userId,
        sql`select count(*) as n from public.cash_transactions where category_id is null and source <> 'opening'`
      );
      return { total_sem_categoria: Number(tot?.n ?? 0), lancamentos: rows.map(fmtRow) };
    }

    case "buscar_lancamentos": {
      const f = Inputs.buscar_lancamentos.parse(input ?? {});
      const conds = [sql`ct.source <> 'opening'`];
      if (f.texto) conds.push(sql`public.normalizar_nome(ct.description) like '%' || public.normalizar_nome(${f.texto}) || '%'`);
      if (f.de) conds.push(sql`ct.date >= ${f.de}::date`);
      if (f.ate) conds.push(sql`ct.date <= ${f.ate}::date`);
      if (f.tipo) conds.push(sql`ct.type = ${f.tipo}`);
      if (f.valor) conds.push(sql`ct.amount = ${f.valor}`);
      if (f.conta) conds.push(sql`public.normalizar_nome(coalesce(p.label, '') || ' ' || coalesce(p.provider, '')) like '%' || public.normalizar_nome(${f.conta}) || '%'`);
      if (f.sem_categoria) conds.push(sql`ct.category_id is null`);
      if (f.categoria) conds.push(sql`public.normalizar_nome(c.name) = public.normalizar_nome(${f.categoria})`);
      const rows = await q(
        userId,
        sql`select ct.id, ct.date, ct.description, ct.amount, ct.type, p.label as conta, c.name as categoria, ct.notes
              from public.cash_transactions ct
              left join public.bank_providers p on p.id = ct.bank_provider_id
              left join public.cost_categories c on c.id = ct.category_id
             where ${sql.join(conds, sql` and `)}
             order by ct.date desc, ct.amount desc
             limit ${f.limite ?? 40}`
      );
      return { encontrados: rows.length, lancamentos: rows.map(fmtRow) };
    }

    case "listar_categorias": {
      const rows = await q(
        userId,
        sql`select c.name, c.type, count(ct.id) as usos
              from public.cost_categories c left join public.cash_transactions ct on ct.category_id = c.id
             where c.active group by c.id order by usos desc, c.name`
      );
      return rows.map((r) => ({ nome: r.name, tipo: r.type === "fixed" ? "fixa" : "variável", usos: Number(r.usos) }));
    }

    case "categorizar": {
      const { ids, categoria, sempre_que_contiver } = Inputs.categorizar.parse(input);
      const [cat] = await q(
        userId,
        sql`select id, name from public.cost_categories where active and public.normalizar_nome(name) = public.normalizar_nome(${categoria}) limit 1`
      );
      if (!cat) return { erro: `Categoria "${categoria}" não existe. Use listar_categorias ou criar_categoria.` };
      const result = await withUser(userId, async (tx) => {
        const { rows: upd } = await tx.execute(
          sql`update public.cash_transactions set category_id = ${cat.id}::uuid, updated_at = now()
               where id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
               returning id, type`
        );
        let porRegra = 0;
        if (sempre_que_contiver && upd.length > 0) {
          const types = Array.from(new Set(upd.map((r) => String((r as Row).type))));
          for (const t of types) {
            await tx.execute(
              sql`insert into public.categorization_rules (pattern, type, category_id, created_by)
                  values (${sempre_que_contiver}, ${t}, ${cat.id}::uuid, ${userId}::uuid)
                  on conflict (pattern, type) do update set category_id = excluded.category_id`
            );
          }
          const { rows } = await tx.execute(sql`select public.categorizar_lancamentos_bancarios() as n`);
          porRegra = Number((rows[0] as Row)?.n ?? 0);
        }
        return { atualizados: upd.length, por_regra: porRegra };
      });
      ctx.changes.push(
        `${result.atualizados} lançamento(s) em "${cat.name}"` +
          (sempre_que_contiver ? ` + regra "${sempre_que_contiver}" (${result.por_regra} parecido(s) categorizado(s))` : "")
      );
      return result;
    }

    case "criar_categoria": {
      const { nome, tipo } = Inputs.criar_categoria.parse(input);
      const [exists] = await q(
        userId,
        sql`select name from public.cost_categories where public.normalizar_nome(name) = public.normalizar_nome(${nome})`
      );
      if (exists) return { ok: true, ja_existia: exists.name };
      await q(
        userId,
        sql`insert into public.cost_categories (name, type) values (${nome}, ${tipo === "fixa" ? "fixed" : "variable"}) returning id`
      );
      ctx.changes.push(`categoria criada: "${nome}"`);
      return { ok: true, criada: nome };
    }

    case "anotar_lancamento": {
      const { id, nota } = Inputs.anotar_lancamento.parse(input);
      const rows = await q(
        userId,
        sql`update public.cash_transactions
               set notes = case when coalesce(notes, '') = '' then ${nota} else notes || E'\n' || ${nota} end,
                   updated_at = now()
             where id = ${id}::uuid returning id`
      );
      if (rows.length === 0) return { erro: "Lançamento não encontrado." };
      ctx.changes.push("observação anotada em 1 lançamento");
      return { ok: true };
    }

    case "conferir_extrato":
      return conferirExtrato(Inputs.conferir_extrato.parse(input), ctx);

    default:
      return { erro: `Ferramenta desconhecida: ${name}` };
  }
}

function fmtRow(r: Row) {
  return {
    id: r.id,
    data: String(r.date).slice(0, 10),
    descricao: r.description,
    valor: num(r.amount),
    tipo: r.type,
    conta: r.conta ?? null,
    ...(r.categoria !== undefined ? { categoria: r.categoria ?? null } : {}),
    ...(r.notes ? { observacao: r.notes } : {}),
    ...(r.possivel_aluno ? { possivel_aluno: r.possivel_aluno } : {}),
  };
}

async function conferirExtrato(input: z.infer<typeof Inputs.conferir_extrato>, ctx: ToolContext) {
  const { match: provider, providers } = await findProvider(ctx.userId, input.conta);
  if (!provider) {
    return { erro: `Conta "${input.conta}" não encontrada. Contas: ${providers.map((p) => p.label).join(", ")}` };
  }
  const cents = (v: number) => Math.round(v * 100);
  const linhas = [...input.linhas].sort((a, b) => a.data.localeCompare(b.data));

  // 1) A transcrição fecha com o próprio extrato? (pega número lido errado)
  const errosTranscricao: { data: string; extrato: number; somando_linhas: number }[] = [];
  if (input.saldo_antes !== undefined && input.saldos_diarios?.length) {
    const porDia = new Map<string, number>();
    for (const l of linhas) porDia.set(l.data, (porDia.get(l.data) ?? 0) + cents(l.valor));
    let saldo = cents(input.saldo_antes);
    const dias = Array.from(porDia.keys()).sort();
    const esperado = new Map(input.saldos_diarios.map((s) => [s.data, cents(s.saldo)]));
    for (const d of dias) {
      saldo += porDia.get(d)!;
      const e = esperado.get(d);
      if (e !== undefined && e !== saldo) {
        errosTranscricao.push({ data: d, extrato: e / 100, somando_linhas: saldo / 100 });
        saldo = e; // reancora para não propagar o erro
      }
    }
  }

  // 2) Compara com o sistema (data + valor + tipo, contando repetições).
  const de = linhas[0].data;
  const ate = linhas[linhas.length - 1].data;
  const sistema = await q(
    ctx.userId,
    sql`select id, date, amount, type, description from public.cash_transactions
         where bank_provider_id = ${provider.id}::uuid and source <> 'opening'
           and date between ${de}::date and ${ate}::date`
  );
  const k = (d: string, v: number, t: string) => `${d}|${cents(v)}|${t}`;
  const pool = new Map<string, Row[]>();
  for (const s of sistema) {
    const key = k(String(s.date).slice(0, 10), Number(s.amount), String(s.type));
    pool.set(key, [...(pool.get(key) ?? []), s]);
  }
  const faltando: typeof linhas = [];
  for (const l of linhas) {
    const key = k(l.data, Math.abs(l.valor), l.valor >= 0 ? "entrada" : "saida");
    const list = pool.get(key);
    if (list && list.length > 0) list.shift();
    else faltando.push(l);
  }
  const sobrando = Array.from(pool.values()).flat().map(fmtRow);

  if (errosTranscricao.length > 0) {
    return {
      conta: provider.label,
      periodo: { de, ate },
      erros_de_transcricao: errosTranscricao,
      aviso: "A soma das linhas não fecha com o saldo do dia do extrato nesses dias. Releia esses dias no arquivo e chame de novo — nada foi proposto.",
    };
  }

  if (faltando.length > 0) {
    ctx.proposals.push({
      kind: "importacao",
      accountLabel: String(provider.label),
      resumo: `${faltando.length} lançamento(s) do extrato ${provider.label} (${de} a ${ate}) que não estão no sistema`,
      rows: faltando.map((l) => ({
        date: l.data,
        description: l.descricao.slice(0, 300),
        amount: Math.abs(l.valor),
        type: l.valor >= 0 ? "CREDIT" : "DEBIT",
        categoryId: null,
      })),
    });
  }
  return {
    conta: provider.label,
    periodo: { de, ate },
    linhas_no_extrato: linhas.length,
    batem_com_o_sistema: linhas.length - faltando.length,
    faltando_no_sistema: faltando.length,
    proposta_de_importacao_criada: faltando.length > 0,
    no_sistema_mas_nao_no_extrato: sobrando.slice(0, 40),
    total_sobrando: sobrando.length,
    observacao:
      sobrando.length > 0
        ? "Lançamentos que estão no sistema e não aparecem no extrato podem ser duplicados ou lançamentos manuais. Pergunte ao usuário antes de concluir."
        : undefined,
  };
}
