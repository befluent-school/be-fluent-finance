import { requireUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { withUser, sequential } from "@/lib/db";
import { listJobRuns, getAppSettings } from "@/lib/queries/finance";
import { RunNowButton } from "./run-now-button";
import { SettingsForm } from "./settings-form";

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function summarize(result: Record<string, unknown> | null): string {
  if (!result) return "—";
  if (result.skipped) return "Pulado (automação desligada)";
  const inv = Number(result.invoices_created ?? 0);
  const pay = Number(result.payables_created ?? 0);
  const das = Number(result.das_created ?? 0);
  const fixed = Number(result.statuses_fixed ?? 0);
  return `${inv} mensalidade(s), ${pay} conta(s) recorrente(s), ${das} DAS, ${fixed} status`;
}

export default async function AutomacaoPage() {
  const user = await requireUser();
  if (!Policies.manageFinance.check(user)) {
    return <div className="rounded-md border border-ink-700 bg-ink-800/40 p-6 text-sm text-ink-300">Área restrita a sócios.</div>;
  }

  const { runs, settings } = await withUser(user.id, async (tx) => {
    const [runs, settings] = await sequential([
      () => listJobRuns(tx, 12),
      () => getAppSettings(tx),
    ]);
    return { runs, settings };
  });

  const enabled = settings.rollover_enabled !== false;
  const invoiceDay = Number(settings.invoice_generation_day ?? 1);
  const dasDueDay = Number(settings.das_due_day ?? 20);
  const anexo = String(settings.simples_anexo ?? "III");
  const lastSuccess = runs.find((r) => r.status === "success");

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-ink-50">Automação — Virada de mês/ano</h1>
          <p className="max-w-2xl text-sm text-ink-300">
            Todo dia a automação gera as mensalidades do mês, as contas recorrentes, o DAS do Simples da
            competência fechada e atualiza o que venceu. É idempotente: rodar de novo não duplica nada.
          </p>
        </div>
        <RunNowButton />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card-premium rounded-md p-4">
          <p className="text-xs uppercase tracking-wide text-ink-300">Status</p>
          <p className={`mt-1 text-lg font-bold ${enabled ? "text-status-paid" : "text-status-overdue"}`}>
            {enabled ? "Ativa" : "Desligada"}
          </p>
        </div>
        <div className="card-premium rounded-md p-4">
          <p className="text-xs uppercase tracking-wide text-ink-300">Última execução com sucesso</p>
          <p className="mt-1 text-sm text-ink-50">{lastSuccess ? fmtDateTime(lastSuccess.finished_at ?? lastSuccess.started_at) : "Nunca"}</p>
        </div>
        <div className="card-premium rounded-md p-4">
          <p className="text-xs uppercase tracking-wide text-ink-300">Regras atuais</p>
          <p className="mt-1 text-xs text-ink-300">
            Mensalidades dia {invoiceDay} · DAS dia {dasDueDay} · Anexo {anexo}
          </p>
        </div>
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Configurações</h2>
      <div className="mt-3">
        <SettingsForm rolloverEnabled={enabled} invoiceDay={invoiceDay} dasDueDay={dasDueDay} anexo={anexo} />
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Histórico de execuções</h2>
      <div className="mt-3 card-premium overflow-x-auto rounded-md">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-white/[0.03] text-left text-xs text-ink-300">
              <th className="px-4 py-3 font-medium">Quando</th>
              <th className="px-4 py-3 font-medium">Origem</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-ink-500">Ainda não houve nenhuma execução.</td></tr>
            )}
            {runs.map((r) => (
              <tr key={r.id} className="border-b border-ink-700/70 last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-3 text-ink-300">{fmtDateTime(r.started_at)}</td>
                <td className="px-4 py-3 text-ink-300">
                  {r.trigger === "scheduled" ? "Agendada" : r.trigger === "manual" ? "Manual" : "Inicialização"}
                </td>
                <td className="px-4 py-3">
                  <span className={r.status === "success" ? "text-status-paid" : r.status === "error" ? "text-status-overdue" : "text-status-pending"}>
                    {r.status === "success" ? "Sucesso" : r.status === "error" ? "Erro" : "Rodando"}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink-300">{r.error ? r.error : summarize(r.result)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-ink-500">
        O agendamento automático (Task Scheduler no Windows ou cron na VPS) está descrito em{" "}
        <code className="rounded bg-ink-800 px-1">deploy/AUTOMACAO.md</code>. Mesmo sem agendador, a virada
        roda sozinha ao abrir qualquer tela depois que o mês vira — mas o ideal é agendar.
      </p>
    </div>
  );
}
