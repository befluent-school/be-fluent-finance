/**
 * Sugere o trecho que identifica o favorecido/pagador numa descrição de
 * extrato, para virar regra de categorização. Ex.:
 *   "Pix enviado — PIX ENVIADO - Cp :02843443-ROCKET  MARKETING DIGITAL LT (Inter PJ)"
 *   → "ROCKET MARKETING DIGITAL LT"
 * Remove o rótulo da conta "(…)" do fim, códigos/números e o prefixo genérico.
 */
export function suggestRulePattern(description: string): string {
  let d = description.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const cp = d.match(/Cp\s*:\s*[\d.\-/]*-?(.+)$/i);
  if (cp) d = cp[1];
  else {
    const parts = d.split(/\s+[—-]\s+/);
    d = parts[parts.length - 1] ?? d;
  }
  d = d.replace(/\b(fatura|nr\.?|n[º°])\b/gi, " ").replace(/[\d]+/g, " ").replace(/\s+/g, " ").trim();
  return d.length >= 3 ? d.slice(0, 80) : description.slice(0, 80);
}
