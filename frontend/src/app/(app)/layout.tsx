import { requireUser } from "@/lib/auth/session";
import { Sidebar } from "@/components/sidebar";
import { TopbarClient } from "@/components/topbar-client";
import { withUser } from "@/lib/db";
import { ensureRolloverToday } from "@/lib/queries/finance";
import { ensureBankSyncRecent } from "@/lib/bank/sync";
import { AbelhaWidget } from "@/components/abelha/abelha-widget";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Cada página e cada Server Action também exigem sessão por conta própria
  // (layouts e páginas renderizam em paralelo — o layout sozinho não protege).
  const user = await requireUser();

  // Rede de segurança da automação: tenta rodar a virada do mês no máximo uma
  // vez por dia, sem bloquear a renderização e sem nunca quebrar a tela se
  // falhar (o agendador do SO continua sendo o caminho principal). Só para
  // papéis que podem escrever nas tabelas financeiras (owner/socio); o RLS
  // barraria os demais de qualquer forma.
  if (user.role === "owner" || user.role === "socio") {
    void withUser(user.id, (tx) => ensureRolloverToday(tx)).catch(() => {});
    // Sincronização bancária oportunista (APIs externas): em transação própria
    // para não atrasar nem derrubar a virada se um banco estiver lento/fora.
    void withUser(user.id, (tx) => ensureBankSyncRecent(tx)).catch(() => {});
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar role={user.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopbarClient userName={user.fullName} />
        <main className="relative z-10 flex-1 p-4 md:p-8">{children}</main>
      </div>
      {(user.role === "owner" || user.role === "socio") && <AbelhaWidget />}
    </div>
  );
}
