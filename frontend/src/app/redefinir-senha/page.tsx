import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { ResetPasswordForm } from "./reset-password-form";

export default async function RedefinirSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <AuthShell title="Nova senha" subtitle="Escolha uma senha nova para a sua conta.">
      {token && token.length <= 100 ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="mt-8 space-y-4 text-sm">
          <p className="text-status-overdue">Link inválido ou incompleto.</p>
          <Link href="/esqueci-senha" className="text-ink-300 underline hover:text-ink-50">
            Pedir um novo link
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
