import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// APP_SECRET precisa existir antes de importar módulos que leem env().
process.env.APP_SECRET ??= "0".repeat(64);
process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";

const { encryptCredentials, decryptCredentials, maskSecret } = await import("@/lib/bank/credentials");
const { asaasConnector } = await import("@/lib/bank/asaas");

describe("credenciais bancárias (cifragem)", () => {
  it("faz round-trip e não guarda o segredo em claro", () => {
    const creds = { api_key: "super-secreta-123", client_id: "abc" };
    const enc = encryptCredentials(creds);
    expect(enc).not.toContain("super-secreta-123");
    expect(decryptCredentials(enc)).toEqual(creds);
  });

  it("devolve {} para payload ilegível em vez de quebrar", () => {
    expect(decryptCredentials(null)).toEqual({});
    expect(decryptCredentials("lixo.invalido")).toEqual({});
  });

  it("mascara segredos", () => {
    expect(maskSecret("abcd1234")).toBe("••••1234");
    expect(maskSecret("")).toBe("");
  });
});

describe("conector ASAAS", () => {
  let server: Server;
  let baseUrl: string;
  let lastHeaders: Record<string, string | string[] | undefined> = {};

  beforeAll(async () => {
    // Mock da API: 2 páginas, uma entrada e uma saída, uma transação neutra (0).
    server = createServer((req, res) => {
      lastHeaders = req.headers;
      const url = new URL(req.url ?? "", "http://x");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      res.setHeader("content-type", "application/json");
      if (offset === 0) {
        res.end(
          JSON.stringify({
            hasMore: true,
            data: [
              { id: "t1", value: 357.0, date: "2026-10-02", description: "Mensalidade Aluno", type: "PAYMENT_RECEIVED" },
              { id: "t2", value: -50.5, date: "2026-10-03", description: "Taxa Asaas", type: "PAYMENT_FEE" },
              { id: "t3", value: 0, date: "2026-10-03", description: "Neutro", type: "CREDIT" },
            ],
          })
        );
      } else {
        res.end(
          JSON.stringify({
            hasMore: false,
            data: [{ id: "t4", value: 697.0, date: "2026-10-05", description: "Mensalidade 2", type: "PIX_TRANSACTION_CREDIT" }],
          })
        );
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("busca, pagina e normaliza transações; manda o header access_token", async () => {
    const res = await asaasConnector.fetchTransactions(
      { base_url: baseUrl, sandbox: false },
      { api_key: "KEY-123" },
      "2026-10-01",
      "2026-10-31"
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // 4 vieram, mas a neutra (0) é descartada → 3.
    expect(res.transactions).toHaveLength(3);

    const t1 = res.transactions.find((t) => t.externalId === "asaas:t1")!;
    expect(t1).toMatchObject({ date: "2026-10-02", amount: 357, type: "entrada" });

    const t2 = res.transactions.find((t) => t.externalId === "asaas:t2")!;
    expect(t2).toMatchObject({ amount: 50.5, type: "saida" }); // valor negativo → saída

    expect(res.through).toBe("2026-10-05"); // data mais recente
    expect(lastHeaders["access_token"]).toBe("KEY-123");
  });

  it("falha com mensagem quando não há API key", async () => {
    const res = await asaasConnector.fetchTransactions({ base_url: baseUrl }, {}, "2026-10-01", "2026-10-31");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/API key/i);
  });

  it("propaga erro HTTP do ASAAS", async () => {
    const res = await asaasConnector.fetchTransactions(
      { base_url: "http://127.0.0.1:1/naoexiste" }, // porta impossível → erro de conexão
      { api_key: "KEY" },
      "2026-10-01",
      "2026-10-31"
    );
    expect(res.ok).toBe(false);
  });
});
