-- Grants nas views criadas depois da 0021.
--
-- A 0021 concedeu SELECT em "all tables in schema public" uma única vez;
-- views criadas em migrations posteriores (0023–0024) não herdam esse grant.
-- Sem isto, o papel da aplicação recebe "permission denied for view ..." ao
-- abrir Impostos e Contas a Pagar. (As views com security_invoker ainda
-- aplicam o RLS das tabelas de origem para quem consulta — o grant só libera
-- o acesso à view em si.)

grant select on
  public.payables_with_effective_status,
  public.v_receita_bruta_mensal,
  public.v_simples_apuracao
  to financeiro_app;
