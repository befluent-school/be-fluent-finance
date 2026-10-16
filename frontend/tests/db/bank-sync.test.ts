import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ownerPool, ensureUser } from "./helpers";

// env mínima para credentials.ts e db
process.env.APP_SECRET ??= "0".repeat(64);
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";

const { encryptCredentials } = await import("@/lib/bank/credentials");
const { syncProvider } = await import("@/lib/bank/sync");
const { withUser } = await import("@/lib/db");

describe("sincronização ASAAS → cash_transactions (ponta a ponta)", () => {
  let server: Server;
  let base: string;
  let owner: string;
  let providerId: string;

  beforeAll(async () => {
    owner = await ensureUser("rls-owner@teste.local", "owner");
    server = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url?.startsWith("/finance/balance")) {
        res.end(JSON.stringify({ balance: 1234.56 }));
        return;
      }
      res.end(JSON.stringify({
        hasMore: false,
        data: [
          { id: "sync1", value: 357.0, date: "2026-10-02", description: "Mensalidade Sync", type: "PAYMENT_RECEIVED" },
          { id: "sync2", value: -99.9, date: "2026-10-03", description: "Taxa Sync", type: "PAYMENT_FEE" },
        ],
      }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
    const enc = encryptCredentials({ api_key: "KEY-SYNC" });
    const { rows } = await ownerPool.query(
      `insert into public.bank_providers (provider, label, active, config, credentials_enc)
       values ('asaas', '__sync_test__', true, $1::jsonb, $2) returning id`,
      [JSON.stringify({ base_url: base, sandbox: false }), enc]
    );
    providerId = rows[0].id;
  });

  afterAll(async () => {
    await ownerPool.query("delete from public.cash_transactions where dedupe_key like 'asaas:sync%'");
    await ownerPool.query("delete from public.bank_providers where label = '__sync_test__'");
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("importa, deduplica na 2ª rodada e marca o provider como ok", async () => {
    const today = "2026-10-31";
    const r1 = await withUser(owner, (tx) => syncProvider(tx, providerId, today));
    expect(r1.ok).toBe(true);
    expect(r1.imported).toBe(2);

    // Lançou em cash_transactions com source asaas e id externo no dedupe_key.
    const inserted = await ownerPool.query(
      "select source, dedupe_key, type, amount from public.cash_transactions where dedupe_key in ('asaas:sync1','asaas:sync2') order by dedupe_key"
    );
    expect(inserted.rowCount).toBe(2);
    expect(inserted.rows[0].source).toBe("asaas");
    expect(Number(inserted.rows[1].amount)).toBe(99.9);
    expect(inserted.rows[1].type).toBe("saida");

    // 2ª rodada: idempotente (nada novo).
    const r2 = await withUser(owner, (tx) => syncProvider(tx, providerId, today));
    expect(r2.imported).toBe(0);
    expect(r2.skipped).toBe(2);

    // provider marcado ok.
    const prov = await ownerPool.query("select last_status, last_imported_count, bank_balance from public.bank_providers where id = $1", [providerId]);
    expect(prov.rows[0].last_status).toBe("ok");
    expect(Number(prov.rows[0].bank_balance)).toBe(1234.56);
  });
});
