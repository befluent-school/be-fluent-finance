import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { env, secureCookies } from "@/lib/env";
import { withSystem, withUser, type Tx } from "@/lib/db";
import { permissions, profiles, rolePermissions, sessions, users } from "@/lib/db/schema";
import { assertSameOrigin, requestInfo } from "@/lib/request";
import { randomToken, sha256 } from "./tokens";
import type { Policy } from "./policies";

/**
 * Sessão própria em cookie HttpOnly (substitui o Supabase Auth).
 *
 * - O cookie leva um token aleatório de 256 bits; o banco guarda só o SHA-256.
 * - Login em duas etapas: após a senha a sessão fica "pendente" (15 min, sem
 *   acesso a dados) até o código TOTP; ao concluir o 2FA o token é trocado
 *   (evita fixação de sessão) e passa a valer a expiração normal.
 * - Expiração deslizante (SESSION_IDLE_HOURS sem uso) com teto absoluto
 *   (SESSION_MAX_DAYS). Logout e troca/redefinição de senha revogam no banco.
 */

const PENDING_SESSION_MINUTES = 15;
/** Renova a validade no máximo a cada 5 min (evita uma escrita por request). */
const TOUCH_EVERY_MS = 5 * 60_000;

export function sessionCookieName(): string {
  // Prefixo __Host- (exige Secure, Path=/ e sem Domain): o cookie não pode
  // ser sobrescrito por subdomínios.
  return secureCookies() ? "__Host-financeiro_session" : "financeiro_session";
}

export type Role = "owner" | "socio" | "funcionario";

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  permissions: string[];
  sessionId: string;
};

export type SessionState =
  | { status: "none" }
  /** Senha conferida, falta o 2FA (desafio, ou cadastro se ainda não tem autenticador). */
  | { status: "mfa_pending"; sessionId: string; userId: string; email: string; totpEnabled: boolean }
  /** 2FA concluído com código de backup: precisa cadastrar um autenticador novo. */
  | { status: "enroll_required"; sessionId: string; userId: string; email: string }
  | { status: "active"; user: SessionUser };

async function setSessionCookie(token: string, expiresAt: Date) {
  const store = await cookies();
  store.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete({ name: sessionCookieName(), path: "/", secure: secureCookies(), httpOnly: true, sameSite: "lax" });
}

async function readSessionToken(): Promise<string | null> {
  const token = (await cookies()).get(sessionCookieName())?.value;
  return token && token.length <= 100 ? token : null;
}

/** Cria a sessão pendente (pré-2FA) e grava o cookie. Chamar só de Server Actions. */
export async function createPendingSession(tx: Tx, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const { ip, userAgent } = await requestInfo();
  const token = randomToken();
  const expiresAt = new Date(Date.now() + PENDING_SESSION_MINUTES * 60_000);
  await tx.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    expiresAt: expiresAt.toISOString(),
    absoluteExpiresAt: expiresAt.toISOString(),
    ipAddress: ip,
    userAgent,
  });
  return { token, expiresAt };
}

export async function writeSessionCookie(token: string, expiresAt: Date) {
  await setSessionCookie(token, expiresAt);
}

/**
 * Conclui o 2FA: troca o token (o antigo deixa de valer), marca a sessão
 * como verificada e aplica a validade normal. Grava o cookie novo.
 */
export async function promoteSession(tx: Tx, sessionId: string): Promise<void> {
  const e = env();
  const token = randomToken();
  const now = Date.now();
  const absolute = new Date(now + e.SESSION_MAX_DAYS * 86_400_000);
  const idle = new Date(Math.min(now + e.SESSION_IDLE_HOURS * 3_600_000, absolute.getTime()));
  await tx
    .update(sessions)
    .set({
      tokenHash: sha256(token),
      mfaVerifiedAt: new Date(now).toISOString(),
      mfaFailedAttempts: 0,
      enrollCodeHash: null,
      enrollCodeExpiresAt: null,
      lastUsedAt: new Date(now).toISOString(),
      expiresAt: idle.toISOString(),
      absoluteExpiresAt: absolute.toISOString(),
    })
    .where(eq(sessions.id, sessionId));
  await setSessionCookie(token, absolute);
}

