/** Formas de pagamento de professor (cadastro e edição). */
export const PAYMENT_TYPES: { value: string; label: string; hint: string }[] = [
  { value: "por_hora", label: "Por hora/aula", hint: "Valor de referência = R$ por aula dada. O sistema multiplica pelas aulas." },
  { value: "fixo", label: "Valor fixo mensal", hint: "Valor de referência = valor fixo pago todo mês, independente das aulas." },
  { value: "comissao", label: "Comissão (%)", hint: "Valor de referência = % sobre as mensalidades pagas pelos alunos dele no mês." },
  { value: "repasse_integral", label: "Repasse integral", hint: "Repassa 100% das mensalidades pagas pelos alunos dele no mês." },
  { value: "outro", label: "Outro (manual)", hint: "Sem cálculo automático — você informa o valor a pagar na folha." },
];
