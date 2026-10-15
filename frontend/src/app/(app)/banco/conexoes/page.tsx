import Link from "next/link";
import { asc } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { withUser } from "@/lib/db";
import { bankProviders } from "@/lib/db/schema";
import { decryptCredentials } from "@/lib/bank/credentials";
import { NewProviderForm } from "./new-provider-form";
import { ProviderCard } from "./provider-card";

function fmtDateTime(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default async function ConexoesPage() {
  const user = await requireUser();
  if (!Policies.manageFinance.check(user)) {
    return (
      <div className="rounded-md border border-ink-700 bg-ink-800/40 p-6 text-sm text-ink-300">
        Esta área é restrita a sócios.
      </div>
    );
  }

  const providers = await withUser(user.id, (tx) =>
    tx.select().from(bankProviders).orderBy(asc(bankProviders.label))
  );

  // Decide, por provider, quais segredos já estão preenchidos (sem expor valor).
  const cards = providers.map((p) => {
    const creds = decryptCredentials(p.credentialsEnc);
    const configured =
      p.provider === "asaas"
        ? Boolean(creds.api_key)
        : p.provider === "inter"
          ? Boolean(creds.client_id && creds.client_secret && creds.certificate && creds.private_key)
          : Object.keys(creds).length > 0;
    return {
      id: p.id,
      provider: p.provider,
      label: p.label,
      active: p.active,
      configured,
      syncWindowDays: p.syncWindowDays,
      config: (p.config ?? {}) as Record<string, unknown>,
      lastStatus: p.lastStatus,
      lastError: p.lastError,
      lastSyncedAt: fmtDateTime(p.lastSyncedAt),
      lastImportedCount: p.lastImportedCount,
      openingBalance: p.openingBalance ?? null,
      openingBalanceDate: p.openingBalanceDate ?? null,
      hasCreds: {
        api_key: Boolean(creds.api_key),
        client_id: Boolean(creds.client_id),
        client_secret: Boolean(creds.client_secret),
        certificate: Boolean(creds.certificate),
        private_key: Boolean(creds.private_key),
      },
    };
  });

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-ink-50">Conexões bancárias</h1>
          <p className="max-w-2xl text-sm text-ink-300">
            Conecte ASAAS e Inter PJ pelas APIs oficiais para que entradas e saídas apareçam
            automaticamente no Fluxo de Caixa — sem importar extrato. As credenciais ficam
            cifradas no servidor e nunca saem da tela.
          </p>
        </div>
        <NewProviderForm />
      </div>

      <div className="mt-4 rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-xs text-ink-300">
        A sincronização roda automaticamente (a cada poucas horas ao abrir o app, e de hora em
        hora quando o agendador do sistema está configurado — ver{" "}
        <code className="rounded bg-ink-800 px-1">deploy/AUTOMACAO.md</code>). Você também pode
        clicar em <strong>Sincronizar agora</strong> a qualquer momento. Impostos (DAS) você
        continua lançando manualmente em <Link href="/contas" className="text-amber-300 underline">Contas a Pagar</Link>.
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {cards.length === 0 && (
          <div className="rounded-md border border-ink-700 bg-ink-800/40 p-6 text-sm text-ink-300">
            Nenhuma conexão ainda. Clique em “Nova conexão”.
          </div>
        )}
        {cards.map((c) => (
          <ProviderCard key={c.id} data={c} />
        ))}
      </div>
    </div>
  );
}
