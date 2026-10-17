"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { env } from "@/lib/env";
import { withSystem } from "@/lib/db";
import { passwordResetTokens, profiles, users } from "@/lib/db/schema";
import { assertSameOrigin, requestInfo } from "@/lib/request";
import { emailLayout, sendMail } from "@/lib/mailer";
import { hashPassword, needsRehash, passwordCandidates, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { randomToken, sha256 } from "@/lib/auth/tokens";
import { isRateLimited, recordAttempt } from "@/lib/auth/rate-limit";
import { auditAuth } from "@/lib/auth/audit";
import {
  clearSessionCookie,
  createPendingSession,
  getActionUser,
  loadSession,
  revokeAllSessions,
  revokeSessionById,
  writeSessionCookie,
} from "@/lib/auth/session";

/** Bloqueio temporário da conta após falhas seguidas de senha. */
const LOCK_AFTER_FAILURES = 10;
const LOCK_MINUTES = 15;
const RESET_TOKEN_MINUTES = 60;

const GENERIC_LOGIN_ERROR = "E-mail ou senha incorretos.";
const RATE_LIMIT_ERROR = "Muitas tentativas. Aguarde alguns minutos e tente novamente.";

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const LoginSchema = z.object({
  email: z.email({ error: "Informe um e-mail válido." }).max(254),
  password: z.string().min(1, { error: "Informe a senha." }).max(200),
});

export type LoginState =
  | { errors?: { email?: string[]; password?: string[] }; message?: string }
  | undefined;

export async function login(_state: LoginState, formData: FormData): Promise<LoginState> {
  await assertSameOrigin();
  const validated = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!validated.success) {
    return { errors: validated.error.flatten().fieldErrors };
  }

  const email = normalizeEmail(validated.data.email);
  const { password } = validated.data;
  const { ip } = await requestInfo();

  const result = await withSystem(async (tx) => {
    if (await isRateLimited(tx, "login", email, ip)) {
      await auditAuth(tx, null, "auth.login_blocked", { email, ip, reason: "rate_limit" });
      return { ok: false as const, message: RATE_LIMIT_ERROR };
    }

    const [user] = await tx.select().from(users).where(eq(users.email, email));
    // Sempre roda a verificação (mesmo sem usuário) para o tempo de resposta não revelar e-mails cadastrados.
    let matchedPassword: string | null = null;
    for (const candidate of passwordCandidates(password)) {
      if (await verifyPassword(candidate, user?.passwordHash)) {
        matchedPassword = candidate;
        break;
      }
    }
    const passwordOk = matchedPassword !== null;
    const locked = Boolean(user?.lockedUntil && new Date(user.lockedUntil) > new Date());

    if (!user || !passwordOk || locked) {
      await recordAttempt(tx, "login", email, ip, false);
      if (user && !locked) {
        const failures = user.failedLoginCount + 1;
        await tx
          .update(users)
          .set({
            failedLoginCount: failures,
            lockedUntil: failures >= LOCK_AFTER_FAILURES ? sql`now() + make_interval(mins => ${LOCK_MINUTES})` : null,
          })
          .where(eq(users.id, user.id));
      }
      await auditAuth(tx, user?.id ?? null, locked ? "auth.login_blocked" : "auth.login_failed", {
        email,
        ip,
        reason: locked ? "locked" : "invalid_credentials",
      });
      return { ok: false as const, message: locked ? RATE_LIMIT_ERROR : GENERIC_LOGIN_ERROR };
    }

    // Senha conferida: a partir daqui agimos como o próprio usuário para ler o profile (RLS).
    await tx.execute(sql`select set_config('app.user_id', ${user.id}, true)`);
    const [profile] = await tx
      .select({ active: profiles.active })
      .from(profiles)
      .where(eq(profiles.id, user.id));
    if (!profile?.active) {
      await recordAttempt(tx, "login", email, ip, false);
      await auditAuth(tx, user.id, "auth.login_failed", { email, ip, reason: "inactive_profile" });
      return { ok: false as const, message: GENERIC_LOGIN_ERROR };
    }

    await tx
      .update(users)
      .set({
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: sql`now()`,
        // Hash legado (bcrypt do Supabase) ou com custo antigo: regrava em scrypt.
        ...(user.passwordHash && needsRehash(user.passwordHash)
          ? { passwordHash: await hashPassword(matchedPassword ?? password) }
          : {}),
      })
      .where(eq(users.id, user.id));
    await recordAttempt(tx, "login", email, ip, true);
    await auditAuth(tx, user.id, "auth.password_ok", { ip });
    const session = await createPendingSession(tx, user.id);
    return { ok: true as const, session };
  });

  if (!result.ok) return { message: result.message };

  await writeSessionCookie(result.session.token, result.session.expiresAt);
  // Próxima etapa: código do autenticador (ou cadastro do 2FA).
  redirect("/onboarding/2fa-setup");
}

