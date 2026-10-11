import "server-only";
import { encrypt, decrypt } from "@/lib/auth/tokens";
import { env } from "@/lib/env";
import type { ProviderCredentials } from "./types";

/**
 * Credenciais bancárias são cifradas com AES-256-GCM usando uma subchave
 * derivada do APP_SECRET (mesma primitiva dos segredos de 2FA). O banco só
 * guarda o texto cifrado em bank_providers.credentials_enc; o claro só existe
 * em memória do servidor na hora de chamar a API do banco.
 */

const PURPOSE = "bank-credentials";

export function encryptCredentials(creds: ProviderCredentials): string {
  return encrypt(env().APP_SECRET, PURPOSE, JSON.stringify(creds));
}

export function decryptCredentials(payload: string | null): ProviderCredentials {
  if (!payload) return {};
  try {
    const json = decrypt(env().APP_SECRET, PURPOSE, payload);
    const obj = JSON.parse(json);
    return obj && typeof obj === "object" ? (obj as ProviderCredentials) : {};
  } catch {
    // Credencial ilegível (APP_SECRET trocado, dado corrompido): trata como
    // "sem credencial" em vez de quebrar — a tela mostrará "reconfigurar".
    return {};
  }
}

/** Mascara um segredo para exibição ("••••1234"). Nunca devolve o valor. */
export function maskSecret(value: string | undefined): string {
  if (!value) return "";
  const tail = value.slice(-4);
  return `••••${tail}`;
}
