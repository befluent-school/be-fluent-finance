"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { eq } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { bankProviders } from "@/lib/db/schema";
import { logDbError } from "@/lib/db/errors";
import { FORBIDDEN_MESSAGE, getActionUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { encryptCredentials, decryptCredentials } from "@/lib/bank/credentials";
import { asaasConnector } from "@/lib/bank/asaas";
import { interConnector } from "@/lib/bank/inter";
import { syncProvider } from "@/lib/bank/sync";
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

      await tx
        .update(bankProviders)
        .set({
          credentialsEnc: encryptCredentials(next),
          config,
          ...(Number.isFinite(syncWindowDays) && syncWindowDays >= 1 && syncWindowDays <= 90
            ? { syncWindowDays }
            : {}),
        })
        .where(eq(bankProviders.id, id));
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
      return res.ok ? { ok: true, message: "Conexão OK." } : { ok: false, message: res.error };
    });
    return outcome;
  } catch (err) {
    logDbError("testProviderConnection", err);
    return { ok: false, message: "Erro ao testar a conexão." };
  }
}

// ── Sincronizar agora ────────────────────────────────────────────────────────
export async function syncProviderNow(id: string): Promise<{ ok: boolean; message: string }> {
  const user = await getActionUser(POLICY);
  if (!user) return { ok: false, message: FORBIDDEN_MESSAGE };
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Conexão inválida." };

  try {
    const today = new Date().toISOString().slice(0, 10);
    const outcome = await withUser(user.id, (tx) => syncProvider(tx, id, today));
    revalidatePath("/banco/conexoes");
    revalidatePath("/fluxo-de-caixa");
    revalidatePath("/dashboard");
    revalidatePath("/contas");
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
