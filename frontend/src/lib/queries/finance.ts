import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";

/**
 * Consultas financeiras das novas áreas: Simples Nacional (apuração/DAS),
 * contas a pagar/receber e projeção de caixa. Usam as views/funcs criadas em
 * db/migrations/0023–0025 (security_invoker / security definer com grant).
 */

export type SimplesApuracao = {
  reference_month: string;
  anexo: string;
  rbt12: number;
  faixa: number | null;
  nominal_rate: number | null;
  effective_rate: number;
  receita_mes: number;
  das: number;
  meses_faltantes: number;
  receita_completa: boolean;
};

const APURACAO_COLUMNS = sql`reference_month::text, anexo, rbt12, faixa, nominal_rate, effective_rate,
  receita_mes, das, meses_faltantes, receita_completa`;

function toApuracao(r: SimplesApuracao): SimplesApuracao {
  return {
    reference_month: r.reference_month,
    anexo: r.anexo,
    rbt12: Number(r.rbt12 ?? 0),
    faixa: r.faixa == null ? null : Number(r.faixa),
    nominal_rate: r.nominal_rate == null ? null : Number(r.nominal_rate),
    effective_rate: Number(r.effective_rate ?? 0),
    receita_mes: Number(r.receita_mes ?? 0),
    das: Number(r.das ?? 0),
    meses_faltantes: Number(r.meses_faltantes ?? 0),
    receita_completa: Boolean(r.receita_completa),
  };
}

/** Apuração do Simples para um mês de competência (YYYY-MM-01). */
export async function getSimplesApuracao(tx: Tx, referenceMonth: string): Promise<SimplesApuracao | null> {
  const { rows } = await tx.execute<SimplesApuracao>(
    sql`select ${APURACAO_COLUMNS} from public.simples_apuracao(${referenceMonth}::date)`
  );
  return rows[0] ? toApuracao(rows[0]) : null;
}

/** Histórico de apuração (todos os meses com receita), mais recente primeiro. */
export async function getSimplesHistory(tx: Tx, limit = 13): Promise<SimplesApuracao[]> {
  const { rows } = await tx.execute<SimplesApuracao>(
    sql`select ${APURACAO_COLUMNS} from public.v_simples_apuracao
        order by reference_month desc
        limit ${limit}`
  );
  return rows.map(toApuracao);
}

export type ReceitaMensal = {
  reference_month: string;
  receita_calculada: number;
  receita_informada: number | null;
  coberto: boolean;
};

/** Receita por mês entre `from` (inclusive) e `to` (exclusive), com a origem de cada valor. */
export async function getReceitaMensal(tx: Tx, from: string, to: string): Promise<ReceitaMensal[]> {
  const { rows } = await tx.execute<{
    reference_month: string;
    receita_calculada: string;
    receita_informada: string | null;
    coberto: boolean;
  }>(
    sql`select reference_month::text, receita_calculada, receita_informada, coberto
        from public.v_receita_bruta_mensal
        where reference_month >= ${from}::date and reference_month < ${to}::date`
  );
  return rows.map((r) => ({
    reference_month: r.reference_month,
    receita_calculada: Number(r.receita_calculada),
    receita_informada: r.receita_informada === null ? null : Number(r.receita_informada),
    coberto: r.coberto,
  }));
}

export type OpenTotals = { total: number; count: number };

/**
 * Total a RECEBER em aberto (mensalidades não pagas), separado entre
 * vencidas (atrasado) e a vencer (pendente), usando o status efetivo.
 */
export async function getReceivablesOpen(tx: Tx): Promise<{ overdue: OpenTotals; upcoming: OpenTotals }> {
  const { rows } = await tx.execute<{ bucket: string; total: number; count: number }>(
    sql`select effective_status as bucket, coalesce(sum(amount),0) as total, count(*)::int as count
        from public.invoices_with_effective_status
        where paid_date is null and effective_status in ('atrasado','pendente')
        group by effective_status`
  );
  const pick = (b: string) => {
    const r = rows.find((x) => x.bucket === b);
    return { total: Number(r?.total ?? 0), count: Number(r?.count ?? 0) };
  };
  return { overdue: pick("atrasado"), upcoming: pick("pendente") };
}

