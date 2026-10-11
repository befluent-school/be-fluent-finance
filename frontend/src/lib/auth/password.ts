import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

/**
 * Hash de senha com scrypt (nativo do Node), mesmo formato do BeeFlow:
 * scrypt$<logN>$<r>$<p>$<salt b64>$<hash b64> — os parâmetros ficam no
 * próprio hash para permitir endurecer o custo no futuro.
 *
 * Usuários migrados do Supabase chegam com bcrypt ($2a$/$2b$/$2y$): a
 * verificação aceita esse formato e o login regrava em scrypt
 * (`needsRehash`).
 */
const LOG_N = 15;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const DUMMY_SALT = randomBytes(16);

export const PASSWORD_MIN_LENGTH = 10;

function derive(password: string, salt: Buffer, logN: number, r: number, p: number): Promise<Buffer> {
  const N = 2 ** logN;
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LEN, { N, r, p, maxmem: 256 * N * r }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, LOG_N, R, P);
  return ["scrypt", LOG_N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

function isBcrypt(stored: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(stored);
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    // Mesmo custo quando o usuário não existe/não tem senha, para não revelar
    // pelo tempo de resposta quais e-mails estão cadastrados.
    await derive(password, DUMMY_SALT, LOG_N, R, P);
    return false;
  }
  if (isBcrypt(stored)) {
    // bcrypt considera só os primeiros 72 bytes; senhas maiores nunca
    // existiram no Supabase (limite do GoTrue), então não há ambiguidade.
    return bcrypt.compare(password, stored);
  }
  const [alg, logN, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !logN || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), Number(logN), Number(r), Number(p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** true se o hash guardado deve ser regravado no formato/custo atual. */
export function needsRehash(stored: string): boolean {
  if (isBcrypt(stored)) return true;
  const [alg, logN, r, p] = stored.split("$");
  return alg !== "scrypt" || Number(logN) < LOG_N || Number(r) !== R || Number(p) !== P;
}

const COMMON_PASSWORDS = new Set([
  "1234567890",
  "12345678910",
  "123456789a",
  "0123456789",
  "qwertyuiop",
  "password123",
  "senha12345",
  "senha123456",
  "befluent123",
  "befluent2026",
  "financeiro123",
]);

/** Regra mínima: comprimento + não estar na lista óbvia. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `A senha deve ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  }
  if (password.length > 200) return "Senha longa demais.";
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return "Essa senha é muito comum. Escolha outra.";
  if (email && password.toLowerCase().includes(email.split("@")[0].toLowerCase())) {
    return "A senha não pode conter o seu e-mail.";
  }
  return null;
}
