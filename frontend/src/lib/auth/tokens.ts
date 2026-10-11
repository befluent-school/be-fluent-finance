import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/** Token aleatório (256 bits) para cookies de sessão e links enviados por e-mail. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/** O banco guarda só o hash: um vazamento do banco não entrega sessões nem links válidos. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function subKey(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "financeiro", purpose, 32));
}

/** HMAC com chave derivada do APP_SECRET (ex.: códigos de backup do 2FA). */
export function hmac(secret: string, purpose: string, value: string): string {
  return createHmac("sha256", subKey(secret, `hmac:${purpose}`)).update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** AES-256-GCM: formato v1.<iv b64url>.<tag b64url>.<dados b64url>. */
export function encrypt(secret: string, purpose: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", subKey(secret, `enc:${purpose}`), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(secret: string, purpose: string, payload: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Formato cifrado inválido");
  const decipher = createDecipheriv("aes-256-gcm", subKey(secret, `enc:${purpose}`), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** Código curto legível (sem 0/O/1/I), ex. para códigos de backup. */
export function readableCode(length: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
