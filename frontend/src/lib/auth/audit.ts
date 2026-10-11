import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";

export type AuthEvent =
  | "auth.login_failed"
  | "auth.login_blocked"
  | "auth.password_ok"
  | "auth.mfa_ok"
  | "auth.mfa_failed"
  | "auth.mfa_enrolled"
  | "auth.mfa_enroll_code_sent"
  | "auth.backup_code_used"
  | "auth.backup_codes_regenerated"
  | "auth.logout"
  | "auth.password_changed"
  | "auth.password_reset_requested"
  | "auth.password_reset_done"
  | "auth.session_revoked";

/**
 * Registra um evento de autenticação no audit_log (via função SECURITY
 * DEFINER no banco — o papel da aplicação não grava direto na tabela).
 * As alterações de dados são auditadas automaticamente por trigger.
 */
export async function auditAuth(tx: Tx, userId: string | null, action: AuthEvent, details: Record<string, unknown> = {}) {
  await tx.execute(sql`select app.audit_event(${userId}::uuid, ${action}, ${JSON.stringify(details)}::jsonb)`);
}
