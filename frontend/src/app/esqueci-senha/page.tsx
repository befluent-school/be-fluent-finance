import { AuthShell } from "@/components/auth-shell";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function EsqueciSenhaPage() {
  return (
    <AuthShell title="Esqueci a senha" subtitle="Enviaremos um link para o seu e-mail.">
      <ForgotPasswordForm />
    </AuthShell>
  );
}
