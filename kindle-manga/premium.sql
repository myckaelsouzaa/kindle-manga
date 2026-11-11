-- =====================================================================
-- MangaKindle - Migração: Assinatura Premium e controle de acesso
-- Executar no SQL Editor do Supabase (idempotente, pode rodar mais de uma vez).
-- Depende de usuarios.sql (tabela public.usuarios).
-- =====================================================================

-- 1) Papel e assinatura no perfil do usuário ---------------------------
alter table public.usuarios add column if not exists role text not null default 'free';
alter table public.usuarios add column if not exists subscription_status text not null default 'inactive';
alter table public.usuarios add column if not exists subscription_started_at timestamptz;
alter table public.usuarios add column if not exists subscription_expires_at timestamptz;
alter table public.usuarios add column if not exists payment_customer_id text;
alter table public.usuarios add column if not exists payment_subscription_id text;

alter table public.usuarios drop constraint if exists usuarios_role_check;
alter table public.usuarios add constraint usuarios_role_check
  check (role in ('admin', 'premium', 'free'));

alter table public.usuarios drop constraint if exists usuarios_subscription_status_check;
alter table public.usuarios add constraint usuarios_subscription_status_check
  check (subscription_status in ('inactive', 'pending', 'active', 'past_due', 'canceled', 'expired'));

create index if not exists usuarios_payment_customer_idx
  on public.usuarios (payment_customer_id) where payment_customer_id is not null;
create index if not exists usuarios_payment_subscription_idx
  on public.usuarios (payment_subscription_id) where payment_subscription_id is not null;

comment on column public.usuarios.role is 'Nível de acesso: admin, premium ou free (padrão)';
comment on column public.usuarios.subscription_status is 'Situação da assinatura: inactive, pending, active, past_due, canceled ou expired';
comment on column public.usuarios.subscription_expires_at is 'Fim do período pago; o acesso Premium vale até esta data';

-- 2) Administrador: usuário "Myckael" ----------------------------------
-- IMPORTANTE: identifique pelo E-MAIL (único no banco). O campo username NÃO é
-- único, então qualquer pessoa poderia se cadastrar com o nome "Myckael".
-- Troque o e-mail abaixo pelo e-mail real da conta e execute.
-- O servidor também aceita a variável de ambiente ADMIN_EMAILS (mesmo e-mail).
update public.usuarios
   set role = 'admin',
       subscription_status = 'active',
       subscription_expires_at = null
 where lower(email) = lower('SEU_EMAIL_AQUI@exemplo.com');

-- 3) Histórico de pagamentos (idempotência dos webhooks) ----------------
create table if not exists public.pagamentos_usuario (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  provider text not null default 'stripe',
  provider_ref text not null,
  metodo text,
  valor_centavos integer not null check (valor_centavos >= 0),
  moeda text not null default 'brl',
  status text not null default 'paid',
  periodo_inicio timestamptz,
  periodo_fim timestamptz,
  criado_em timestamptz not null default now(),
  constraint pagamentos_usuario_provider_ref_key unique (provider, provider_ref)
);

create index if not exists pagamentos_usuario_user_idx
  on public.pagamentos_usuario (usuario_id, criado_em desc);

-- RLS ligado e sem políticas: somente o servidor (service role) lê e escreve.
alter table public.pagamentos_usuario enable row level security;

comment on table public.pagamentos_usuario is 'Pagamentos confirmados da assinatura Premium; a chave única (provider, provider_ref) impede ativar o mesmo pagamento duas vezes';

-- 4) Rebaixa assinaturas vencidas (opcional) ---------------------------
-- O servidor já trata o acesso como "free" após o vencimento; esta função só
-- mantém a coluna role coerente. Para agendar com pg_cron:
--   select cron.schedule('mk-expire-premium', '0 * * * *', 'select public.expire_premium()');
create or replace function public.expire_premium()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  total integer;
begin
  update public.usuarios
     set role = 'free', subscription_status = 'expired'
   where role = 'premium'
     and subscription_expires_at is not null
     and subscription_expires_at < now();
  get diagnostics total = row_count;
  return total;
end;
$$;

revoke all on function public.expire_premium() from public, anon, authenticated;
