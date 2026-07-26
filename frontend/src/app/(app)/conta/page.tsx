import { createClient } from "@/lib/supabase/server";
import { UpdatePasswordForm } from "./update-password-form";

export default async function ContaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const provider = user?.app_metadata?.provider ?? "email";

  return (
    <div>
      <p className="text-sm text-ink-300">Dados de acesso da sua conta.</p>

      <div className="mt-6 card-premium rounded-lg p-6">
        <h2 className="text-lg font-semibold text-ink-50">Dados</h2>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between border-b border-ink-700/70 pb-2">
            <dt className="text-ink-300">E-mail</dt>
            <dd className="text-ink-50">{user?.email}</dd>
          </div>
          <div className="flex justify-between pb-2">
            <dt className="text-ink-300">Login via</dt>
            <dd className="text-ink-50 capitalize">
              {provider === "google" ? "Google" : "E-mail e senha"}
            </dd>
          </div>
        </dl>
      </div>

      <h2 className="mt-8 text-lg font-semibold text-ink-50">Alterar senha</h2>
      <p className="mt-1 text-xs text-ink-500">
        {provider === "google"
          ? "Você entra hoje com o Google. Definir uma senha aqui permite entrar também com e-mail e senha."
          : "Escolha uma nova senha para acessar o sistema."}
      </p>
      <div className="mt-3 card-premium max-w-sm rounded-lg p-6">
        <UpdatePasswordForm />
      </div>
    </div>
  );
}
