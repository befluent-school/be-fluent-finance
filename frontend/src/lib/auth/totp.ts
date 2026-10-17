import { createHmac, randomBytes } from "node:crypto";

/**
 * TOTP (RFC 6238) com HMAC-SHA1, 6 dígitos e passo de 30 s — o padrão que
 * Google Authenticator, Authy, 1Password etc. entendem. Implementação
 * própria (poucas linhas, testada com os vetores da RFC em
 * tests/totp.test.ts) para não depender de biblioteca externa no fator
 * mais sensível do login.
 */
const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32.indexOf(char);
    if (idx === -1) throw new Error("Segredo base32 inválido");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Segredo novo de 160 bits (recomendação da RFC 4226), em base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number, digits = DIGITS, algorithm: "sha1" | "sha256" | "sha512" = "sha1"): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, secret).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, "0");
}

export function currentStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

/**
 * Confere o código aceitando 1 passo de tolerância para cada lado (relógio
 * do celular adiantado/atrasado). Retorna o passo aceito — que deve ser
 * guardado e usado como `lastStep` na próxima verificação, para que o
 * mesmo código não seja aceito duas vezes — ou null.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  lastStep: number | null,
  nowMs = Date.now()
): number | null {
  code = code.replace(/\s/g, ""); // "123 456" colado do autenticador
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const now = currentStep(nowMs);
  let matched: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    // Compara todos os passos (sem sair cedo) para tempo constante.
    if (hotp(secret, step) === code && (lastStep === null || step > lastStep)) matched = step;
  }
  return matched;
}

export function otpauthUri(secretBase32: string, accountEmail: string, issuer = "Be Fluent Financeiro"): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
