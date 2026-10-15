-- Ajuste fino: professora que já existia antes da 0030 e ficou com
-- payment_type = 'outro' por causa do ON CONFLICT DO NOTHING, mas tem valor de
-- referência de hora/aula (R$ 35,00). Classifica como 'por_hora' só se ainda
-- estiver em 'outro', para não sobrescrever ajuste manual feito na tela.
update public.teachers
  set payment_type = 'por_hora'
  where lower(full_name) = 'anna beatriz'
    and payment_type = 'outro'
    and payment_reference_value is not null;
