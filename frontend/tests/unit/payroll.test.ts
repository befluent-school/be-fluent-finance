import { describe, expect, it } from "vitest";
import { suggestAmount } from "@/lib/payroll-shared";

describe("folha de professores — valor sugerido pela regra", () => {
  it("por_hora = aulas × valor/hora", () => {
    expect(suggestAmount("por_hora", 35, 8)).toBe(280);
    expect(suggestAmount("por_hora", 35, 0)).toBe(0);
    expect(suggestAmount("por_hora", 58.33, 3)).toBe(174.99);
  });

  it("fixo ignora a quantidade de aulas", () => {
    expect(suggestAmount("fixo", 1200, 10)).toBe(1200);
    expect(suggestAmount("fixo", 1200, 0)).toBe(1200);
  });

  it("comissão, repasse e outro não têm sugestão automática (0 → valor manual)", () => {
    expect(suggestAmount("comissao", 58.33, 10)).toBe(0);
    expect(suggestAmount("repasse_integral", null, 10)).toBe(0);
    expect(suggestAmount("outro", 100, 10)).toBe(0);
  });

  it("valor de referência nulo vira 0, sem quebrar", () => {
    expect(suggestAmount("por_hora", null, 8)).toBe(0);
    expect(suggestAmount("fixo", null, 1)).toBe(0);
  });

  it("arredonda para centavos", () => {
    expect(suggestAmount("por_hora", 33.333, 3)).toBe(100);
  });
});
