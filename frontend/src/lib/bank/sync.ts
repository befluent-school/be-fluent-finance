import "server-only";
import { todayBR } from "@/lib/dates";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";
import { bankProviders, cashTransactions, costCategories } from "@/lib/db/schema";
import { decryptCredentials } from "./credentials";
import { asaasConnector } from "./asaas";
import { interConnector } from "./inter";
import type { BankConnector, NormalizedTxn } from "./types";

/**
 * Motor de sincronização bancária. Dado um provider configurado, busca as
 * transações na API do banco e as lança no fluxo de caixa com o MESMO dedupe
 * da importação manual — reusar é o que garante "sem duplicata" mesmo que a
 * mesma transação apareça também num extrato importado à mão.
 */

const CONNECTORS: Record<string, BankConnector> = {
  asaas: asaasConnector,
  inter: interConnector,
};

export type SyncOutcome = {
  providerId: string;
  label: string;
  ok: boolean;
  imported: number;
  skipped: number;
  through: string | null;
  error?: string;
};

const TRANSFER_CATEGORY = "Transferência entre Contas";
const OWN_COMPANY_NAME = "BE FLUENT IDIOMAS E ENSINO";

function dedupeKeyFor(t: NormalizedTxn, label: string): string {
  // Com id do banco: chave estável e única por transação.
  if (t.externalId) return t.externalId;
  // Sem id: mesma regra da importação manual (inclui o rótulo da conta para
  // não confundir a mesma data/valor em bancos diferentes).
  return `${t.date}|${t.description.trim().toLowerCase()}|${t.amount}|${t.type}|${label}`;
}

/**
 * Sincroniza UM provider. Recebe a transação ativa do banco (tx) já com RLS do
 * usuário. Retorna o resultado; nunca lança (erros viram status 'erro').
 */


function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * `sinceOverride` busca a partir de uma data fixa (importação de histórico),
 * em blocos do tamanho máximo que cada API aceita por consulta.
 */
