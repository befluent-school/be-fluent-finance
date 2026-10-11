import { redirect } from "next/navigation";
import { loadSession } from "@/lib/auth/session";
import { logout } from "@/app/actions/auth";
import { AuthShell } from "@/components/auth-shell";
import { TotpEnroll } from "./totp-enroll";
import { TotpChallenge } from "./totp-challenge";

export default async function TwoFactorSetupPage() {
  const state = await loadSession();

  if (state.status === "none") redirect("/login");
  if (state.status === "active") redirect("/dashboard");

  const showChallenge = state.status === "mfa_pending" && state.totpEnabled;

  return (
    <AuthShell
      title="Autenticação em duas etapas"
      subtitle="Obrigatória para acessar a plataforma Be Fluent."
      wide
    >
      {showChallenge ? <TotpChallenge /> : <TotpEnroll />}

      <form action={logout} className="mt-6 text-center">
        <button type="submit" className="text-xs text-ink-500 underline hover:text-ink-300">
          Sair e entrar com outra conta
        </button>
      </form>
    </AuthShell>
  );
}
