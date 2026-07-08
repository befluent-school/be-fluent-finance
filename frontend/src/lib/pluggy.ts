import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const PLUGGY_API_BASE = "https://api.pluggy.ai";

let cachedApiKey: { key: string; expiresAt: number } | null = null;

/**
 * A API Key da Pluggy expira em 2h. Cacheamos em memória do processo e
 * renovamos automaticamente quando perto de expirar — evita autenticar a
 * cada chamada, mas nunca guarda o Client Secret em lugar acessível ao
 * frontend (este módulo é "server-only" e nunca importado por Client Components).
 */
async function getApiKey(): Promise<string> {
  if (cachedApiKey && cachedApiKey.expiresAt > Date.now()) {
    return cachedApiKey.key;
  }

  const response = await fetch(`${PLUGGY_API_BASE}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: process.env.PLUGGY_CLIENT_ID,
      clientSecret: process.env.PLUGGY_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    throw new Error(`Falha ao autenticar com a Pluggy: ${response.status}`);
  }

  const data = await response.json();
  cachedApiKey = { key: data.apiKey, expiresAt: Date.now() + 1000 * 60 * 100 };
  return cachedApiKey.key;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Uma tentativa extra com pequeno backoff apenas para erros transitórios
 * (rede ou 5xx da Pluggy) — erros 4xx (ex: token inválido) falham direto,
 * pois repetir não resolve.
 */
async function pluggyFetch(path: string, options: RequestInit = {}, attempt = 1) {
  const apiKey = await getApiKey();

  let response: Response;
  try {
    response = await fetch(`${PLUGGY_API_BASE}${path}`, {
      ...options,
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch (networkError) {
    if (attempt < 2) {
      await sleep(500);
      return pluggyFetch(path, options, attempt + 1);
    }
    throw new Error(
      `Falha de rede ao chamar a Pluggy: ${networkError instanceof Error ? networkError.message : String(networkError)}`
    );
  }

  if (!response.ok) {
    if (response.status >= 500 && attempt < 2) {
      await sleep(500);
      return pluggyFetch(path, options, attempt + 1);
    }
    const body = await response.text();
    throw new Error(`Pluggy API error ${response.status}: ${body}`);
  }

  return response.json();
}

/** Gera um Connect Token de curta duração (30 min) para o widget no frontend. */
export async function createConnectToken(webhookUrl?: string) {
  const data = await pluggyFetch("/connect_token", {
    method: "POST",
    body: JSON.stringify({
      options: webhookUrl ? { webhookUrl } : undefined,
    }),
  });
  return data.accessToken as string;
}

export async function getItem(itemId: string) {
  return pluggyFetch(`/items/${itemId}`);
}

export async function getAccounts(itemId: string) {
  const data = await pluggyFetch(`/accounts?itemId=${itemId}`);
  return data.results as { id: string; type: string; name: string }[];
}

type PluggyTransaction = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: "DEBIT" | "CREDIT";
};

/** Busca todas as transações de uma conta, paginando pelo cursor `after`. */
export async function getAllTransactions(accountId: string): Promise<PluggyTransaction[]> {
  const all: PluggyTransaction[] = [];
  let after: string | undefined;

  do {
    const query = new URLSearchParams({ accountId, pageSize: "500" });
    if (after) query.set("after", after);

    const data = await pluggyFetch(`/transactions?${query.toString()}`);
    all.push(...data.results);
    after = data.page?.after;
  } while (after);

  return all;
}

/**
 * Busca todas as contas do Item na Pluggy e importa as transações de cada
 * uma para a tabela de staging — nunca direto em cash_transactions, para
 * exigir confirmação humana antes de contar como lançamento real.
 * Aceita qualquer client Supabase (com sessão de usuário ou service role),
 * pois é chamada tanto de Server Actions quanto do webhook handler.
 */
/**
 * Estados da Pluggy em que o Item ainda está sendo processado do lado deles
 * — sincronizar agora traria poucas/nenhuma transação, então não deve ser
 * tratado como sucesso pleno (evita marcar "updated" de forma enganosa).
 */
const ITEM_IN_PROGRESS_STATUSES = new Set(["UPDATING", "LOGIN_IN_PROGRESS", "WAITING_USER_INPUT"]);

export async function syncBankConnectionTransactions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  bankConnectionId: string,
  pluggyItemId: string
) {
  try {
    const item = await getItem(pluggyItemId);

    if (ITEM_IN_PROGRESS_STATUSES.has(item.status)) {
      await supabase
        .from("bank_connections")
        .update({ status: "updating", last_error: null })
        .eq("id", bankConnectionId);
      return;
    }

    const accounts = await getAccounts(pluggyItemId);

    for (const account of accounts) {
      const transactions = await getAllTransactions(account.id);
      if (transactions.length === 0) continue;

      const { error: stagingError } = await supabase.from("bank_transactions_staging").upsert(
        transactions.map((t) => ({
          bank_connection_id: bankConnectionId,
          pluggy_transaction_id: t.id,
          date: t.date.slice(0, 10),
          description: t.description,
          amount: Math.abs(t.amount),
          pluggy_type: t.type,
        })),
        { onConflict: "pluggy_transaction_id", ignoreDuplicates: true }
      );

      if (stagingError) {
        throw new Error(`Falha ao salvar transações: ${stagingError.message}`);
      }
    }

    await supabase
      .from("bank_connections")
      .update({ last_synced_at: new Date().toISOString(), status: "updated", last_error: null })
      .eq("id", bankConnectionId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("bank_connections")
      .update({ status: "error", last_error: message })
      .eq("id", bankConnectionId);
    throw err;
  }
}
