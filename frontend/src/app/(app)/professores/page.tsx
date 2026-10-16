import { todayBR } from "@/lib/dates";
import Link from "next/link";
import { formatCurrencyBRL } from "@shared/finance";
import { requireUser } from "@/lib/auth/session";
import { Policies } from "@/lib/auth/policies";
import { withUser, sequential } from "@/lib/db";
import { listPayrollForMonth, getPayrollTotals, type PaymentType } from "@/lib/queries/payroll";
import { parseYearMonth } from "@/lib/validation";
import { KpiCard } from "@/components/ui/kpi-card";
import { NewTeacherForm } from "./new-teacher-form";
import { PayrollRowEditor } from "./payroll-row-editor";

export const PAYMENT_TYPE_LABEL: Record<PaymentType, string> = {
  por_hora: "Por hora/aula",
  comissao: "Comissão (%)",
  repasse_integral: "Repasse integral",
  fixo: "Valor fixo",
  outro: "Outro (manual)",
};

function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

export default async function ProfessoresPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const user = await requireUser();
  const canManage = Policies.ownerOrSocio.check(user);

  const { mes } = await searchParams;
  const currentMonth = todayBR().slice(0, 7);
  const selectedMonth = parseYearMonth(mes, currentMonth);
  const referenceMonth = `${selectedMonth}-01`;

  const { rows, totals } = await withUser(user.id, async (tx) => {
    const [rows, totals] = await sequential([
      () => listPayrollForMonth(tx, referenceMonth),
      () => getPayrollTotals(tx, referenceMonth),
    ]);
    return { rows, totals };
  });

  const mesLabel = new Date(`${referenceMonth}T00:00:00Z`).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-ink-50">Professores e Folha de Pagamento</h1>
          <p className="text-sm text-ink-300">
            Cadastro dos professores e cálculo mensal do quanto pagar, pelas aulas efetivamente dadas.
          </p>
        </div>
        {canManage && <NewTeacherForm />}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Professores ativos"
          value={String(rows.length)}
          hint="Cadastrados e ativos"
          explanation="Total de professores ativos. Inativos não aparecem na folha nem na importação de alunos."
        />
        <KpiCard
          label="Folha confirmada no mês"
          value={formatCurrencyBRL(totals.confirmado)}
          hint="Já virou conta a pagar"
          explanation="Soma das folhas confirmadas deste mês — cada uma gerou uma conta a pagar na categoria Pagamento Professores."
          tone="negative"
        />
        <KpiCard
          label="Folha em aberto no mês"
          value={formatCurrencyBRL(totals.aberto)}
          hint="Preenchida, aguardando confirmação"
          explanation="Soma das folhas salvas mas ainda não confirmadas. Confirme para gerar a conta a pagar."
          tone="neutral"
        />
      </div>

      <div className="mt-8 flex items-center gap-3">
        <Link
          href={`/professores?mes=${addMonths(selectedMonth, -1)}`}
          className="rounded-md px-2 py-1 text-sm text-ink-300 hover:bg-white/[0.05] hover:text-ink-50"
        >
          ‹
        </Link>
        <p className="text-sm capitalize text-ink-300">{mesLabel}</p>
        <Link
          href={`/professores?mes=${addMonths(selectedMonth, 1)}`}
          className="rounded-md px-2 py-1 text-sm text-ink-300 hover:bg-white/[0.05] hover:text-ink-50"
        >
          ›
        </Link>
      </div>

      <div className="mt-4 card-premium overflow-x-auto rounded-md">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-700 bg-white/[0.03] text-left text-xs text-ink-300">
              <th className="px-4 py-3 font-medium">Professor</th>
              <th className="px-4 py-3 font-medium">Regra</th>
              <th className="px-4 py-3 font-medium">Aulas dadas</th>
              <th className="px-4 py-3 font-medium">Sugerido</th>
              <th className="px-4 py-3 font-medium">A pagar</th>
              <th className="px-4 py-3 font-medium">Status</th>
              {canManage && <th className="px-4 py-3 font-medium text-right">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={canManage ? 7 : 6} className="px-4 py-6 text-center text-ink-500">
                  Nenhum professor ativo. Cadastre o primeiro acima.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <PayrollRowEditor
                key={r.teacher_id}
                row={r}
                referenceMonth={referenceMonth}
                canManage={canManage}
                paymentTypeLabel={PAYMENT_TYPE_LABEL[r.payment_type]}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-ink-500">
        O valor <strong>Sugerido</strong> vem da regra do professor (por hora = aulas × valor/hora; fixo = valor do
        mês). Comissão e repasse dependem da receita dos alunos e entram como valor manual. Ajuste <strong>A pagar</strong>{" "}
        quando houver faltas ou remarcações e confirme para lançar em Contas a Pagar.
      </p>
    </div>
  );
}
