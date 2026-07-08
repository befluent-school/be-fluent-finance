type Health = "saudavel" | "atencao" | "critico";

function getHealth(ratio: number): Health {
  if (ratio > 3) return "saudavel";
  if (ratio >= 1.5) return "atencao";
  return "critico";
}

const HEALTH_COPY: Record<Health, { label: string; text: string; bg: string }> = {
  saudavel: { label: "Saudável", text: "text-status-paid", bg: "bg-status-paid-bg" },
  atencao: { label: "Atenção", text: "text-status-pending", bg: "bg-status-pending-bg" },
  critico: { label: "Crítico", text: "text-status-overdue", bg: "bg-status-overdue-bg" },
};

export function LtvCacHealth({
  ltv,
  cac,
  minRatioTarget,
}: {
  ltv: number;
  cac: number;
  minRatioTarget?: number;
}) {
  const ratio = cac > 0 ? ltv / cac : 0;
  const health = getHealth(ratio);
  const copy = HEALTH_COPY[health];
  const belowTarget = minRatioTarget != null && ratio < minRatioTarget;

  return (
    <div className={`card-premium animate-rise rounded-lg p-6 ${copy.bg}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">
        Relação LTV:CAC
      </p>
      <p className={`font-display mt-2 text-3xl font-bold ${copy.text}`}>{copy.label}</p>
      <p className="font-tabular mt-1 text-sm text-ink-300">
        {ratio.toFixed(1)}:1
        {minRatioTarget != null && (
          <span className="text-ink-500"> / meta mín. {minRatioTarget.toFixed(1)}:1</span>
        )}
      </p>
      <p className="mt-3 text-xs leading-relaxed text-ink-300">
        Para cada R$1 gasto para trazer um aluno, ele gera{" "}
        <strong className="text-ink-50">R${ratio.toFixed(2)}</strong> ao longo do
        contrato.
        {belowTarget && (
          <span className="mt-1 block text-status-overdue">Abaixo da meta mínima definida.</span>
        )}
      </p>
    </div>
  );
}
