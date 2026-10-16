import { todayBR, formatMonthBR } from "@/lib/dates";
import Link from "next/link";
import { formatCurrencyBRL } from "@shared/finance";
import { requireUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { withUser, sequential } from "@/lib/db";
import { getSimplesApuracao, getSimplesHistory, getAppSettings, getReceitaMensal } from "@/lib/queries/finance";
import { ReceitaForm, type ReceitaFormRow } from "./receita-form";
import { parseYearMonth } from "@/lib/validation";
import { KpiCard } from "@/components/ui/kpi-card";

function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

function pct(fraction: number): string {
  return `${(fraction * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
}

const MONTH_LABELS = [
  "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez",
];

function monthLabel(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return `${MONTH_LABELS[m - 1]}/${y}`;
}

export default async function ImpostosPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const user = await requireUser();
  // Impostos é informação financeira sensível: owner/socio.
  if (!Policies.manageFinance.check(user)) {
    return (
      <div className="rounded-md border border-ink-700 bg-ink-800/40 p-6 text-sm text-ink-300">
        Esta área é restrita a sócios. Fale com o administrador.
      </div>
    );
  }

  const { mes } = await searchParams;
  // Competência padrão: mês fechado (anterior ao atual), que é o que se apura.
  const currentMonth = todayBR().slice(0, 7);
  const defaultCompetencia = addMonths(currentMonth, -1);
  const selectedMonth = parseYearMonth(mes, defaultCompetencia);
  const referenceMonth = `${selectedMonth}-01`;

  const firstMonth = addMonths(selectedMonth, -12);
  const { apuracao, history, settings, receitas } = await withUser(user.id, async (tx) => {
    const [apuracao, history, settings, receitas] = await sequential([
      () => getSimplesApuracao(tx, referenceMonth),
      () => getSimplesHistory(tx, 13),
      () => getAppSettings(tx),
      () => getReceitaMensal(tx, `${firstMonth}-01`, `${addMonths(selectedMonth, 1)}-01`),
    ]);
    return { apuracao, history, settings, receitas };
  });

  // Os 12 meses anteriores (base do RBT12) + a própria competência, mais recente primeiro.
  const formRows: ReceitaFormRow[] = Array.from({ length: 13 }, (_, i) => {
    const ym = addMonths(selectedMonth, -i);
    const month = `${ym}-01`;
    const r = receitas.find((x) => x.reference_month === month);
    return {
      month,
      label: monthLabel(month),
      calculada: r?.receita_calculada ?? 0,
      informada: r?.receita_informada ?? null,
      coberto: r?.coberto ?? false,
    };
  });
  const baseIncompleta = apuracao !== null && (apuracao.meses_faltantes > 0 || !apuracao.receita_completa);

  const anexo = String(settings.simples_anexo ?? "III");
  const dasDueDay = Number(settings.das_due_day ?? 20);
  const totalDasAno = history
    .filter((h) => h.reference_month.startsWith(selectedMonth.slice(0, 4)))
    .reduce((sum, h) => sum + h.das, 0);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-ink-50">Impostos — Simples Nacional</h1>
          <p className="text-sm text-ink-300">
            Anexo {anexo} (serviços de ensino) · DAS vence dia {dasDueDay} do mês seguinte à competência.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/impostos?mes=${addMonths(selectedMonth, -1)}`} className="rounded-md px-2 py-1 text-sm text-ink-300 hover:bg-white/[0.05] hover:text-ink-50">‹</Link>
          <p className="text-sm capitalize text-ink-300">
            Competência {formatMonthBR(referenceMonth)}
          </p>
          <Link href={`/impostos?mes=${addMonths(selectedMonth, 1)}`} className="rounded-md px-2 py-1 text-sm text-ink-300 hover:bg-white/[0.05] hover:text-ink-50">›</Link>
        </div>
      </div>

      {baseIncompleta && apuracao && (
        <div className="mt-6 rounded-md border border-status-overdue/40 bg-status-overdue-bg px-4 py-3 text-sm text-ink-100">
          <strong className="text-status-overdue">Cálculo ainda não confiável.</strong>{" "}
          {!apuracao.receita_completa && "A receita desta competência não está completa nos bancos. "}
          {apuracao.meses_faltantes > 0 &&
            `Faltam ${apuracao.meses_faltantes} ${apuracao.meses_faltantes === 1 ? "mês" : "meses"} de receita para o RBT12. `}
          Informe os valores em <a href="#receita-declarada" className="text-amber-300 underline">Receita declarada</a>,
          abaixo. Enquanto isso, o DAS não é lançado automaticamente em Contas a Pagar.
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="DAS do mês"
          value={apuracao ? formatCurrencyBRL(apuracao.das) : "—"}
          hint={
            baseIncompleta
              ? "Estimativa com base incompleta"
              : apuracao?.faixa
                ? `Faixa ${apuracao.faixa} · alíquota efetiva ${pct(apuracao.effective_rate)}`
                : "Sem receita na competência"
          }
          explanation="Documento de Arrecadação do Simples: receita bruta da competência × alíquota efetiva. Gerado como conta a pagar automaticamente na virada do mês."
          tone="warning"
        />
        <KpiCard
          label="Receita bruta (mês)"
          value={apuracao ? formatCurrencyBRL(apuracao.receita_mes) : "—"}
          hint="Base de cálculo da competência"
          explanation="Receita declarada no PGDAS, quando informada. Senão: entradas de caixa da atividade, sem saldo inicial, transferências entre contas, estornos e lançamentos marcados como 'Não é Receita'."
        />
        <KpiCard
          label="RBT12"
          value={apuracao ? formatCurrencyBRL(apuracao.rbt12) : "—"}
          hint="Receita bruta dos 12 meses anteriores"
          explanation="Receita Bruta acumulada nos 12 meses anteriores à competência. Define a faixa e, com ela, a alíquota. Só é proporcionalizada se a empresa tiver menos de 12 meses de atividade."
        />
        <KpiCard
          label="Alíquota efetiva"
          value={apuracao ? pct(apuracao.effective_rate) : "—"}
          hint={apuracao?.nominal_rate != null ? `Nominal ${pct(apuracao.nominal_rate)}` : undefined}
          explanation="(RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12. É a alíquota real que incide sobre a receita do mês."
        />
      </div>

      <div className="mt-4 rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-xs text-ink-300">
        O DAS de cada competência é lançado automaticamente em <Link href="/contas" className="text-amber-300 underline">Contas a Pagar</Link> na
        virada do mês, com vencimento no dia {dasDueDay}, quando a receita do mês e dos 12 meses anteriores está completa. Confira sempre com a
        sua contabilidade antes de pagar — o valor oficial é o da guia emitida no PGDAS-D.
      </div>

      <h2 id="receita-declarada" className="mt-8 text-lg font-semibold text-ink-50">Receita declarada</h2>
      <p className="mt-1 text-sm text-ink-300">
        Competência {monthLabel(referenceMonth)} e os 12 meses anteriores (base do RBT12).
      </p>
      <div className="mt-3">
        <ReceitaForm key={referenceMonth} rows={formRows} />
      </div>

      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink-50">Histórico de apuração</h2>
        <span className="text-sm text-ink-300">
          Total DAS em {selectedMonth.slice(0, 4)}:{" "}
          <strong className="text-ink-50">{formatCurrencyBRL(totalDasAno)}</strong>
        </span>
      </div>

      <div className="mt-3 card-premium overflow-x-auto rounded-md">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-white/[0.03] text-left text-xs text-ink-300">
              <th className="px-4 py-3 font-medium">Competência</th>
              <th className="px-4 py-3 font-medium">Receita</th>
              <th className="px-4 py-3 font-medium">RBT12</th>
              <th className="px-4 py-3 font-medium">Faixa</th>
              <th className="px-4 py-3 font-medium">Alíq. efetiva</th>
              <th className="px-4 py-3 font-medium">DAS</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-500">
                  Sem receita lançada ainda. Importe extratos no Fluxo de Caixa para apurar o Simples.
                </td>
              </tr>
            )}
            {history.map((h) => (
              <tr key={h.reference_month} className="border-b border-ink-700/70 last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-3 text-ink-50">{monthLabel(h.reference_month)}</td>
                <td className="font-tabular px-4 py-3">{formatCurrencyBRL(h.receita_mes)}</td>
                <td className="font-tabular px-4 py-3 text-ink-300">{formatCurrencyBRL(h.rbt12)}</td>
                <td className="font-tabular px-4 py-3 text-ink-300">{h.faixa ?? "—"}</td>
                <td className="font-tabular px-4 py-3 text-ink-300">{pct(h.effective_rate)}</td>
                <td className="font-tabular px-4 py-3 font-semibold text-status-pending">
                  {formatCurrencyBRL(h.das)}
                  {(h.meses_faltantes > 0 || !h.receita_completa) && (
                    <span className="ml-2 text-xs font-normal text-status-overdue">estimativa</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
