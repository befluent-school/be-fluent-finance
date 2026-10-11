import "server-only";

/**
 * Contrato comum dos conectores bancários. Cada banco (ASAAS, Inter, …)
 * implementa `fetchTransactions`, devolvendo movimentações já normalizadas
 * para o formato que o fluxo de caixa entende. A camada de sync (sync.ts)
 * não conhece detalhes de nenhuma API — só este contrato.
 */

export type NormalizedTxn = {
  /** Data da movimentação, YYYY-MM-DD. */
  date: string;
  /** Descrição legível (título + detalhe quando houver). */
  description: string;
  /** Valor absoluto, sempre positivo. */
  amount: number;
  /** entrada = dinheiro entrou; saida = dinheiro saiu. */
  type: "entrada" | "saida";
  /**
   * Id único e estável da transação no banco de origem, quando existir.
   * Usado no dedupe para nunca lançar a mesma transação duas vezes mesmo que
   * data/valor/descrição coincidam com outra. Null → cai no dedupe por
   * (data|descrição|valor|tipo), igual à importação manual.
   */
  externalId: string | null;
};

export type FetchResult =
  | { ok: true; transactions: NormalizedTxn[]; through: string | null }
  | { ok: false; error: string };

export type ProviderConfig = Record<string, unknown>;
export type ProviderCredentials = Record<string, string>;

export interface BankConnector {
  /** Nome do provedor (igual ao enum de bank_providers.provider). */
  readonly provider: string;
  /** Busca transações entre `since` e `until` (inclusive), YYYY-MM-DD. */
  fetchTransactions(
    config: ProviderConfig,
    credentials: ProviderCredentials,
    since: string,
    until: string
  ): Promise<FetchResult>;
  /** Testa a conexão/credenciais sem necessariamente trazer dados. */
  testConnection(config: ProviderConfig, credentials: ProviderCredentials): Promise<FetchResult>;
}

/** Helper: lê string de um config/credentials com fallback. */
export function str(obj: Record<string, unknown>, key: string, fallback = ""): string {
  const v = obj[key];
  return typeof v === "string" ? v : fallback;
}

export function bool(obj: Record<string, unknown>, key: string, fallback = false): boolean {
  const v = obj[key];
  return typeof v === "boolean" ? v : fallback;
}
