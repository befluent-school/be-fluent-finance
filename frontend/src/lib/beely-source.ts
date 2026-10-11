import "server-only";
import pg from "pg";
import { env } from "@/lib/env";

/**
 * Fonte de dados do Beely CRM (sistema separado da Be Fluent). O Financeiro
 * só LÊ — nunca escreve de volta. Duas implementações, escolhidas por
 * BEELY_SOURCE:
 *
 *  - "postgres" (definitiva, na VPS): conexão somente leitura ao banco
 *    `beely_crm` com o papel `financeiro_leitor`, que só tem SELECT nas
 *    views do schema `financeiro_api` (contrato em deploy/BEELY-VIEWS.md).
 *  - "supabase" (temporária, até o Beely migrar): API REST do Supabase do
 *    Beely com a anon key — agora só no servidor (BEELY_SUPABASE_*, sem o
 *    prefixo NEXT_PUBLIC_, que mandaria a chave para o navegador).
 *  - "off": CRM desligado (a página mostra um aviso).
 *
 * Campos lidos (mínimo necessário — e-mail/telefone só para pré-preencher a
 * matrícula e detectar quem já é aluno):
 *   contacts: id, name, email, phone
 *   deals:    id, title, value, status, stage_id, contact, contact_id, owner, created_at
 *   stages:   id, name, position
 */

export type BeelyContact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

export type BeelyDeal = {
  id: string;
  title: string;
  value: number | null;
  status: "open" | "won" | "lost";
  stage_id: string | null;
  /** Nome do contato em texto livre — não há FK confiável (contact_id costuma ser null). */
  contact: string | null;
  contact_id: string | null;
  owner: string | null;
  created_at: string;
};

export type BeelyStage = {
  id: string;
  name: string;
  position: number | null;
};

export type BeelyPipeline =
  | { ok: true; contacts: BeelyContact[]; deals: BeelyDeal[]; stages: BeelyStage[] }
  | { ok: false; reason: "disabled" | "unavailable" };

const DEAL_STATUSES = new Set(["open", "won", "lost"]);

function normalizeDeals(rows: BeelyDeal[]): BeelyDeal[] {
  return rows
    .filter((d) => DEAL_STATUSES.has(d.status))
    .map((d) => ({ ...d, value: d.value == null ? null : Number(d.value), created_at: String(d.created_at) }));
}

// ── (b) Postgres somente leitura (definitiva) ──────────────────────────────
const globalForBeely = globalThis as unknown as { __beelyPool?: pg.Pool };

function beelyPool(url: string): pg.Pool {
  globalForBeely.__beelyPool ??= new pg.Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
    application_name: "financeiro-web (leitura beely)",
  });
  return globalForBeely.__beelyPool;
}

async function fromPostgres(url: string): Promise<BeelyPipeline> {
  const client = await beelyPool(url).connect();
  try {
    // Defesa extra: mesmo que o papel ganhe permissão de escrita por engano,
    // esta transação não grava nada.
    await client.query("begin transaction read only");
    const contacts = await client.query<BeelyContact>("select id::text, name, email, phone from financeiro_api.contacts");
    const deals = await client.query<BeelyDeal>(
      `select id::text, title, value, status, stage_id::text, contact, contact_id::text, owner, created_at::text
         from financeiro_api.deals order by created_at desc`
    );
    const stages = await client.query<BeelyStage>(
      "select id::text, name, position from financeiro_api.stages order by position"
    );
    await client.query("commit");
    return { ok: true, contacts: contacts.rows, deals: normalizeDeals(deals.rows), stages: stages.rows };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── (a) Supabase REST com anon key (temporária) ────────────────────────────
async function fromSupabase(baseUrl: string, anonKey: string): Promise<BeelyPipeline> {
  const get = async <T>(path: string): Promise<T[]> => {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/rest/v1/${path}`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Beely REST ${path.split("?")[0]}: HTTP ${res.status}`);
    return (await res.json()) as T[];
  };
  const [contacts, deals, stages] = await Promise.all([
    get<BeelyContact>("contacts?select=id,name,email,phone"),
    get<BeelyDeal>("deals?select=id,title,value,status,stage_id,contact,contact_id,owner,created_at&order=created_at.desc"),
    get<BeelyStage>("stages?select=id,name,position&order=position"),
  ]);
  return { ok: true, contacts, deals: normalizeDeals(deals), stages };
}

export async function loadBeelyPipeline(): Promise<BeelyPipeline> {
  const e = env();
  try {
    if (e.BEELY_SOURCE === "postgres" && e.BEELY_READONLY_DATABASE_URL) {
      return await fromPostgres(e.BEELY_READONLY_DATABASE_URL);
    }
    if (e.BEELY_SOURCE === "supabase" && e.BEELY_SUPABASE_URL && e.BEELY_SUPABASE_ANON_KEY) {
      return await fromSupabase(e.BEELY_SUPABASE_URL, e.BEELY_SUPABASE_ANON_KEY);
    }
    return { ok: false, reason: "disabled" };
  } catch (err) {
    console.error("[beely] falha ao ler o CRM:", err instanceof Error ? err.message : err);
    return { ok: false, reason: "unavailable" };
  }
}
