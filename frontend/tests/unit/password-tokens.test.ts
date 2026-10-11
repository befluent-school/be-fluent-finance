import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { decrypt, encrypt, hmac, readableCode, safeEqual, sha256 } from "@/lib/auth/tokens";
import { isAllowedOrigin } from "@/lib/request-rules";
import { Policies } from "@/lib/auth/policies";
import { isoDate, parseYearMonth } from "@/lib/validation";

describe("senhas", () => {
  it("scrypt: confere a senha certa e recusa a errada", async () => {
    const hash = await hashPassword("uma senha bem longa");
    expect(hash.startsWith("scrypt$15$8$1$")).toBe(true);
    expect(await verifyPassword("uma senha bem longa", hash)).toBe(true);
    expect(await verifyPassword("outra senha qualquer", hash)).toBe(false);
    expect(needsRehash(hash)).toBe(false);
  });

  it("aceita bcrypt legado do Supabase ($2a$) e pede regravação", async () => {
    const legacy = bcrypt.hashSync("senha-do-supabase", 10).replace(/^\$2b\$/, "$2a$");
    expect(legacy.startsWith("$2a$10$")).toBe(true);
    expect(await verifyPassword("senha-do-supabase", legacy)).toBe(true);
    expect(await verifyPassword("senha-errada", legacy)).toBe(false);
    expect(needsRehash(legacy)).toBe(true);
  });

  it("usuário sem senha nunca autentica", async () => {
    expect(await verifyPassword("qualquer", null)).toBe(false);
    expect(await verifyPassword("qualquer", "")).toBe(false);
    expect(await verifyPassword("qualquer", "lixo$sem$formato")).toBe(false);
  });

  it("regras mínimas de senha", () => {
    expect(passwordProblem("curta")).toMatch(/10 caracteres/);
    expect(passwordProblem("1234567890")).toMatch(/comum/);
    expect(passwordProblem("ana.souza-2026!", "ana.souza@befluent.com.br")).toMatch(/e-mail/);
    expect(passwordProblem("cavalo bateria grampo")).toBeNull();
  });
});

describe("tokens e cifra", () => {
  const secret = "x".repeat(64);

  it("AES-GCM ida e volta; adulteração é detectada", () => {
    const enc = encrypt(secret, "totp", "JBSWY3DPEHPK3PXP");
    expect(enc).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decrypt(secret, "totp", enc)).toBe("JBSWY3DPEHPK3PXP");
    const parts = enc.split(".");
    parts[3] = Buffer.from("outro texto").toString("base64url");
    expect(() => decrypt(secret, "totp", parts.join("."))).toThrow();
    expect(() => decrypt("y".repeat(64), "totp", enc)).toThrow();
  });

  it("HMAC depende do segredo e do propósito", () => {
    expect(hmac(secret, "a", "v")).toBe(hmac(secret, "a", "v"));
    expect(hmac(secret, "a", "v")).not.toBe(hmac(secret, "b", "v"));
    expect(hmac(secret, "a", "v")).not.toBe(hmac("z".repeat(64), "a", "v"));
  });

  it("sha256 e comparação em tempo constante", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("códigos legíveis sem caracteres ambíguos", () => {
    const code = readableCode(200);
    expect(code).toHaveLength(200);
    expect(code).not.toMatch(/[01OI]/);
  });
});

describe("CSRF: regra de origem", () => {
  const app = "https://financeiro.befluentschool.com.br";
  it("aceita a própria origem", () => {
    expect(isAllowedOrigin(app, null, app)).toBe(true);
  });
  it("recusa outra origem, mesmo com sec-fetch-site", () => {
    expect(isAllowedOrigin("https://evil.example", "same-origin", app)).toBe(false);
    expect(isAllowedOrigin("http://financeiro.befluentschool.com.br", null, app)).toBe(false);
    expect(isAllowedOrigin("null", null, app)).toBe(false);
  });
  it("sem Origin, só com sec-fetch-site same-origin", () => {
    expect(isAllowedOrigin(null, "same-origin", app)).toBe(true);
    expect(isAllowedOrigin(null, "cross-site", app)).toBe(false);
    expect(isAllowedOrigin(null, null, app)).toBe(false);
  });
});

describe("matriz de autorização (espelha o RLS)", () => {
  const owner = { role: "owner" as const, permissions: ["manage_invoices", "view_net_profit"] };
  const socio = { role: "socio" as const, permissions: ["manage_invoices", "view_dashboards", "manage_leads"] };
  const func = { role: "funcionario" as const, permissions: ["manage_invoices", "manage_leads"] };

  it("planos/metas/conciliação: owner e sócio", () => {
    expect(Policies.ownerOrSocio.check(owner)).toBe(true);
    expect(Policies.ownerOrSocio.check(socio)).toBe(true);
    expect(Policies.ownerOrSocio.check(func)).toBe(false);
  });
  it("lucro líquido: só owner", () => {
    expect(Policies.viewNetProfit.check(owner)).toBe(true);
    expect(Policies.viewNetProfit.check(socio)).toBe(false);
    expect(Policies.viewNetProfit.check(func)).toBe(false);
  });
  it("mensalidades/caixa: quem tem manage_invoices", () => {
    expect(Policies.manageInvoices.check(func)).toBe(true);
    expect(Policies.manageInvoices.check({ role: "funcionario", permissions: [] })).toBe(false);
  });
});

describe("validação de datas", () => {
  it("só aceita datas reais", () => {
    expect(isoDate.safeParse("2026-02-28").success).toBe(true);
    expect(isoDate.safeParse("2026-02-30").success).toBe(false);
    expect(isoDate.safeParse("2026-2-1").success).toBe(false);
    expect(isoDate.safeParse("'; drop table x; --").success).toBe(false);
  });
  it("mês de URL malformado volta ao padrão", () => {
    expect(parseYearMonth("2026-13", "2026-01")).toBe("2026-01");
    expect(parseYearMonth("2026-07", "2026-01")).toBe("2026-07");
    expect(parseYearMonth(undefined, "2026-01")).toBe("2026-01");
  });
});