export async function logout() {
  await assertSameOrigin();
  const state = await loadSession();
  if (state.status !== "none") {
    const sessionId = state.status === "active" ? state.user.sessionId : state.sessionId;
    const userId = state.status === "active" ? state.user.id : state.userId;
    await withSystem(async (tx) => {
      await revokeSessionById(tx, sessionId);
      await auditAuth(tx, userId, "auth.logout");
    });
  }
  await clearSessionCookie();
  redirect("/login");
}

const UpdatePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, { error: "Informe a senha atual." }).max(200),
    password: z.string().max(200),
    confirmPassword: z.string().max(200),
  })
  .refine((data) => data.password === data.confirmPassword, {
    error: "As senhas não coincidem.",
    path: ["confirmPassword"],
  });

export type UpdatePasswordState =
  | {
      errors?: { currentPassword?: string[]; password?: string[]; confirmPassword?: string[] };
      message?: string;
      success?: boolean;
    }
  | undefined;

export async function updatePassword(
  _state: UpdatePasswordState,
  formData: FormData
): Promise<UpdatePasswordState> {
  const user = await getActionUser();
  if (!user) return { message: "Sessão inválida." };

  const validated = UpdatePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!validated.success) {
    return { errors: validated.error.flatten().fieldErrors };
  }
  const problem = passwordProblem(validated.data.password, user.email);
  if (problem) return { errors: { password: [problem] } };

  const { ip } = await requestInfo();
  return withSystem(async (tx) => {
    if (await isRateLimited(tx, "login", user.email, ip)) return { message: RATE_LIMIT_ERROR };
    const [row] = await tx.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id));
    if (!(await verifyPassword(validated.data.currentPassword, row?.passwordHash))) {
      await recordAttempt(tx, "login", user.email, ip, false);
      return { errors: { currentPassword: ["Senha atual incorreta."] } };
    }
    await tx
      .update(users)
      .set({ passwordHash: await hashPassword(validated.data.password), passwordChangedAt: sql`now()` })
      .where(eq(users.id, user.id));
    // Encerra as outras sessões (ex.: um computador esquecido logado); mantém a atual.
    await revokeAllSessions(tx, user.id, user.sessionId);
    await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
    await auditAuth(tx, user.id, "auth.password_changed", { ip });
    return { success: true, message: "Senha alterada. As outras sessões abertas foram encerradas." };
  });
}

// ── Recuperação de senha por e-mail (link de uso único) ────────────────────

export type ForgotPasswordState = { message?: string; error?: string } | undefined;

const FORGOT_MESSAGE =
  "Se o e-mail estiver cadastrado, enviamos um link para redefinir a senha. Ele vale por 1 hora.";

