"use server";

import { randomBytes, createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type EnrollResult = {
  factorId: string;
  qrCode: string; // SVG data URI
  secret: string; // fallback para digitação manual no app autenticador
};

export async function startTotpEnrollment(): Promise<EnrollResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Be Fluent",
  });

  if (error || !data || data.type !== "totp") {
    throw new Error(error?.message ?? "Não foi possível iniciar o cadastro do 2FA.");
  }

  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, () =>
    randomBytes(5).toString("hex").toUpperCase().match(/.{1,5}/g)!.join("-")
  );
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export type VerifyEnrollmentState = { error?: string; backupCodes?: string[] } | undefined;

export async function verifyTotpEnrollment(
  _state: VerifyEnrollmentState,
  formData: FormData
): Promise<VerifyEnrollmentState> {
  const factorId = String(formData.get("factorId"));
  const code = String(formData.get("code"));

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });

  if (error) {
    return { error: "Código inválido. Confira o app autenticador e tente novamente." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  const backupCodes = generateBackupCodes();
  const { error: insertError } = await supabase.from("mfa_backup_codes").insert(
    backupCodes.map((code) => ({ user_id: user.id, code_hash: hashCode(code) }))
  );

  if (insertError) {
    return { error: "2FA ativado, mas houve um erro ao gerar os códigos de backup." };
  }

  return { backupCodes };
}

export type ChallengeState = { error?: string } | undefined;

export async function verifyTotpChallenge(
  _state: ChallengeState,
  formData: FormData
): Promise<ChallengeState> {
  const factorId = String(formData.get("factorId"));
  const code = String(formData.get("code"));

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });

  if (error) {
    return { error: "Código inválido." };
  }

  redirect("/dashboard");
}

export async function verifyBackupCode(
  _state: ChallengeState,
  formData: FormData
): Promise<ChallengeState> {
  const code = String(formData.get("code")).trim().toUpperCase();
  const factorId = String(formData.get("factorId"));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  const hash = hashCode(code);
  const { data: match } = await supabase
    .from("mfa_backup_codes")
    .select("id")
    .eq("user_id", user.id)
    .eq("code_hash", hash)
    .is("used_at", null)
    .maybeSingle();

  if (!match) {
    return { error: "Código de backup inválido ou já utilizado." };
  }

  await supabase
    .from("mfa_backup_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", match.id);

  // Um código de backup não é um fator TOTP e não eleva a sessão para AAL2
  // no Supabase. Por segurança, desativamos o autenticador perdido e
  // forçamos o recadastro de um novo (o proxy manda para o onboarding).
  await supabase.auth.mfa.unenroll({ factorId });

  redirect("/onboarding/2fa-setup");
}