export async function syncProvider(
  tx: Tx,
  providerId: string,
  today: string,
  sinceOverride?: string
): Promise<SyncOutcome> {
  const [p] = await tx.select().from(bankProviders).where(eq(bankProviders.id, providerId));
  if (!p) return { providerId, label: "?", ok: false, imported: 0, skipped: 0, through: null, error: "Provider não encontrado." };

  const base: Omit<SyncOutcome, "ok" | "imported" | "skipped" | "through" | "error"> = {
    providerId: p.id,
    label: p.label,
  };

  const connector = CONNECTORS[p.provider];
  if (!connector) {
    await markProvider(tx, p.id, "erro", "Conector não implementado para este provedor.", 0);
    return { ...base, ok: false, imported: 0, skipped: 0, through: null, error: "Conector não implementado." };
  }
  if (!p.active) {
    return { ...base, ok: false, imported: 0, skipped: 0, through: null, error: "Conexão inativa." };
  }

  const credentials = decryptCredentials(p.credentialsEnc);
  if (Object.keys(credentials).length === 0) {
    await markProvider(tx, p.id, "erro", "Credenciais não configuradas ou ilegíveis.", 0);
    return { ...base, ok: false, imported: 0, skipped: 0, through: null, error: "Credenciais não configuradas." };
  }

  // Janela de busca: da última data trazida (ou sync_window_days atrás) até hoje.
  const windowStart = addDaysIso(today, -p.syncWindowDays);
  const since =
    sinceOverride ??
    (p.lastSyncedThrough && p.lastSyncedThrough > windowStart ? p.lastSyncedThrough : windowStart);

  const fetched: NormalizedTxn[] = [];
  let through: string | null = null;
  // Erro no meio do histórico (ex.: limite de consultas do banco): os blocos
  // já baixados são gravados mesmo assim e a próxima tentativa continua dali.
  let partialError: string | null = null;
  for (let from = since; from <= today; from = addDaysIso(from, connector.maxRangeDays)) {
    const to = addDaysIso(from, connector.maxRangeDays - 1) < today ? addDaysIso(from, connector.maxRangeDays - 1) : today;
    const chunk = await connector.fetchTransactions(p.config ?? {}, credentials, from, to);
    if (!chunk.ok) {
      if (fetched.length === 0) {
        await markProvider(tx, p.id, "erro", chunk.error.slice(0, 500), 0);
        return { ...base, ok: false, imported: 0, skipped: 0, through: null, error: chunk.error };
      }
      partialError = `Importação parcial: gravado até ${addDaysIso(from, -1)}. Para continuar, aguarde alguns minutos e importe a partir de ${from}. (${chunk.error})`;
      break;
    }
    fetched.push(...chunk.transactions);
    if (chunk.through && (!through || chunk.through > through)) through = chunk.through;
  }
  const result = { transactions: fetched, through };

  const bankBalance = await connector.fetchBalance(p.config ?? {}, credentials);
  if (bankBalance !== null) {
    await tx
      .update(bankProviders)
      .set({ bankBalance, bankBalanceAt: sql`now()` })
      .where(eq(bankProviders.id, p.id));
  }

  const txns = result.transactions;
  if (txns.length === 0) {
    await markProvider(tx, p.id, "ok", null, 0, result.through);
    return { ...base, ok: true, imported: 0, skipped: 0, through: result.through };
  }

  // Transferências entre contas próprias são marcadas depois, por
  // reconcileTransfers, quando as duas pernas já estão no banco.
  // Sem id do banco, duas compras idênticas no mesmo dia (mesma loja e valor)
  // gerariam a mesma chave e a segunda seria descartada. A 2ª ocorrência dentro
  // do lote ganha o sufixo "#2" (a 1ª mantém a chave antiga, compatível com o
  // que já está gravado). O extrato vem sempre na mesma ordem, então a chave é estável.
  const seen = new Map<string, number>();
  const keyFor = (t: NormalizedTxn) => {
    const base = dedupeKeyFor(t, p.label);
    if (t.externalId) return base;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  };
  const rows = txns.map((t) => ({
    date: t.date,
    description: `${t.description} (${p.label})`,
    amount: t.amount,
    type: t.type,
    categoryId: null,
    source: p.provider === "asaas" ? ("asaas" as const) : p.provider === "inter" ? ("inter" as const) : ("api_sync" as const),
    bankProviderId: p.id,
    dedupeKey: keyFor(t),
  }));

  const inserted = await tx
    .insert(cashTransactions)
    .values(rows)
    .onConflictDoNothing({ target: cashTransactions.dedupeKey })
    .returning({ id: cashTransactions.id });

  const imported = inserted.length;
  const skipped = rows.length - imported;
  if (partialError) {
    await markProvider(tx, p.id, "erro", partialError.slice(0, 500), imported, result.through);
    return { ...base, ok: false, imported, skipped, through: result.through, error: partialError };
  }
  await markProvider(tx, p.id, "ok", null, imported, result.through);

  return { ...base, ok: true, imported, skipped, through: result.through };
}

async function markProvider(
  tx: Tx,
  id: string,
  status: "ok" | "erro",
  error: string | null,
  importedCount: number,
  through?: string | null
): Promise<void> {
  await tx
    .update(bankProviders)
    .set({
      lastStatus: status,
      lastError: error,
      lastSyncedAt: sql`now()`,
      lastImportedCount: importedCount,
      // Só avança: importar histórico antigo não pode recuar a janela do sync diário.
      ...(through
        ? { lastSyncedThrough: sql`greatest(coalesce(${bankProviders.lastSyncedThrough}, ${through}::date), ${through}::date)` }
        : {}),
    })
    .where(eq(bankProviders.id, id));
}

/** Sincroniza TODOS os providers ativos. Usado pela virada diária / CLI. */
export async function syncAllActiveProviders(tx: Tx, today: string): Promise<SyncOutcome[]> {
  const active = await tx
    .select({ id: bankProviders.id })
    .from(bankProviders)
    .where(and(eq(bankProviders.active, true)));
  const outcomes: SyncOutcome[] = [];
  for (const { id } of active) {
    outcomes.push(await syncProvider(tx, id, today));
  }
  // Segunda passagem: após inserir todos os providers, detecta transferências
  // que não foram pareadas durante o sync individual (ex: ASAAS sincroniza
  // primeiro sem encontrar o par do Inter, que ainda não estava no banco).
  await afterSync(tx);
  return outcomes;
}

/** Passos que dependem de todas as contas já sincronizadas. */
export async function afterSync(tx: Tx): Promise<void> {
  await reconcileTransfers(tx);
  await tx.execute(sql`select public.baixar_mensalidades_por_extrato()`);
  await tx.execute(sql`select public.categorizar_lancamentos_bancarios()`);
}