export async function requestPasswordReset(
  _state: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  await assertSameOrigin();
  const parsed = z.email().max(254).safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Informe um e-mail válido." };
  const email = normalizeEmail(parsed.data);
  const { ip } = await requestInfo();

  const mail = await withSystem(async (tx) => {
    if (await isRateLimited(tx, "password_reset", email, ip)) return null;
    await recordAttempt(tx, "password_reset", email, ip, true);

    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (!user) return null;
    await tx.execute(sql`select set_config('app.user_id', ${user.id}, true)`);
    const [profile] = await tx.select({ active: profiles.active }).from(profiles).where(eq(profiles.id, user.id));
    if (!profile?.active) return null;

    // Só o link mais recente vale.
    await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
    const token = randomToken();
    await tx.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000).toISOString(),
      requestedIp: ip,
    });
    await auditAuth(tx, user.id, "auth.password_reset_requested", { ip });
    return { token };
  });

  if (mail) {
    const url = `${env().NEXT_PUBLIC_APP_URL}/redefinir-senha?token=${encodeURIComponent(mail.token)}`;
    try {
      await sendMail({
        to: email,
        subject: "Redefinição de senha — Be Fluent Financeiro",
        text: `Recebemos um pedido para redefinir a sua senha.\n\nAbra o link abaixo (válido por 1 hora, uso único):\n${url}\n\nSe não foi você, ignore este e-mail — sua senha continua a mesma.`,
        html: emailLayout({
          title: "Redefinir senha",
          paragraphs: ["Recebemos um pedido para redefinir a sua senha. O link vale por 1 hora e só pode ser usado uma vez."],
          action: { label: "Definir nova senha", url },
          footnote: "Se não foi você, ignore este e-mail — sua senha continua a mesma.",
        }),
      });
    } catch (err) {
      console.error("[auth] falha ao enviar e-mail de redefinição:", err instanceof Error ? err.message : err);
    }
  }

  // Mesma resposta exista ou não a conta (não revela e-mails cadastrados).
  return { message: FORGOT_MESSAGE };
}

const ResetPasswordSchema = z
  .object({
    token: z.string().min(20).max(100),
    password: z.string().max(200),
    confirmPassword: z.string().max(200),
  })
  .refine((data) => data.password === data.confirmPassword, {
    error: "As senhas não coincidem.",
    path: ["confirmPassword"],
  });

export type ResetPasswordState =
  | { errors?: { password?: string[]; confirmPassword?: string[] }; message?: string }
  | undefined;

export async function resetPassword(
  _state: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  await assertSameOrigin();
  const validated = ResetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!validated.success) {
    const fieldErrors = validated.error.flatten().fieldErrors;
    if (fieldErrors.token) return { message: "Link inválido ou expirado. Peça um novo." };
    return { errors: fieldErrors };
  }
  const { ip } = await requestInfo();

  const tokenHash = sha256(validated.data.token);
  const validToken = and(
    eq(passwordResetTokens.tokenHash, tokenHash),
    isNull(passwordResetTokens.usedAt),
    gt(passwordResetTokens.expiresAt, sql`now()`)
  );

  const outcome = await withSystem(async (tx) => {
    const [pending] = await tx
      .select({ email: users.email })
      .from(passwordResetTokens)
      .innerJoin(users, eq(users.id, passwordResetTokens.userId))
      .where(validToken);
    if (!pending) return { error: "Link inválido ou expirado. Peça um novo." };

    // Senha fraca não consome o link: o usuário pode tentar outra.
    const problem = passwordProblem(validated.data.password, pending.email);
    if (problem) return { passwordError: problem };

    // Consome o token atomicamente: um segundo uso (ou corrida) não encontra a linha.
    const [consumed] = await tx
      .update(passwordResetTokens)
      .set({ usedAt: sql`now()` })
      .where(validToken)
      .returning({ userId: passwordResetTokens.userId });
    if (!consumed) return { error: "Link inválido ou expirado. Peça um novo." };

    await tx
      .update(users)
      .set({
        passwordHash: await hashPassword(validated.data.password),
        passwordChangedAt: sql`now()`,
        failedLoginCount: 0,
        lockedUntil: null,
        // O link de uso único prova acesso ao canal privado (e-mail ou envio do
        // owner): o cadastro do 2FA nos próximos 30 min dispensa o código por e-mail.
        enrollPreverifiedUntil: sql`now() + interval '30 minutes'`,
      })
      .where(eq(users.id, consumed.userId));
    await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, consumed.userId));
    // Quem tinha a senha antiga perde o acesso imediatamente.
    await revokeAllSessions(tx, consumed.userId);
    await auditAuth(tx, consumed.userId, "auth.password_reset_done", { ip });
    return { ok: true };
  });

  if ("error" in outcome) return { message: outcome.error };
  if ("passwordError" in outcome) return { errors: { password: [outcome.passwordError ?? ""] } };

  await clearSessionCookie();
  redirect("/login?senha=redefinida");
}
