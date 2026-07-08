const STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pago: { bg: "bg-status-paid-bg", text: "text-status-paid", label: "Pago" },
  atrasado: { bg: "bg-status-overdue-bg", text: "text-status-overdue", label: "Atrasado" },
  pendente: { bg: "bg-status-pending-bg", text: "text-status-pending", label: "Pendente" },
  active: { bg: "bg-status-paid-bg", text: "text-status-paid", label: "Ativo" },
  paused: { bg: "bg-status-pending-bg", text: "text-status-pending", label: "Pausado" },
  cancelled: { bg: "bg-status-overdue-bg", text: "text-status-overdue", label: "Cancelado" },
};

export function StatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? { bg: "bg-ink-800", text: "text-ink-300", label: status };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-medium ${style.bg} ${style.text}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {style.label}
    </span>
  );
}
