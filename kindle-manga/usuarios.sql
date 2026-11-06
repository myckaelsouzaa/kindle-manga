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

-- O servidor compara e-mails em minúsculas (igualdade exata); normaliza registros antigos.
update public.usuarios set email = lower(email) where email <> lower(email);

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
  device_id text,
  atualizado_em timestamptz not null default now(),
  constraint downloads_usuario_pkey primary key (usuario_id, capitulo_id, device_id)
);

alter table public.downloads_usuario add column if not exists device_id text;
update public.downloads_usuario set device_id = 'legacy' where device_id is null;
alter table public.downloads_usuario alter column device_id set not null;
alter table public.downloads_usuario drop constraint if exists downloads_usuario_pkey;
alter table public.downloads_usuario add constraint downloads_usuario_pkey primary key (usuario_id, capitulo_id, device_id);
alter table public.downloads_usuario enable row level security;

create index if not exists downloads_usuario_user_device_idx
  on public.downloads_usuario (usuario_id, device_id, atualizado_em desc);

drop policy if exists downloads_usuario_select_own on public.downloads_usuario;
create policy downloads_usuario_select_own on public.downloads_usuario
  for select using (auth.uid() = usuario_id);
drop policy if exists downloads_usuario_insert_own on public.downloads_usuario;
create policy downloads_usuario_insert_own on public.downloads_usuario
  for insert with check (auth.uid() = usuario_id);
drop policy if exists downloads_usuario_update_own on public.downloads_usuario;
create policy downloads_usuario_update_own on public.downloads_usuario
  for update using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);
drop policy if exists downloads_usuario_delete_own on public.downloads_usuario;
create policy downloads_usuario_delete_own on public.downloads_usuario
  for delete using (auth.uid() = usuario_id);

comment on table public.downloads_usuario is 'Registro sincronizado de capítulos baixados por usuário; os arquivos permanecem locais';

create table if not exists public.salvos_usuario (
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  manga_id text not null,
  manga jsonb not null,
  atualizado_em timestamptz not null default now(),
  constraint salvos_usuario_pkey primary key (usuario_id, manga_id)
);

alter table public.salvos_usuario enable row level security;
drop policy if exists salvos_usuario_own on public.salvos_usuario;
create policy salvos_usuario_own on public.salvos_usuario
  for all using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);

comment on table public.salvos_usuario is 'Mangás salvos sincronizados por usuário';

create table if not exists public.progresso_usuario (
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  manga_id text not null,
  progresso jsonb not null,
  atualizado_em timestamptz not null default now(),
  constraint progresso_usuario_pkey primary key (usuario_id, manga_id)
);

alter table public.progresso_usuario enable row level security;
drop policy if exists progresso_usuario_own on public.progresso_usuario;
create policy progresso_usuario_own on public.progresso_usuario
  for all using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);

comment on table public.progresso_usuario is 'Progresso de leitura sincronizado por usuário';
