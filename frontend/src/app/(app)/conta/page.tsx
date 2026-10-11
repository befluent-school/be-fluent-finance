import { and, eq, isNull } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { withSystem } from "@/lib/db";
import { mfaBackupCodes } from "@/lib/db/schema";
import { UpdatePasswordForm } from "./update-password-form";
import { RegenerateBackupCodesForm } from "./regenerate-backup-codes-form";

const ROLE_LABEL = { owner: "Owner", socio: "Sócio", funcionario: "Funcionário" } as const;

export default async function ContaPage() {
  const user = await requireUser();

  const unusedBackupCodes = await withSystem(async (tx) => {
    const rows = await tx
      .select({ id: mfaBackupCodes.id })
      .from(mfaBackupCodes)
      .where(and(eq(mfaBackupCodes.userId, user.id), isNull(mfaBackupCodes.usedAt)));
    return rows.length;
  });

  return (
    <div>
      <p className="text-sm text-ink-300">Dados de acesso da sua conta.</p>

      <div className="mt-6 card-premium rounded-lg p-6">
        <h2 className="text-lg font-semibold text-ink-50">Dados</h2>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between border-b border-ink-700/70 pb-2">
            <dt className="text-ink-300">Nome</dt>
            <dd className="text-ink-50">{user.fullName}</dd>
          </div>
          <div className="flex justify-between border-b border-ink-700/70 pb-2">
            <dt className="text-ink-300">E-mail</dt>
            <dd className="text-ink-50">{user.email}</dd>
          </div>
          <div className="flex justify-between pb-2">
            <dt className="text-ink-300">Papel</dt>
            <dd className="text-ink-50">{ROLE_LABEL[user.role]}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-lg font-semibold text-ink-50">Alterar senha</h2>
          <p className="mt-1 text-xs text-ink-500">
            Ao trocar a senha, as outras sessões abertas (outros computadores/navegadores) são
            encerradas.
          </p>
          <div className="mt-3 card-premium max-w-sm rounded-lg p-6">
            <UpdatePasswordForm />
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-ink-50">Códigos de backup do 2FA</h2>
          <p className="mt-1 text-xs text-ink-500">
            Você tem {unusedBackupCodes} código(s) não usado(s). Gerar novos invalida todos os
            anteriores.
          </p>
          <div className="mt-3 card-premium max-w-sm rounded-lg p-6">
            <RegenerateBackupCodesForm />
          </div>
        </div>
      </div>
    </div>
  );
}
