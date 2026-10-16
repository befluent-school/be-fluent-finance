import "server-only";
import { todayBR } from "@/lib/dates";
import type { BankConnector, FetchResult, NormalizedTxn, ProviderConfig } from "./types";
import { str, bool } from "./types";

/**
 * Conector ASAAS — API v3 (extrato / financialTransactions).
 * Doc: GET /v3/financialTransactions?offset&limit&startDate&finishDate
 * Auth: header `access_token: <API key>`.
 * Resposta: { data: [{ value, balance, type, date, description, ... }], hasMore, ... }
 *   value negativo = saída; positivo = entrada.
 *
 * Config esperado:  base_url (default https://api.asaas.com/v3), sandbox (bool)
 * Credencial:       api_key
 */

const SANDBOX_URL = "https://api-sandbox.asaas.com/v3";
const PROD_URL = "https://api.asaas.com/v3";
const PAGE_LIMIT = 100;
const MAX_PAGES = 100; // teto de segurança (10.000 transações por sync)

function baseUrl(config: ProviderConfig): string {
  if (bool(config, "sandbox")) return SANDBOX_URL;
  return str(config, "base_url", PROD_URL).replace(/\/+$/, "");
}

type AsaasTxn = {
  value?: number;
  date?: string;
  description?: string | null;
  type?: string;
  id?: string;
};

type AsaasResponse = { data?: AsaasTxn[]; hasMore?: boolean };

function normalize(t: AsaasTxn): NormalizedTxn | null {
  if (typeof t.value !== "number" || !t.date) return null;
  const amount = Math.abs(t.value);
  if (amount === 0) return null; // ignora lançamentos neutros
  return {
    date: t.date.slice(0, 10),
    description: (t.description?.trim() || t.type || "Movimentação ASAAS").slice(0, 400),
    amount: Math.round(amount * 100) / 100,
    type: t.value < 0 ? "saida" : "entrada",
    externalId: t.id ? `asaas:${t.id}` : null,
  };
}

async function callPage(
  config: ProviderConfig,
  apiKey: string,
  startDate: string,
  finishDate: string,
  offset: number
): Promise<AsaasResponse> {
  const url = new URL(`${baseUrl(config)}/financialTransactions`);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(PAGE_LIMIT));
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("finishDate", finishDate);
  url.searchParams.set("order", "asc");

  const res = await fetch(url, {
    method: "GET",
    headers: {
      access_token: apiKey,
      "User-Agent": "BeFluentFinance/1.0",
      Accept: "application/json",
    },
    // Não cachear: é dado financeiro ao vivo.
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ASAAS ${res.status}: ${body.slice(0, 200) || res.statusText}`);
  }
  return (await res.json()) as AsaasResponse;
}

export const asaasConnector: BankConnector = {
  provider: "asaas",

  async fetchTransactions(config, credentials, since, until): Promise<FetchResult> {
    const apiKey = str(credentials, "api_key");
    if (!apiKey) return { ok: false, error: "API key do ASAAS não configurada." };

    try {
      const all: NormalizedTxn[] = [];
      let offset = 0;
      let through: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const data = await callPage(config, apiKey, since, until, offset);
        const rows = data.data ?? [];
        for (const t of rows) {
          const n = normalize(t);
          if (n) {
            all.push(n);
            if (!through || n.date > through) through = n.date;
          }
        }
        if (!data.hasMore || rows.length === 0) break;
        offset += PAGE_LIMIT;
      }
      return { ok: true, transactions: all, through };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Erro ao consultar o ASAAS." };
    }
  },

  async fetchBalance(config, credentials): Promise<number | null> {
    const apiKey = str(credentials, "api_key");
    if (!apiKey) return null;
    try {
      const res = await fetch(`${baseUrl(config)}/finance/balance`, {
        headers: { access_token: apiKey, "User-Agent": "BeFluentFinance/1.0", Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { balance?: unknown };
      return typeof json.balance === "number" ? json.balance : null;
    } catch {
      return null;
    }
  },

  async testConnection(config, credentials): Promise<FetchResult> {
    const apiKey = str(credentials, "api_key");
    if (!apiKey) return { ok: false, error: "API key do ASAAS não configurada." };
    try {
      // Busca a 1ª página de uma janela curta só para validar a credencial.
      const today = todayBR();
      const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
      await callPage(config, apiKey, monthAgo, today, 0);
      return { ok: true, transactions: [], through: null };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Falha no teste de conexão." };
    }
  },
};
