"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import {
  saveProviderCredentials,
  testProviderConnection,
  syncProviderNow,
  toggleProviderActive,
  deleteBankProvider,
  type ProviderFormState,
} from "@/app/actions/bank-providers";

const inputClass =
  "mt-1 w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-50 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";
const taClass = `${inputClass} font-mono text-xs`;

export type ProviderCardData = {
  id: string;
  provider: string;
  label: string;
  active: boolean;
  configured: boolean;
  syncWindowDays: number;
  config: Record<string, unknown>;
  lastStatus: string;
  lastError: string | null;
  lastSyncedAt: string;
  lastImportedCount: number;
  hasCreds: {
    api_key: boolean;
    client_id: boolean;
    client_secret: boolean;
    certificate: boolean;
    private_key: boolean;
  };
};

function cfg(data: ProviderCardData, key: string, fallback = ""): string {
  const v = data.config[key];
  return typeof v === "string" ? v : fallback;
}

export function ProviderCard({ data }: { data: ProviderCardData }) {
  const formRef = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<ProviderFormState, FormData>(saveProviderCredentials, undefined);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (state?.success) formRef.current?.close();
  }, [state]);

  const statusColor =
    data.lastStatus === "ok" ? "text-status-paid" : data.lastStatus === "erro" ? "text-status-overdue" : "text-ink-400";

  return (
    <div className="card-premium rounded-lg p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-bold text-ink-50">{data.label}</h3>
            <span className="rounded-full bg-ink-800 px-2 py-0.5 text-[10px] uppercase text-ink-400">{data.provider}</span>
          </div>
          <p className={`mt-1 text-xs ${statusColor}`}>
            {data.lastStatus === "ok" ? "Última sync OK" : data.lastStatus === "erro" ? "Erro na última sync" : "Ainda não sincronizado"}
            {" · "}{data.lastSyncedAt}
            {data.lastStatus === "ok" && ` · ${data.lastImportedCount} nova(s)`}
          </p>
          {data.lastError && <p className="mt-1 max-w-sm text-xs text-status-overdue">{data.lastError}</p>}
        </div>
        <button
          disabled={isPending}
          onClick={() => startTransition(async () => { await toggleProviderActive(data.id, !data.active); })}
          className={`rounded-md px-2 py-1 text-xs font-semibold ${data.active ? "bg-status-paid-bg text-status-paid" : "bg-ink-800 text-ink-400"}`}
        >
          {data.active ? "Ativa" : "Inativa"}
        </button>
      </div>

      {!data.configured && (
        <p className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-200">
          Falta configurar as credenciais para esta conexão funcionar.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={() => formRef.current?.showModal()} className="rounded-md bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/25">
          Credenciais e ajustes
        </button>
        <button
          disabled={isPending}
          onClick={() => startTransition(async () => { const r = await testProviderConnection(data.id); setMsg({ ok: r.ok, text: r.message }); })}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-ink-200 ring-1 ring-inset ring-ink-700 hover:text-ink-50 disabled:opacity-60"
        >
          Testar conexão
        </button>
        <button
          disabled={isPending || !data.active}
          onClick={() => startTransition(async () => { const r = await syncProviderNow(data.id); setMsg({ ok: r.ok, text: r.message }); })}
          className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-3 py-1.5 text-xs font-semibold text-ink-950 glow-amber hover:brightness-105 disabled:opacity-60"
          title={!data.active ? "Ative a conexão primeiro" : undefined}
        >
          Sincronizar agora
        </button>
        {confirmDel ? (
          <span className="flex items-center gap-2">
            <button disabled={isPending} onClick={() => startTransition(async () => { await deleteBankProvider(data.id); })} className="rounded-md bg-status-overdue/15 px-2 py-1 text-xs font-semibold text-status-overdue">Confirmar exclusão</button>
            <button onClick={() => setConfirmDel(false)} className="text-xs text-ink-300 hover:text-ink-50">Cancelar</button>
          </span>
        ) : (
          <button onClick={() => setConfirmDel(true)} className="ml-auto rounded-md px-2 py-1 text-xs text-ink-500 hover:text-status-overdue">Excluir</button>
        )}
      </div>

      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-status-paid" : "text-status-overdue"}`}>{msg.text}</p>}
      {state?.success && !msg && <p className="mt-3 text-sm text-status-paid">Credenciais salvas.</p>}

      {/* Dialog de credenciais + config */}
      <dialog ref={formRef} className="card-premium w-full max-w-lg rounded-lg p-0 text-ink-50 backdrop:bg-black/70">
        <form action={action} className="max-h-[85vh] space-y-4 overflow-y-auto p-6">
          <h2 className="font-display text-base font-bold">{data.label} — credenciais e ajustes</h2>
          <input type="hidden" name="id" value={data.id} />
          <p className="text-xs text-ink-400">
            Campos de segredo ficam em branco por segurança. Preencha só para definir ou trocar;
            deixar vazio mantém o valor atual.
          </p>

          {data.provider === "asaas" && (
            <>
              <Field label={`API key${data.hasCreds.api_key ? " (já configurada)" : ""}`}>
                <input name="api_key" type="password" autoComplete="off" className={inputClass} placeholder={data.hasCreds.api_key ? "•••• (manter)" : "cole a API key do ASAAS"} />
              </Field>
              <Field label="Base URL">
                <input name="base_url" className={inputClass} defaultValue={cfg(data, "base_url", "https://api.asaas.com/v3")} />
              </Field>
              <label className="flex items-center gap-2 text-sm text-ink-200">
                <input type="checkbox" name="sandbox" defaultChecked={data.config.sandbox === true} className="size-4 accent-amber-500" />
                Usar ambiente sandbox (testes)
              </label>
            </>
          )}

          {data.provider === "inter" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Client ID${data.hasCreds.client_id ? " ✓" : ""}`}>
                  <input name="client_id" autoComplete="off" className={inputClass} placeholder={data.hasCreds.client_id ? "•••• (manter)" : ""} />
                </Field>
                <Field label={`Client Secret${data.hasCreds.client_secret ? " ✓" : ""}`}>
                  <input name="client_secret" type="password" autoComplete="off" className={inputClass} placeholder={data.hasCreds.client_secret ? "•••• (manter)" : ""} />
                </Field>
              </div>
              <Field label={`Certificado (.crt PEM)${data.hasCreds.certificate ? " ✓" : ""}`}>
                <textarea name="certificate" rows={4} className={taClass} placeholder={data.hasCreds.certificate ? "•••• (manter)" : "-----BEGIN CERTIFICATE-----"} />
              </Field>
              <Field label={`Chave privada (.key PEM)${data.hasCreds.private_key ? " ✓" : ""}`}>
                <textarea name="private_key" rows={4} className={taClass} placeholder={data.hasCreds.private_key ? "•••• (manter)" : "-----BEGIN PRIVATE KEY-----"} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Conta corrente (x-conta-corrente)">
                  <input name="conta_corrente" className={inputClass} defaultValue={cfg(data, "conta_corrente")} placeholder="opcional" />
                </Field>
                <Field label="Scope">
                  <input name="scope" className={inputClass} defaultValue={cfg(data, "scope", "extrato.read")} />
                </Field>
              </div>
              <Field label="Base URL">
                <input name="base_url" className={inputClass} defaultValue={cfg(data, "base_url", "https://cdpj.partners.bancointer.com.br")} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Caminho do token">
                  <input name="token_path" className={inputClass} defaultValue={cfg(data, "token_path", "/oauth/v2/token")} />
                </Field>
                <Field label="Caminho do extrato">
                  <input name="extrato_path" className={inputClass} defaultValue={cfg(data, "extrato_path", "/banking/v2/extrato")} />
                </Field>
              </div>
            </>
          )}

          <Field label="Buscar quantos dias para trás a cada sync">
            <input name="syncWindowDays" type="number" min={1} max={90} defaultValue={data.syncWindowDays} className={inputClass} />
          </Field>

          {state?.message && <p className="text-sm text-status-overdue">{state.message}</p>}

          <div className="flex justify-end gap-3 border-t border-ink-700 pt-3">
            <button type="button" onClick={() => formRef.current?.close()} className="rounded-md px-4 py-2 text-sm font-medium text-ink-300 hover:text-ink-50">Fechar</button>
            <button type="submit" disabled={pending} className="rounded-md bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-2 text-sm font-semibold text-ink-950 glow-amber hover:brightness-105 disabled:opacity-60">
              {pending ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink-200">{label}</label>
      {children}
    </div>
  );
}
