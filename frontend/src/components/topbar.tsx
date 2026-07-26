import Link from "next/link";
import { initials } from "@/lib/utils";

export const ROUTE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/alunos": "Alunos",
  "/mensalidades": "Mensalidades",
  "/fluxo-de-caixa": "Fluxo de Caixa",
  "/banco/conciliacao": "Conciliação Bancária",
  "/crm": "CRM",
  "/planos": "Planos",
  "/metas": "Metas",
  "/tarefas": "Tarefas",
  "/conta": "Minha Conta",
};

export function titleFromPathname(pathname: string): string {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];
  const match = Object.keys(ROUTE_TITLES).find((route) => pathname.startsWith(`${route}/`));
  return match ? ROUTE_TITLES[match] : "Be Fluent";
}

export function Topbar({ title, userName }: { title: string; userName: string }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-ink-700 bg-ink-900/80 px-4 backdrop-blur sm:px-6">
      <h1 className="font-display text-lg font-bold text-ink-50">{title}</h1>
      <div className="ml-auto flex items-center gap-3">
        <Link
          href="/conta"
          title="Minha conta"
          className="flex size-9 items-center justify-center rounded-full bg-amber-500/15 text-xs font-semibold text-amber-400 transition hover:bg-amber-500/25"
        >
          {initials(userName)}
        </Link>
      </div>
    </header>
  );
}
