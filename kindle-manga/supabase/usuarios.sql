create extension if not exists pgcrypto;

create table if not exists public.usuarios (
  id uuid primary key default gen_random_uuid(),
  nome text,
  username text not null,
  email text not null,
  foto_url text,
  criado_em timestamptz not null default now(),
  constraint usuarios_username_key unique (username),
  constraint usuarios_email_key unique (email)
);

alter table public.usuarios add column if not exists nome text;
alter table public.usuarios add column if not exists foto_url text;
alter table public.usuarios add column if not exists criado_em timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'usuarios' and column_name = 'nome_completo'
  ) then
    update public.usuarios set nome = coalesce(nome, nome_completo);
    alter table public.usuarios drop column nome_completo;
  end if;
end $$;

create unique index if not exists usuarios_email_lower_key
  on public.usuarios (lower(email));

alter table public.usuarios enable row level security;

comment on table public.usuarios is 'Perfis da aplicação MangaKindle';
comment on column public.usuarios.id is 'ID público único do usuário';

create table if not exists public.downloads_usuario (
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  capitulo_id text not null,
  manga_id text not null,
  manga jsonb,
  numero text,
  titulo text not null default '',
  idioma text,
  origem text not null default 'MangaDex',
  atualizado_em timestamptz not null default now(),
  constraint downloads_usuario_pkey primary key (usuario_id, capitulo_id)
);

alter table public.downloads_usuario enable row level security;

comment on table public.downloads_usuario is 'Registro sincronizado de capítulos baixados por usuário; os arquivos permanecem locais';
