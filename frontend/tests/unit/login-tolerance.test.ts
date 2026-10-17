import { describe, expect, it } from "vitest";
import { hashPassword, passwordCandidates, verifyPassword } from "@/lib/auth/password";
import { generateTotpSecret, hotp, currentStep, base32Decode, verifyTotp } from "@/lib/auth/totp";

describe("login tolerante ao celular", () => {
  it("aceita a senha com espaço sobrando ou acento em outra codificação", async () => {
    const stored = await hashPassword("Café-Fluent#2026");
    const ok = async (typed: string) => {
      for (const c of passwordCandidates(typed)) if (await verifyPassword(c, stored)) return true;
      return false;
    };
    expect(await ok("Café-Fluent#2026 ")).toBe(true);
    expect(await ok("Café-Fluent#2026")).toBe(true); // é decomposto (NFD)
    expect(await ok("cafe-fluent#2026")).toBe(false);
  });

  it("aceita o código 2FA com espaço no meio", () => {
    const secret = generateTotpSecret();
    const code = hotp(base32Decode(secret), currentStep());
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, null)).not.toBeNull();
  });
});
