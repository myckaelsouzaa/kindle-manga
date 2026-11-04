create extension if not exists pgcrypto;

create table if not exists public.usuarios (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  nome_completo text,
  email text not null,
  foto_url text,
  criado_em timestamptz not null default now()
);

alter table public.usuarios enable row level security;

comment on table public.usuarios is 'Perfis da aplicação MangaKindle';
comment on column public.usuarios.username is 'Identificador único usado no login';