export async function revokeSessionById(tx: Tx, sessionId: string) {
  await tx.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Encerra todas as sessões do usuário (troca/redefinição de senha), opcionalmente mantendo a atual. */
export async function revokeAllSessions(tx: Tx, userId: string, exceptSessionId?: string) {
  await tx
    .delete(sessions)
    .where(exceptSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId)) : eq(sessions.userId, userId));
}

/**
 * Lê e valida a sessão do cookie (uma vez por request, via React cache).
 * Não grava cookie — pode ser usada em Server Components.
 */
export const loadSession = cache(async (): Promise<SessionState> => {
  const token = await readSessionToken();
  if (!token) return { status: "none" };

  const found = await withSystem(async (tx) => {
    const [row] = await tx
      .select({
        sessionId: sessions.id,
        userId: sessions.userId,
        mfaVerifiedAt: sessions.mfaVerifiedAt,
        lastUsedAt: sessions.lastUsedAt,
        absoluteExpiresAt: sessions.absoluteExpiresAt,
        email: users.email,
        totpEnabledAt: users.totpEnabledAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, sha256(token)),
          gt(sessions.expiresAt, sql`now()`),
          gt(sessions.absoluteExpiresAt, sql`now()`)
        )
      );
    if (!row) return null;

    if (row.mfaVerifiedAt && Date.now() - new Date(row.lastUsedAt).getTime() > TOUCH_EVERY_MS) {
      await tx
        .update(sessions)
        .set({
          lastUsedAt: sql`now()`,
          expiresAt: sql`least(now() + make_interval(hours => ${env().SESSION_IDLE_HOURS}), ${sessions.absoluteExpiresAt})`,
        })
        .where(eq(sessions.id, row.sessionId));
    }
    return row;
  });

  if (!found) return { status: "none" };

  if (!found.mfaVerifiedAt) {
    return {
      status: "mfa_pending",
      sessionId: found.sessionId,
      userId: found.userId,
      email: found.email,
      totpEnabled: Boolean(found.totpEnabledAt),
    };
  }

  const profile = await withUser(found.userId, async (tx) => {
    const [p] = await tx
      .select({ fullName: profiles.fullName, role: profiles.role, active: profiles.active })
      .from(profiles)
      .where(eq(profiles.id, found.userId));
    if (!p || !p.active) return null;
    const perms = await tx
      .select({ code: permissions.code })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.role, p.role));
    return { ...p, permissions: perms.map((x) => x.code) };
  });

  // Profile desativado ou inexistente: sessão não dá acesso a nada.
  if (!profile) return { status: "none" };

  if (!found.totpEnabledAt) {
    return { status: "enroll_required", sessionId: found.sessionId, userId: found.userId, email: found.email };
  }

  return {
    status: "active",
    user: {
      id: found.userId,
      email: found.email,
      fullName: profile.fullName,
      role: profile.role,
      permissions: profile.permissions,
      sessionId: found.sessionId,
    },
  };
});

/** Para páginas: exige sessão completa (senha + 2FA); senão redireciona. */
export async function requireUser(policy?: Policy): Promise<SessionUser> {
  const state = await loadSession();
  if (state.status === "none") redirect("/login");
  if (state.status !== "active") redirect("/onboarding/2fa-setup");
  if (policy && !policy.check(state.user)) redirect("/dashboard");
  return state.user;
}

/**
 * Para Server Actions: confere a origem (CSRF), exige sessão completa e
 * aplica a política de acesso. Retorna null quando o usuário está logado
 * mas não tem permissão — a action deve devolver uma mensagem de erro.
 * Sem sessão, redireciona para o login.
 */
export async function getActionUser(policy?: Policy): Promise<SessionUser | null> {
  await assertSameOrigin();
  const state = await loadSession();
  if (state.status === "none") redirect("/login");
  if (state.status !== "active") redirect("/onboarding/2fa-setup");
  if (policy && !policy.check(state.user)) return null;
  return state.user;
}

export const FORBIDDEN_MESSAGE = "Você não tem permissão para esta operação.";
