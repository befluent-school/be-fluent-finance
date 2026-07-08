-- Códigos de backup para recuperação de 2FA (Supabase Auth MFA não gera isso nativamente).
-- Guardamos apenas o hash (sha-256) de cada código; nunca o valor em texto puro.

create table public.mfa_backup_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_mfa_backup_codes_user_id on public.mfa_backup_codes (user_id);

alter table public.mfa_backup_codes enable row level security;

create policy "mfa_backup_codes_select_self"
  on public.mfa_backup_codes for select
  using (user_id = auth.uid());

create policy "mfa_backup_codes_insert_self"
  on public.mfa_backup_codes for insert
  with check (user_id = auth.uid());

create policy "mfa_backup_codes_update_self"
  on public.mfa_backup_codes for update
  using (user_id = auth.uid());

create policy "mfa_backup_codes_delete_self"
  on public.mfa_backup_codes for delete
  using (user_id = auth.uid());