/**
 * Varre cash_transactions sem categoria e tenta pareá-las como "Transferência
 * entre Contas": dois lançamentos de tipo oposto, mesma data e mesmo valor
 * (±R$ 0,01), ambos sem categoria. Roda depois que todos os providers
 * sincronizaram, eliminando a dependência de ordem de inserção.
 * Exportada para poder ser chamada também no sync individual (botão manual).
 */
export async function reconcileTransfers(tx: Tx): Promise<void> {
  const [transferCat] = await tx
    .select({ id: costCategories.id })
    .from(costCategories)
    .where(eq(costCategories.name, TRANSFER_CATEGORY));
  if (!transferCat) return;

  // Só considera transações vindas de bancos (não manuais) para evitar
  // classificar erroneamente mensalidades coincidentes como transferências.
  const uncategorized = await tx
    .select({
      id: cashTransactions.id,
      date: cashTransactions.date,
      amount: cashTransactions.amount,
      type: cashTransactions.type,
      source: cashTransactions.source,
      description: cashTransactions.description,
    })
    .from(cashTransactions)
    .where(and(isNull(cashTransactions.categoryId), inArray(cashTransactions.source, ["asaas", "inter", "api_sync"])))
    .orderBy(cashTransactions.date, cashTransactions.amount);

  // Transferência real sempre cita a empresa em pelo menos uma das pernas; sem
  // isso, uma mensalidade de R$ 240 coincidindo com um pagamento de R$ 240 na
  // outra conta seria escondida do faturamento.
  const own = (d: string) => d.toUpperCase().includes(OWN_COMPANY_NAME);

  const pool = [...uncategorized];
  const toUpdate: string[] = [];

  for (let i = 0; i < pool.length; i++) {
    const a = pool[i];
    if (!a) continue;
    const oppositeType = a.type === "entrada" ? "saida" : "entrada";
    const j = pool.findIndex(
      (b, k) =>
        k > i &&
        b.date === a.date &&
        b.type === oppositeType &&
        b.source !== a.source &&
        Math.abs(Number(b.amount) - Number(a.amount)) < 0.01 &&
        (own(a.description) || own(b.description))
    );
    if (j !== -1) {
      toUpdate.push(a.id, pool[j]!.id);
      pool.splice(j, 1);
      pool.splice(i, 1);
      i--;
    }
  }

  if (toUpdate.length > 0) {
    await tx
      .update(cashTransactions)
      .set({ categoryId: transferCat.id })
      .where(inArray(cashTransactions.id, toUpdate));
  }

  // Pix da/para a própria empresa vindo de conta não conectada (sem par):
  // continua sendo movimentação entre contas, nunca receita ou despesa.
  await tx
    .update(cashTransactions)
    .set({ categoryId: transferCat.id })
    .where(
      and(
        isNull(cashTransactions.categoryId),
        inArray(cashTransactions.source, ["asaas", "inter", "api_sync"]),
        sql`${cashTransactions.description} ilike ${`%${OWN_COMPANY_NAME}%`}`
      )
    );
}

let backgroundSyncRunning = false;

/**
 * Rede de segurança: sincroniza providers ativos no máximo uma vez a cada
 * ~6 h quando alguém abre o app. Mantém o fluxo "em tempo real" sem agendador,
 * mas o cron/Task Scheduler continua sendo o caminho principal (mais frequente).
 * Não bloqueia a renderização e nunca lança.
 */
export async function ensureBankSyncRecent(tx: Tx): Promise<void> {
  // Cada página aberta chama esta função; sem a trava, várias abas/navegações
  // disparavam syncs simultâneos e estouravam o limite de consultas do Inter (429).
  if (backgroundSyncRunning) return;
  backgroundSyncRunning = true;
  try {
    await runBackgroundSyncIfDue(tx);
  } finally {
    backgroundSyncRunning = false;
  }
}

async function runBackgroundSyncIfDue(tx: Tx): Promise<void> {
  const [due] = await tx
    .select({ id: bankProviders.id })
    .from(bankProviders)
    .where(
      and(
        eq(bankProviders.active, true),
        sql`(${bankProviders.lastSyncedAt} is null or ${bankProviders.lastSyncedAt} < now() - interval '6 hours')`
      )
    )
    .limit(1);
  if (!due) return; // nenhum provider ativo vencido → nada a fazer
  const today = todayBR();
  await syncAllActiveProviders(tx, today);
}
