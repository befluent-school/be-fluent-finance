import { describe, expect, it } from "vitest";
import { suggestRulePattern } from "@/lib/rule-pattern";

describe("sugestão de trecho para regra de categorização", () => {
  it("pega o favorecido do Pix do Inter", () => {
    expect(suggestRulePattern("Pix enviado  — PIX ENVIADO - Cp :02843443-ROCKET  MARKETING DIGITAL LT (Inter PJ)")).toBe(
      "ROCKET MARKETING DIGITAL LT"
    );
    expect(suggestRulePattern("Pix enviado  — PIX ENVIADO - Cp :18236120-61941566 Bianca Yasmin Takah (Inter PJ)")).toBe(
      "Bianca Yasmin Takah"
    );
  });
  it("cai na última parte da descrição quando não há Cp", () => {
    expect(suggestRulePattern("Pix enviado — LANCHONETE SAO JOSE (Inter PJ)")).toBe("LANCHONETE SAO JOSE");
  });
});
