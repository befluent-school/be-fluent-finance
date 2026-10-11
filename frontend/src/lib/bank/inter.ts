import "server-only";
import https from "node:https";
import type { BankConnector, FetchResult, NormalizedTxn, ProviderConfig, ProviderCredentials } from "./types";
import { str } from "./types";

/**
 * Conector Banco Inter — Empresas (PJ), API Banking v2.
 *
 * Exige mTLS: todas as chamadas vão com o certificado (.crt) e a chave (.key)
 * da integração, gerados no portal do Inter. Como o `fetch` global não aceita
 * um agente TLS customizado, usamos o módulo nativo `node:https` (sem
 * dependências novas) com um Agent que carrega cert+key do cliente.
 *
 * Autenticação OAuth2 client_credentials (POST token_path,
 * grant_type=client_credentials, scope=extrato.read), token de ~60 min
 * cacheado em memória. Extrato consultado por período (dataInicio/dataFim).
 *
 * Caminhos e host são PARAMETRIZÁVEIS no config (a doc oficial é um SPA e pode
 * variar por conta/versão), com defaults corretos:
 *   base_url      cdpj.partners.bancointer.com.br
 *   token_path    /oauth/v2/token
 *   extrato_path  /banking/v2/extrato
 *   scope         extrato.read
 *   conta_corrente (opcional, header x-conta-corrente)
 *
 * Credenciais (cifradas): client_id, client_secret, certificate (PEM .crt),
 * private_key (PEM .key).
 */

const MAX_PAGES = 60;

type TokenCacheEntry = { token: string; expiresAt: number };
const tokenCache = new Map<string, TokenCacheEntry>();

type HttpResponse = { status: number; body: string };

/** Faz uma requisição HTTPS com mTLS (cert+key do cliente). */
function httpsRequest(
  urlStr: string,
  options: { method: string; headers: Record<string, string>; cert: string; key: string; body?: string }
): Promise<HttpResponse> {
  const url = new URL(urlStr);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: options.method,
        headers: options.headers,
        cert: options.cert,
        key: options.key,
        rejectUnauthorized: true,
        timeout: 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") })
        );
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout na conexão com o Inter")));
    if (options.body) req.write(options.body);
    req.end();
  });
}

function cacheKey(clientId: string, cert: string): string {
  return `${clientId}:${cert.length}`;
}

function hostBase(config: ProviderConfig): string {
  const raw = str(config, "base_url", "https://cdpj.partners.bancointer.com.br").replace(/\/+$/, "");
  return raw.startsWith("http") ? raw : `https://${raw}`;
}

async function getToken(config: ProviderConfig, credentials: ProviderCredentials): Promise<string> {
  const clientId = str(credentials, "client_id");
  const clientSecret = str(credentials, "client_secret");
  const cert = str(credentials, "certificate");
  const key = str(credentials, "private_key");
  const scope = str(config, "scope", "extrato.read");
  const tokenPath = str(config, "token_path", "/oauth/v2/token");

  const ck = cacheKey(clientId, cert);
  const cached = tokenCache.get(ck);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope,
  }).toString();

  const res = await httpsRequest(`${hostBase(config)}${tokenPath}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    cert,
    key,
    body,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Inter token ${res.status}: ${res.body.slice(0, 200)}`);
  }
  const json = JSON.parse(res.body) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Inter: resposta de token sem access_token.");

  tokenCache.set(ck, {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  });
  return json.access_token;
}

function normalize(t: Record<string, unknown>): NormalizedTxn | null {
  const date =
    (typeof t.dataEntrada === "string" && t.dataEntrada) ||
    (typeof t.dataTransacao === "string" && t.dataTransacao) ||
    (typeof t.data === "string" && t.data) ||
    "";
  const rawValue =
    typeof t.valor === "number"
      ? t.valor
      : typeof t.valor === "string"
        ? Number(t.valor.replace(",", "."))
        : NaN;
  if (!date || !Number.isFinite(rawValue)) return null;

  const tipo = String(t.tipoTransacao ?? t.tipoOperacao ?? t.tipo ?? "").toUpperCase();
  const isDebit = tipo.startsWith("D");
  const isCredit = tipo.startsWith("C");
  const type: "entrada" | "saida" = isDebit ? "saida" : isCredit ? "entrada" : rawValue < 0 ? "saida" : "entrada";

  const titulo = typeof t.titulo === "string" ? t.titulo : "";
  const descricao = typeof t.descricao === "string" ? t.descricao : "";
  const detalhe = [titulo, descricao].filter(Boolean).join(" — ") || "Movimentação Inter";

  const amount = Math.round(Math.abs(rawValue) * 100) / 100;
  if (amount === 0) return null;

  const id =
    (typeof t.idTransacao === "string" && t.idTransacao) ||
    (typeof t.codigoTransacao === "string" && t.codigoTransacao) ||
    null;

  return {
    date: date.slice(0, 10),
    description: detalhe.slice(0, 400),
    amount,
    type,
    externalId: id ? `inter:${id}` : null,
  };
}

function extractList(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    for (const key of ["transacoes", "transactions", "lista", "content"]) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
  }
  return [];
}

async function fetchExtrato(
  config: ProviderConfig,
  credentials: ProviderCredentials,
  since: string,
  until: string
): Promise<NormalizedTxn[]> {
  const cert = str(credentials, "certificate");
  const key = str(credentials, "private_key");
  if (!cert || !key) throw new Error("Certificado/chave do Inter não configurados.");

  const extratoPath = str(config, "extrato_path", "/banking/v2/extrato");
  const conta = str(config, "conta_corrente");
  const token = await getToken(config, credentials);

  const all: NormalizedTxn[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${hostBase(config)}${extratoPath}`);
    url.searchParams.set("dataInicio", since);
    url.searchParams.set("dataFim", until);
    if (page > 0) url.searchParams.set("pagina", String(page));

    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: "application/json",
    };
    if (conta) headers["x-conta-corrente"] = conta;

    const res = await httpsRequest(url.toString(), { method: "GET", headers, cert, key });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Inter extrato ${res.status}: ${res.body.slice(0, 200)}`);
    }
    const json = JSON.parse(res.body);
    const list = extractList(json);
    for (const t of list) {
      const n = normalize(t);
      if (n) all.push(n);
    }
    const hasNext =
      json && typeof json === "object" && (json as Record<string, unknown>).ultimaPagina === false;
    if (!hasNext || list.length === 0) break;
  }
  return all;
}

export const interConnector: BankConnector = {
  provider: "inter",

  async fetchTransactions(config, credentials, since, until): Promise<FetchResult> {
    try {
      const txns = await fetchExtrato(config, credentials, since, until);
      const through = txns.reduce<string | null>((max, t) => (!max || t.date > max ? t.date : max), null);
      return { ok: true, transactions: txns, through };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Erro ao consultar o Inter." };
    }
  },

  async testConnection(config, credentials): Promise<FetchResult> {
    if (
      !str(credentials, "certificate") ||
      !str(credentials, "private_key") ||
      !str(credentials, "client_id") ||
      !str(credentials, "client_secret")
    ) {
      return { ok: false, error: "Preencha client_id, client_secret, certificado e chave." };
    }
    try {
      await getToken(config, credentials); // valida mTLS + credenciais
      return { ok: true, transactions: [], through: null };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Falha no teste de conexão." };
    }
  },
};