/** Total a PAGAR em aberto (contas a pagar não pagas), vencidas e a vencer. */
export async function getPayablesOpen(tx: Tx): Promise<{ overdue: OpenTotals; upcoming: OpenTotals }> {
  const { rows } = await tx.execute<{ bucket: string; total: number; count: number }>(
    sql`select effective_status as bucket, coalesce(sum(amount),0) as total, count(*)::int as count
        from public.payables_with_effective_status
        where paid_date is null and effective_status in ('atrasado','pendente')
        group by effective_status`
  );
  const pick = (b: string) => {
    const r = rows.find((x) => x.bucket === b);
    return { total: Number(r?.total ?? 0), count: Number(r?.count ?? 0) };
  };
  return { overdue: pick("atrasado"), upcoming: pick("pendente") };
}

export type PayableRow = {
  id: string;
  description: string;
  category_name: string | null;
  reference_month: string;
  amount: number;
  due_date: string;
  paid_date: string | null;
  effective_status: string;
  origin: string;
};

/** Lista de contas a pagar de um mês de competência. */
export async function listPayables(tx: Tx, referenceMonth: string): Promise<PayableRow[]> {
  const { rows } = await tx.execute<PayableRow>(
    sql`select p.id, p.description, cc.name as category_name, p.reference_month::text,
               p.amount, p.due_date::text, p.paid_date::text, p.effective_status, p.origin
        from public.payables_with_effective_status p
        left join public.cost_categories cc on cc.id = p.category_id
        where p.reference_month = ${referenceMonth}::date
        order by p.due_date, p.description`
  );
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

export type ReceivableRow = {
  id: string;
  student_name: string;
  reference_month: string;
  amount: number;
  due_date: string;
  paid_date: string | null;
  effective_status: string;
};

/** Mensalidades a receber de um mês (todas, com status efetivo). */
export async function listReceivables(tx: Tx, referenceMonth: string): Promise<ReceivableRow[]> {
  const { rows } = await tx.execute<ReceivableRow>(
    sql`select i.id, s.full_name as student_name, i.reference_month::text,
               i.amount, i.due_date::text, i.paid_date::text, i.effective_status
        from public.invoices_with_effective_status i
        join public.enrollments e on e.id = i.enrollment_id
        join public.students s on s.id = e.student_id
        where i.reference_month = ${referenceMonth}::date
        order by i.effective_status, i.due_date, s.full_name`
  );
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

export type JobRun = {
  id: string;
  trigger: string;
  status: string;
  result: Record<string, unknown> | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

export async function listJobRuns(tx: Tx, limit = 10): Promise<JobRun[]> {
  const { rows } = await tx.execute<JobRun>(
    sql`select id, trigger, status, result, error, started_at::text, finished_at::text
        from public.job_runs
        where job = 'monthly_rollover'
        order by started_at desc
        limit ${limit}`
  );
  return rows;
}

export type AppSettingsMap = Record<string, unknown>;

export async function getAppSettings(tx: Tx): Promise<AppSettingsMap> {
  const { rows } = await tx.execute<{ key: string; value: unknown }>(
    sql`select key, value from public.app_settings`
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/**
 * Rede de segurança: roda a virada no máximo UMA vez por dia, de forma
 * oportunista, quando alguém abre o app. Garante que mensalidades/DAS/contas
 * recorrentes existam mesmo que o agendador do SO não esteja configurado.
 * Barato: se já rodou hoje (qualquer gatilho), não faz nada.
 */
export async function ensureRolloverToday(tx: Tx): Promise<void> {
  const { rows } = await tx.execute<{ ran: boolean }>(
    sql`select exists(
          select 1 from public.job_runs
          where job = 'monthly_rollover'
            and status in ('success','running')
            and started_at >= date_trunc('day', now())
        ) as ran`
  );
  if (rows[0]?.ran) return;
  await tx.execute(sql`select public.run_monthly_rollover('startup')`);
}
