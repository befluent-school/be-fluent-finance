-- Quem acabou de definir a senha por um link de uso único (enviado pelo
-- owner via `npm run user -- reset-link` ou recebido por e-mail) já provou
-- que tem acesso a esse canal privado. Nos minutos seguintes, o cadastro do
-- 2FA dispensa o código por e-mail — o que permite operar mesmo sem SMTP.
alter table iam.users add column enroll_preverified_until timestamptz;
