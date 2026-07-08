import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TotpEnroll } from "./totp-enroll";
import { TotpChallenge } from "./totp-challenge";

export default async function TwoFactorSetupPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const verifiedFactor = factorsData?.totp.find((f) => f.status === "verified");

  // Remove fatores TOTP não verificados de tentativas anteriores de enrollment
  // (ex: usuário fechou a página no meio do processo) para evitar o erro
  // "friendly name already exists" ao gerar um novo QR code.
  if (!verifiedFactor) {
    const pendingFactors = factorsData?.all.filter(
      (f) => f.factor_type === "totp" && f.status === "unverified"
    );
    for (const factor of pendingFactors ?? []) {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink-950 px-4">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500/[0.07] blur-[120px]" />

      <div className="card-premium relative w-full max-w-md rounded-lg p-8 shadow-[var(--shadow-elevated)]">
        <div className="mb-1 h-1 w-10 rounded-full bg-gradient-to-r from-amber-600 to-amber-400" />
        <h1 className="font-display text-2xl font-bold text-ink-50">
          Autenticação em duas etapas
        </h1>
        <p className="mt-1 text-sm text-ink-300">
          Obrigatória para acessar a plataforma Be Fluent.
        </p>

        {verifiedFactor ? <TotpChallenge factorId={verifiedFactor.id} /> : <TotpEnroll />}
      </div>
    </main>
  );
}
