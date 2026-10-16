"use server";

import { todayBR } from "@/lib/dates";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import { and, eq } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { bankProviders, cashTransactions } from "@/lib/db/schema";
import { logDbError } from "@/lib/db/errors";
import { FORBIDDEN_MESSAGE, getActionUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { encryptCredentials, decryptCredentials } from "@/lib/bank/credentials";
import { asaasConnector } from "@/lib/bank/asaas";
import { interConnector } from "@/lib/bank/inter";
import { syncProvider, afterSync } from "@/lib/bank/sync";
import type { BankConnector } from "@/lib/bank/types";

// Conexões bancárias são dado sensível: owner/socio (mesmo RLS da tabela).
const POLICY = Policies.manageFinance;

const CONNECTORS: Record<string, BankConnector> = { asaas: asaasConnector, inter: interConnector };

export type ProviderFormState =
  | { errors?: Record<string, string[]>; message?: string; success?: boolean }
  | undefined;

// ── Criar provider ──────────────────────────────────────────────────────────
const CreateSchema = z.object({
  provider: z.enum(["asaas", "inter", "generic_api"]),
  label: z.string().trim().min(2, { error: "Informe um rótulo." }).max(100),
  syncWindowDays: z.coerce.number().int().min(1).max(90).default(35),
});

export async function createBankProvider(_state: ProviderFormState, formData: FormData): Promise<ProviderFormState> {
  const user = await getActionUser(POLICY);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const parsed = CreateSchema.safeParse({
    provider: formData.get("provider"),
    label: formData.get("label"),
    syncWindowDays: formData.get("syncWindowDays") || 35,
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  // Config default por provedor (editável depois).
  const config =
    parsed.data.provider === "asaas"
      ? { base_url: "https://api.asaas.com/v3", sandbox: false }
      : parsed.data.provider === "inter"
        ? {
            base_url: "https://cdpj.partners.bancointer.com.br",
            token_path: "/oauth/v2/token",
            extrato_path: "/banking/v2/extrato",
            scope: "extrato.read",
            conta_corrente: "",
          }
        : {};

  try {
    await withUser(user.id, (tx) =>
      tx.insert(bankProviders).values({
        provider: parsed.data.provider,
        label: parsed.data.label,
        syncWindowDays: parsed.data.syncWindowDays,
        config,
        active: false,
      })
    );
  } catch (err) {
    logDbError("createBankProvider", err);
    return { message: "Erro ao criar a conexão. O rótulo já existe?" };
  }

  revalidatePath("/banco/conexoes");
  return { success: true };
}

// ── Salvar credenciais + config ──────────────────────────────────────────────
// As credenciais chegam em claro do formulário (HTTPS), são cifradas aqui e só
// o texto cifrado vai ao banco. Campos vazios NÃO sobrescrevem o que já existe
// (permite editar config sem redigitar segredo).
export async function saveProviderCredentials(_state: ProviderFormState, formData: FormData): Promise<ProviderFormState> {
  const user = await getActionUser(POLICY);
  if (!user) return { message: FORBIDDEN_MESSAGE };

  const id = formData.get("id");
  if (typeof id !== "string" || !z.uuid().safeParse(id).success) return { message: "Conexão inválida." };

  try {
    const result = await withUser(user.id, async (tx) => {
      const [p] = await tx.select().from(bankProviders).where(eq(bankProviders.id, id));
      if (!p) return "notfound" as const;

      const current = decryptCredentials(p.credentialsEnc);
      const next = { ...current };

      // Campos sensíveis por provedor; só sobrescreve se veio valor não-vazio.
      const setIf = (key: string, formKey: string) => {
        const v = formData.get(formKey);
        if (typeof v === "string" && v.trim().length > 0) next[key] = v.trim();
      };

      if (p.provider === "asaas") {
        setIf("api_key", "api_key");
      } else if (p.provider === "inter") {
        setIf("client_id", "client_id");
        setIf("client_secret", "client_secret");
        setIf("certificate", "certificate");
        setIf("private_key", "private_key");
      }

      // Config não-sensível editável.
      const config: Record<string, unknown> = { ...(p.config ?? {}) };
      const cfgStr = (formKey: string, cfgKey: string) => {
        const v = formData.get(formKey);
        if (typeof v === "string") config[cfgKey] = v.trim();
      };
      const cfgBool = (formKey: string, cfgKey: string) => {
        config[cfgKey] = formData.get(formKey) === "on";
      };
      if (p.provider === "asaas") {
        cfgStr("base_url", "base_url");
        cfgBool("sandbox", "sandbox");
      } else if (p.provider === "inter") {
        cfgStr("base_url", "base_url");
        cfgStr("token_path", "token_path");
        cfgStr("extrato_path", "extrato_path");
        cfgStr("scope", "scope");
        cfgStr("conta_corrente", "conta_corrente");
      }

      const windowRaw = formData.get("syncWindowDays");
      const syncWindowDays = Number(windowRaw);

      const openingBalanceRaw = formData.get("openingBalance");
      const openingBalanceDateRaw = formData.get("openingBalanceDate");
      const openingBalance =
        typeof openingBalanceRaw === "string" && openingBalanceRaw.trim() !== ""
          ? Number(openingBalanceRaw.replace(",", "."))
          : null;
      const openingBalanceDate =
        typeof openingBalanceDateRaw === "string" && openingBalanceDateRaw.trim() !== ""
          ? openingBalanceDateRaw.trim()
          : null;

      await tx
        .update(bankProviders)
        .set({
          credentialsEnc: encryptCredentials(next),
          config,
          ...(Number.isFinite(syncWindowDays) && syncWindowDays >= 1 && syncWindowDays <= 90
            ? { syncWindowDays }
            : {}),
          ...(openingBalance !== null ? { openingBalance } : {}),
          ...(openingBalanceDate ? { openingBalanceDate } : {}),
        })
        .where(eq(bankProviders.id, id));

      // Upsert da transação de abertura: remove a anterior (se houver) e insere nova.
      // Saldo zero não gera lançamento (valor precisa ser > 0): a conta passa a
      // usar a data de corte do primeiro saldo inicial das demais contas.
      if (openingBalance !== null && openingBalance >= 0 && openingBalanceDate) {
        await tx
          .delete(cashTransactions)
          .where(and(eq(cashTransactions.bankProviderId, id), eq(cashTransactions.source, "opening")));
      }
      if (openingBalance !== null && openingBalance > 0 && openingBalanceDate) {
        await tx.insert(cashTransactions).values({
          date: openingBalanceDate,
          description: `Saldo inicial — ${p.label}`,
          amount: openingBalance,
          type: "entrada",
          source: "opening",
          bankProviderId: id,
          dedupeKey: `opening|${id}`,
        });
      }

      return "ok" as const;
    });
    if (result === "notfound") return { message: "Conexão não encontrada." };
  } catch (err) {
    logDbError("saveProviderCredentials", err);
    return { message: "Erro ao salvar as credenciais." };
  }

  revalidatePath("/banco/conexoes");
  return { success: true };
}

// ── Testar conexão ───────────────────────────────────────────────────────────
export async function testProviderConnection(id: string): Promise<{ ok: boolean; message: string }> {
  const user = await getActionUser(POLICY);
  if (!user) return { ok: false, message: FORBIDDEN_MESSAGE };
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Conexão inválida." };

  try {
    const outcome = await withUser(user.id, async (tx) => {
      const [p] = await tx.select().from(bankProviders).where(eq(bankProviders.id, id));
      if (!p) return { ok: false, message: "Conexão não encontrada." };
      const connector = CONNECTORS[p.provider];
      if (!connector) return { ok: false, message: "Conector não implementado." };
      const creds = decryptCredentials(p.credentialsEnc);
      const res = await connector.testConnection(p.config ?? {}, creds);
      if (!res.ok) return { ok: false, message: res.error };
      // Teste OK = credenciais válidas: já deixa a conexão ativa, para o botão
      // "Sincronizar agora" (e o cron) funcionarem sem um passo extra manual.
      if (!p.active) await tx.update(bankProviders).set({ active: true }).where(eq(bankProviders.id, id));
      return { ok: true, message: "Conexão OK. Conexão ativada — já pode sincronizar." };
    });
    if (outcome.ok) revalidatePath("/banco/conexoes");
    return outcome;
  } catch (err) {
    logDbError("testProviderConnection", err);
    return { ok: false, message: "Erro ao testar a conexão." };
  }
}

// ── Importar histórico ───────────────────────────────────────────────────────
export async function importProviderHistory(id: string, since: string): Promise<{ ok: boolean; message: string }> {
  const user = await getActionUser(POLICY);
  if (!user) return { ok: false, message: FORBIDDEN_MESSAGE };
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Conexão inválida." };
  const today = todayBR();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || since < "2015-01-01" || since > today) {
    return { ok: false, message: "Data inicial inválida." };
  }

  try {
    const outcome = await withUser(user.id, async (tx) => {
      const result = await syncProvider(tx, id, today, since);
      await afterSync(tx);
      return result;
    });
    for (const path of ["/banco/conexoes", "/fluxo-de-caixa", "/dashboard", "/impostos", "/relatorio-anual", "/mensalidades"]) {
      revalidatePath(path);
    }
    if (!outcome.ok) {
      const saved = outcome.imported > 0 ? `${outcome.imported} lançamento(s) já gravado(s). ` : "";
      return { ok: false, message: `${saved}${outcome.error ?? "Falha ao importar."}` };
    }
    return { ok: true, message: `Histórico importado: ${outcome.imported} nova(s), ${outcome.skipped} já existia(m).` };
  } catch (err) {
    logDbError("importProviderHistory", err);
    return { ok: false, message: "Erro ao importar o histórico." };
  }
}

// ── Sincronizar agora ────────────────────────────────────────────────────────
export async function syncProviderNow(id: string): Promise<{ ok: boolean; message: string }> {
  const user = await getActionUser(POLICY);
  if (!user) return { ok: false, message: FORBIDDEN_MESSAGE };
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Conexão inválida." };

  try {
    const today = todayBR();
    const outcome = await withUser(user.id, async (tx) => {
      const result = await syncProvider(tx, id, today);
      await afterSync(tx);
      return result;
    });
    revalidatePath("/banco/conexoes");
    revalidatePath("/fluxo-de-caixa");
    revalidatePath("/dashboard");
    revalidatePath("/contas");
    revalidatePath("/mensalidades");
    if (!outcome.ok) return { ok: false, message: outcome.error ?? "Falha na sincronização." };
    return {
      ok: true,
      message: `Sincronizado: ${outcome.imported} nova(s), ${outcome.skipped} já existia(m).`,
    };
  } catch (err) {
    logDbError("syncProviderNow", err);
    return { ok: false, message: "Erro ao sincronizar." };
  }
}

// ── Ativar/desativar ─────────────────────────────────────────────────────────
export async function toggleProviderActive(id: string, active: boolean): Promise<{ error?: string }> {
  const user = await getActionUser(POLICY);
  if (!user) return { error: FORBIDDEN_MESSAGE };
  if (!z.object({ id: z.uuid(), active: z.boolean() }).safeParse({ id, active }).success) {
    return { error: "Dados inválidos." };
  }
  try {
    await withUser(user.id, (tx) => tx.update(bankProviders).set({ active }).where(eq(bankProviders.id, id)));
  } catch (err) {
    logDbError("toggleProviderActive", err);
    return { error: "Erro ao atualizar." };
  }
  revalidatePath("/banco/conexoes");
  return {};
}

// ── Excluir ──────────────────────────────────────────────────────────────────
export async function deleteBankProvider(id: string): Promise<{ error?: string; success?: boolean }> {
  const user = await getActionUser(POLICY);
  if (!user) return { error: FORBIDDEN_MESSAGE };
  if (!z.uuid().safeParse(id).success) return { error: "Conexão inválida." };
  try {
    const del = await withUser(user.id, (tx) =>
      tx.delete(bankProviders).where(eq(bankProviders.id, id)).returning({ id: bankProviders.id })
    );
    if (del.length === 0) return { error: "Conexão não encontrada." };
  } catch (err) {
    logDbError("deleteBankProvider", err);
    return { error: "Erro ao excluir." };
  }
  revalidatePath("/banco/conexoes");
  return { success: true };
}
