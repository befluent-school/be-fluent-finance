"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  Receipt,
  Wallet,
  Landmark,
  Contact,
  Package,
  Target,
  CalendarCheck,
  type LucideIcon,
} from "lucide-react";
import { logout } from "@/app/actions/auth";
import { Logo } from "@/components/logo";

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/alunos", label: "Alunos", icon: Users },
  { href: "/mensalidades", label: "Mensalidades", icon: Receipt },
  { href: "/fluxo-de-caixa", label: "Fluxo de Caixa", icon: Wallet },
  { href: "/banco/conciliacao", label: "Conciliação Bancária", icon: Landmark },
  { href: "/crm", label: "CRM", icon: Contact },
  { href: "/planos", label: "Planos", icon: Package },
  { href: "/metas", label: "Metas", icon: Target },
  { href: "/tarefas", label: "Tarefas", icon: CalendarCheck },
];

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-1 overflow-y-auto p-3">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
              active
                ? "bg-gradient-to-r from-amber-500/20 to-amber-500/5 text-amber-300 ring-1 ring-inset ring-amber-500/20"
                : "text-ink-300 hover:bg-white/[0.05] hover:text-ink-50"
            }`}
          >
            {active && (
              <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-amber-500 shadow-[0_0_10px_var(--amber-500)]" />
            )}
            <Icon className="size-4.5 shrink-0 transition-transform group-hover:scale-110" />
            <span className="flex-1">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function PlanCard({ role }: { role: string }) {
  return (
    <div className="p-3">
      <div className="card-premium block rounded-xl p-4">
        <div className="flex items-center gap-2">
          <p className="font-display text-sm font-semibold text-ink-50">Be Fluent</p>
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400 uppercase">
            {role}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-ink-500">Gestão financeira e administrativa</p>
      </div>
    </div>
  );
}

export function Sidebar({ role }: { role: string }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Barra superior mobile */}
      <div className="flex items-center justify-between border-b border-ink-700 bg-ink-900 px-4 py-3 md:hidden">
        <Logo className="scale-90" />
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir menu"
          className="rounded-md p-2 text-ink-100 hover:bg-white/5"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex h-full w-64 flex-col border-r border-ink-700 bg-ink-900">
            <div className="flex h-16 items-center justify-between border-b border-ink-700 px-5">
              <Logo />
              <button onClick={() => setMobileOpen(false)} aria-label="Fechar menu" className="p-1 text-ink-100">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M2 2l14 14M16 2L2 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            <PlanCard role={role} />
            <form action={logout} className="px-3 pb-6">
              <button
                type="submit"
                className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-ink-500 transition hover:bg-white/5 hover:text-ink-50"
              >
                Sair
              </button>
            </form>
          </aside>
        </div>
      )}

      {/* Sidebar desktop */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-ink-700 bg-ink-900 md:flex">
        <div className="flex h-16 items-center border-b border-ink-700 px-5">
          <Logo />
        </div>

        <NavLinks pathname={pathname} />
        <PlanCard role={role} />

        <form action={logout} className="px-3 pb-6">
          <button
            type="submit"
            className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-ink-500 transition hover:bg-white/5 hover:text-ink-50"
          >
            Sair
          </button>
        </form>
      </aside>
    </>
  );
}
