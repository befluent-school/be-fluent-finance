import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, hotp, otpauthUri, verifyTotp } from "@/lib/auth/totp";

// RFC 6238, apêndice B: segredo ASCII "12345678901234567890" (SHA-1), 8 dígitos.
const RFC_SECRET = Buffer.from("12345678901234567890");
const RFC_VECTORS: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("TOTP (RFC 6238)", () => {
  it.each(RFC_VECTORS)("t=%i → %s", (seconds, expected) => {
    expect(hotp(RFC_SECRET, Math.floor(seconds / 30), 8)).toBe(expected);
  });

  it("base32 ida e volta", () => {
    const buf = Buffer.from("12345678901234567890");
    expect(base32Encode(buf)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").equals(buf)).toBe(true);
  });

  it("segredo novo tem 160 bits", () => {
    expect(base32Decode(generateTotpSecret())).toHaveLength(20);
  });

  it("aceita o código atual e ±1 passo, recusa fora da janela", () => {
    const secret = base32Encode(RFC_SECRET);
    const now = 1_234_567_890_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(secret, hotp(RFC_SECRET, step), null, now)).toBe(step);
    expect(verifyTotp(secret, hotp(RFC_SECRET, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(secret, hotp(RFC_SECRET, step + 1), null, now)).toBe(step + 1);
    expect(verifyTotp(secret, hotp(RFC_SECRET, step - 2), null, now)).toBeNull();
  });

  it("não aceita o mesmo código duas vezes (replay)", () => {
    const secret = base32Encode(RFC_SECRET);
    const now = 1_234_567_890_000;
    const step = Math.floor(now / 30_000);
    const code = hotp(RFC_SECRET, step);
    expect(verifyTotp(secret, code, step, now)).toBeNull();
    expect(verifyTotp(secret, code, step - 1, now)).toBe(step);
  });

  it("rejeita formato inválido", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, "12345", null)).toBeNull();
    expect(verifyTotp(secret, "abcdef", null)).toBeNull();
    expect(verifyTotp(secret, "1234567", null)).toBeNull();
  });

  it("monta a URI otpauth com issuer", () => {
    const uri = otpauthUri("ABC", "ana@befluent.com.br");
    expect(uri).toMatch(/^otpauth:\/\/totp\/Be%20Fluent%20Financeiro%3Aana%40befluent\.com\.br\?/);
    expect(uri).toContain("secret=ABC");
    expect(uri).toContain("digits=6");
  });
});
