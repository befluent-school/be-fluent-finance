"use server";

import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { env } from "@/lib/env";
import { withSystem, type Tx } from "@/lib/db";
import { mfaBackupCodes, sessions, users } from "@/lib/db/schema";
import { assertSameOrigin, requestInfo } from "@/lib/request";
import { emailLayout, sendMail } from "@/lib/mailer";
import { decrypt, encrypt, hmac, readableCode, safeEqual } from "@/lib/auth/tokens";
import { generateTotpSecret, otpauthUri, verifyTotp } from "@/lib/auth/totp";
import { isRateLimited, recordAttempt } from "@/lib/auth/rate-limit";
import { auditAuth } from "@/lib/auth/audit";
import {
  clearSessionCookie,
  getActionUser,
  loadSession,
  promoteSession,
  revokeSessionById,
} from "@/lib/auth/session";

/** Tentativas erradas de código (2FA ou do e-mail) por sessão antes de derrubá-la. */
const MAX_ATTEMPTS_PER_SESSION = 5;
const ENROLL_CODE_MINUTES = 15;
const ENROLL_CODE_RESEND_SECONDS = 60;
const BACKUP_CODE_COUNT = 10;

const secret = () => env().APP_SECRET;
const hashBackupCode = (code: string) => hmac(secret(), "backup-code", normalizeCode(code));
const hashEnrollCode = (code: string) => hmac(secret(), "enroll-code", normalizeCode(code));
const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

function newBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const raw = readableCode(10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

async function storeBackupCodes(tx: Tx, userId: string): Promise<string[]> {
  const codes = newBackupCodes();
  await tx.delete(mfaBackupCodes).where(eq(mfaBackupCodes.userId, userId));
  await tx.insert(mfaBackupCodes).values(codes.map((code) => ({ userId, codeHash: hashBackupCode(code) })));
  return codes;
}

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}${"•".repeat(Math.max(1, name.length - 2))}@${domain}`;
}

/**
 * Sessão que pode cadastrar autenticador: pendente sem TOTP (exige código do
 * e-mail, salvo se a senha acabou de ser definida por link de uso único —
 * migration 0022) ou já verificada por código de backup.
 */
async function enrollmentContext() {
  const state = await loadSession();
  if (state.status === "mfa_pending" && !state.totpEnabled) {
    const preverified = await withSystem(async (tx) => {
      const [row] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, state.userId), gt(users.enrollPreverifiedUntil, sql`now()`)));
      return Boolean(row);
    });
    return { sessionId: state.sessionId, userId: state.userId, email: state.email, needsEmailCode: !preverified };
  }
  if (state.status === "enroll_required") {
    return { sessionId: state.sessionId, userId: state.userId, email: state.email, needsEmailCode: false };
  }
  return null;
}

/** Conta uma tentativa errada; ao atingir o limite a sessão é encerrada. */
async function registerSessionFailure(tx: Tx, sessionId: string): Promise<boolean> {
  const [row] = await tx
    .update(sessions)
    .set({ mfaFailedAttempts: sql`${sessions.mfaFailedAttempts} + 1` })
    .where(eq(sessions.id, sessionId))
    .returning({ attempts: sessions.mfaFailedAttempts });
  if (!row || row.attempts >= MAX_ATTEMPTS_PER_SESSION) {
    await revokeSessionById(tx, sessionId);
    return true;
  }
  return false;
}

// ── Cadastro do autenticador ───────────────────────────────────────────────

export type EnrollResult =
  | {
      qrCode: string; // data URI (PNG)
      secret: string; // para digitação manual no app autenticador
      emailCodeRequired: boolean;
      maskedEmail: string;
    }
  | { error: string };

/**
 * Gera um segredo TOTP novo (guardado cifrado, ainda inativo) e, se a
 * sessão ainda não passou por um 2FA, envia o código de confirmação ao
 * e-mail da conta. Recusa se o usuário já tem autenticador ativo — um
 * segredo ativo nunca é sobrescrito por uma sessão que só conhece a senha.
 */
export async function startTotpEnrollment(): Promise<EnrollResult> {
  await assertSameOrigin();
  const ctx = await enrollmentContext();
  if (!ctx) return { error: "Sessão expirada. Faça login novamente." };

  const totpSecret = generateTotpSecret();
  const emailCode = ctx.needsEmailCode ? readableCode(8) : null;

  const sendCode = await withSystem(async (tx) => {
    const [updated] = await tx
      .update(users)
      .set({ totpSecretEnc: encrypt(secret(), "totp", totpSecret), totpLastStep: null })
      .where(and(eq(users.id, ctx.userId), isNull(users.totpEnabledAt)))
      .returning({ id: users.id });
    if (!updated) return "already_enabled" as const;

    if (!emailCode) return false;
    // Reenvio no máximo a cada 60 s (recarregar a página não dispara e-mails em série).
    const [session] = await tx
      .update(sessions)
      .set({
        enrollCodeHash: hashEnrollCode(emailCode),
        enrollCodeExpiresAt: new Date(Date.now() + ENROLL_CODE_MINUTES * 60_000).toISOString(),
      })
      .where(
        and(
          eq(sessions.id, ctx.sessionId),
          or(
            isNull(sessions.enrollCodeExpiresAt),
            lt(
              sessions.enrollCodeExpiresAt,
              sql`now() + make_interval(secs => ${ENROLL_CODE_MINUTES * 60 - ENROLL_CODE_RESEND_SECONDS})`
            )
          )
        )
      )
      .returning({ id: sessions.id });
    if (session) await auditAuth(tx, ctx.userId, "auth.mfa_enroll_code_sent");
    return Boolean(session);
  });

  if (sendCode === "already_enabled") return { error: "Este usuário já tem autenticador. Faça login novamente." };

  if (sendCode && emailCode) {
    const formatted = `${emailCode.slice(0, 4)}-${emailCode.slice(4)}`;
    try {
      await sendMail({
        to: ctx.email,
        subject: "Código para ativar o 2FA — Be Fluent Financeiro",
        text: `Seu código para ativar a autenticação em duas etapas é: ${formatted}\nEle vale por ${ENROLL_CODE_MINUTES} minutos.\n\nSe não foi você, troque sua senha imediatamente.`,
        html: emailLayout({
          title: "Ativar autenticação em duas etapas",
          paragraphs: [`Use o código abaixo para confirmar o cadastro do autenticador. Ele vale por ${ENROLL_CODE_MINUTES} minutos.`],
          code: formatted,
          footnote: "Se não foi você, alguém sabe a sua senha: troque-a imediatamente.",
        }),
      });
    } catch (err) {
      console.error("[mfa] falha ao enviar código de cadastro:", err instanceof Error ? err.message : err);
      return { error: "Não foi possível enviar o código por e-mail. Tente novamente em instantes." };
    }
  }

  const qrCode = await QRCode.toDataURL(otpauthUri(totpSecret, ctx.email), { margin: 1, width: 220 });
  return { qrCode, secret: totpSecret, emailCodeRequired: ctx.needsEmailCode, maskedEmail: maskEmail(ctx.email) };
}

export type VerifyEnrollmentState = { error?: string; backupCodes?: string[] } | undefined;

export async function verifyTotpEnrollment(
  _state: VerifyEnrollmentState,
  formData: FormData
): Promise<VerifyEnrollmentState> {
  await assertSameOrigin();
  const ctx = await enrollmentContext();
  if (!ctx) redirect("/login");

  const code = String(formData.get("code") ?? "").trim();
  const emailCode = String(formData.get("emailCode") ?? "");
  const { ip } = await requestInfo();

  const result = await withSystem(async (tx) => {
    if (await isRateLimited(tx, "mfa", ctx.userId, ip)) return { error: "Muitas tentativas. Aguarde alguns minutos." };

    const [row] = await tx
      .select({
        totpSecretEnc: users.totpSecretEnc,
        totpEnabledAt: users.totpEnabledAt,
        enrollCodeHash: sessions.enrollCodeHash,
        enrollCodeExpiresAt: sessions.enrollCodeExpiresAt,
      })
      .from(users)
      .innerJoin(sessions, eq(sessions.userId, users.id))
      .where(and(eq(users.id, ctx.userId), eq(sessions.id, ctx.sessionId)));
    if (!row?.totpSecretEnc || row.totpEnabledAt) return { error: "Recarregue a página para gerar um novo QR Code." };

    const emailOk =
      !ctx.needsEmailCode ||
      Boolean(
        row.enrollCodeHash &&
          row.enrollCodeExpiresAt &&
          new Date(row.enrollCodeExpiresAt) > new Date() &&
          safeEqual(row.enrollCodeHash, hashEnrollCode(emailCode))
      );
    const step = verifyTotp(decrypt(secret(), "totp", row.totpSecretEnc), code, null);

    if (!emailOk || step === null) {
      await recordAttempt(tx, "mfa", ctx.userId, ip, false);
      await auditAuth(tx, ctx.userId, "auth.mfa_failed", { ip, stage: "enroll", emailOk, totpOk: step !== null });
      const killed = await registerSessionFailure(tx, ctx.sessionId);
      if (killed) return { killed: true };
      return {
        error: !emailOk
          ? "Código do e-mail inválido ou expirado."
          : "Código do autenticador inválido. Confira o app e tente novamente.",
      };
    }

    await tx
      .update(users)
      .set({ totpEnabledAt: sql`now()`, totpLastStep: step, enrollPreverifiedUntil: null })
      .where(eq(users.id, ctx.userId));
    const backupCodes = await storeBackupCodes(tx, ctx.userId);
    await recordAttempt(tx, "mfa", ctx.userId, ip, true);
    await auditAuth(tx, ctx.userId, "auth.mfa_enrolled", { ip });
    // Marca a sessão como verificada, mas só troca o token/cookie em
    // finishEnrollment: gravar cookie aqui faria o Next re-renderizar a
    // página (e redirecionar) antes de o usuário ver os códigos de backup.
    await tx.update(sessions).set({ mfaVerifiedAt: sql`now()` }).where(eq(sessions.id, ctx.sessionId));
    return { backupCodes };
  });

  if ("killed" in result) {
    await clearSessionCookie();
    redirect("/login?erro=tentativas");
  }
  return result;
}

/** Botão "Já guardei meus códigos": troca o token da sessão e aplica a validade normal. */
export async function finishEnrollment() {
  await assertSameOrigin();
  const state = await loadSession();
  if (state.status !== "active") redirect("/onboarding/2fa-setup");
  await withSystem((tx) => promoteSession(tx, state.user.sessionId));
  redirect("/dashboard");
}

// ── Desafio no login ───────────────────────────────────────────────────────

export type ChallengeState = { error?: string } | undefined;

async function challengeContext() {
  const state = await loadSession();
  if (state.status === "mfa_pending" && state.totpEnabled) return state;
  return null;
}

export async function verifyTotpChallenge(
  _state: ChallengeState,
  formData: FormData
): Promise<ChallengeState> {
  await assertSameOrigin();
  const ctx = await challengeContext();
  if (!ctx) redirect("/login");

  const code = String(formData.get("code") ?? "").trim();
  const { ip } = await requestInfo();

  const result = await withSystem(async (tx) => {
    if (await isRateLimited(tx, "mfa", ctx.userId, ip)) return { error: "Muitas tentativas. Aguarde alguns minutos." };

    const [user] = await tx
      .select({ totpSecretEnc: users.totpSecretEnc, totpLastStep: users.totpLastStep })
      .from(users)
      .where(eq(users.id, ctx.userId));
    const step = user?.totpSecretEnc ? verifyTotp(decrypt(secret(), "totp", user.totpSecretEnc), code, user.totpLastStep) : null;

    // Grava o passo usado de forma atômica: o mesmo código não vale duas vezes, nem em requisições simultâneas.
    const accepted =
      step !== null &&
      (
        await tx
          .update(users)
          .set({ totpLastStep: step })
          .where(and(eq(users.id, ctx.userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
          .returning({ id: users.id })
      ).length > 0;

    if (!accepted) {
      await recordAttempt(tx, "mfa", ctx.userId, ip, false);
      await auditAuth(tx, ctx.userId, "auth.mfa_failed", { ip, stage: "challenge" });
      if (await registerSessionFailure(tx, ctx.sessionId)) return { killed: true };
      return { error: "Código inválido." };
    }

    await recordAttempt(tx, "mfa", ctx.userId, ip, true);
    await auditAuth(tx, ctx.userId, "auth.mfa_ok", { ip, method: "totp" });
    await promoteSession(tx, ctx.sessionId);
    return { ok: true };
  });

  if ("killed" in result) {
    await clearSessionCookie();
    redirect("/login?erro=tentativas");
  }
  if ("error" in result) return { error: result.error };
  redirect("/dashboard");
}

/**
 * Código de backup: conclui o login uma única vez e desativa o
 * autenticador atual (provavelmente perdido) — o usuário é levado a
 * cadastrar um novo antes de acessar qualquer dado.
 */
export async function verifyBackupCode(
  _state: ChallengeState,
  formData: FormData
): Promise<ChallengeState> {
  await assertSameOrigin();
  const ctx = await challengeContext();
  if (!ctx) redirect("/login");

  const code = String(formData.get("code") ?? "");
  const { ip } = await requestInfo();

  const result = await withSystem(async (tx) => {
    if (await isRateLimited(tx, "mfa", ctx.userId, ip)) return { error: "Muitas tentativas. Aguarde alguns minutos." };

    const [used] = await tx
      .update(mfaBackupCodes)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(mfaBackupCodes.userId, ctx.userId),
          eq(mfaBackupCodes.codeHash, hashBackupCode(code)),
          isNull(mfaBackupCodes.usedAt)
        )
      )
      .returning({ id: mfaBackupCodes.id });

    if (!used) {
      await recordAttempt(tx, "mfa", ctx.userId, ip, false);
      await auditAuth(tx, ctx.userId, "auth.mfa_failed", { ip, stage: "backup_code" });
      if (await registerSessionFailure(tx, ctx.sessionId)) return { killed: true };
      return { error: "Código de backup inválido ou já utilizado." };
    }

    await tx
      .update(users)
      .set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null })
      .where(eq(users.id, ctx.userId));
    await tx.delete(mfaBackupCodes).where(eq(mfaBackupCodes.userId, ctx.userId));
    await recordAttempt(tx, "mfa", ctx.userId, ip, true);
    await auditAuth(tx, ctx.userId, "auth.backup_code_used", { ip });
    await promoteSession(tx, ctx.sessionId);
    return { ok: true };
  });

  if ("killed" in result) {
    await clearSessionCookie();
    redirect("/login?erro=tentativas");
  }
  if ("error" in result) return { error: result.error };
  redirect("/onboarding/2fa-setup");
}

// ── Minha conta: novos códigos de backup ───────────────────────────────────

export type RegenerateBackupState = { error?: string; backupCodes?: string[] } | undefined;

/** Gera um conjunto novo de códigos (invalida os anteriores). Exige um código atual do autenticador. */
export async function regenerateBackupCodes(
  _state: RegenerateBackupState,
  formData: FormData
): Promise<RegenerateBackupState> {
  const user = await getActionUser();
  if (!user) return { error: "Sessão inválida." };
  const code = String(formData.get("code") ?? "").trim();
  const { ip } = await requestInfo();

  return withSystem(async (tx) => {
    if (await isRateLimited(tx, "mfa", user.id, ip)) return { error: "Muitas tentativas. Aguarde alguns minutos." };
    const [row] = await tx
      .select({ totpSecretEnc: users.totpSecretEnc, totpLastStep: users.totpLastStep })
      .from(users)
      .where(eq(users.id, user.id));
    const step = row?.totpSecretEnc ? verifyTotp(decrypt(secret(), "totp", row.totpSecretEnc), code, row.totpLastStep) : null;
    const accepted =
      step !== null &&
      (
        await tx
          .update(users)
          .set({ totpLastStep: step })
          .where(and(eq(users.id, user.id), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
          .returning({ id: users.id })
      ).length > 0;
    if (!accepted) {
      await recordAttempt(tx, "mfa", user.id, ip, false);
      return { error: "Código do autenticador inválido." };
    }
    await recordAttempt(tx, "mfa", user.id, ip, true);
    const backupCodes = await storeBackupCodes(tx, user.id);
    await auditAuth(tx, user.id, "auth.backup_codes_regenerated", { ip });
    return { backupCodes };
  });
}
