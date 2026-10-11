import { redirect } from "next/navigation";
import { loadSession } from "@/lib/auth/session";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "./login-form";

const NOTICES: Record<string, { tone: "ok" | "error"; text: string }> = {
  redefinida: { tone: "ok", text: "Senha redefinida. Entre com a nova senha." },
  tentativas: { tone: "error", text: "Muitas tentativas de código. Entre novamente." },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ senha?: string; erro?: string }>;
}) {
  const { senha, erro } = await searchParams;
  const state = await loadSession();
  if (state.status === "active") redirect("/dashboard");
  if (state.status !== "none") redirect("/onboarding/2fa-setup");

  return (
    <AuthShell title="Be Fluent" subtitle="Gestão financeira e administrativa">
      <LoginForm notice={NOTICES[senha ?? ""] ?? NOTICES[erro ?? ""]} />
    </AuthShell>
  );
}
