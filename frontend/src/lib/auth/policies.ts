/**
 * Autorização no código — a mesma matriz que as policies de RLS do banco
 * aplicam (db/migrations). As duas camadas são independentes de propósito:
 * se uma falhar, a outra ainda barra.
 *
 * | Recurso                                   | owner | socio | funcionario |
 * |-------------------------------------------|-------|-------|-------------|
 * | Ler alunos, mensalidades, caixa, metas... |  sim  |  sim  |    sim      |
 * | Alunos, matrículas, mensalidades, caixa   | permissão `manage_invoices` (seed: os 3 papéis) |
 * | Planos, professores, categorias, metas    |  sim  |  sim  |    não      |
 * | Conciliação / importação de extrato       |  sim  |  sim  |    não      |
 * | Lucro líquido (dashboard)                 |  sim  |  não  |    não      |
 * | Tarefas                                   |  sim  |  sim  |    sim      |
 */
export type PolicyUser = { role: "owner" | "socio" | "funcionario"; permissions: string[] };

export type Policy = { name: string; check: (user: PolicyUser) => boolean };

const policy = (name: string, check: Policy["check"]): Policy => ({ name, check });

export const Policies = {
  authenticated: policy("authenticated", () => true),
  owner: policy("owner", (u) => u.role === "owner"),
  ownerOrSocio: policy("ownerOrSocio", (u) => u.role === "owner" || u.role === "socio"),
  manageInvoices: policy("manageInvoices", (u) => u.permissions.includes("manage_invoices")),
  /** Lucro líquido é só do owner (o seed dá view_net_profit só ao owner). */
  viewNetProfit: policy("viewNetProfit", (u) => u.role === "owner"),
  /**
   * Contas a pagar, impostos (Simples/DAS), configurações e automação de
   * virada: owner/socio. Espelha o RLS owner_or_socio dessas tabelas.
   */
  manageFinance: policy("manageFinance", (u) => u.role === "owner" || u.role === "socio"),
} as const;
