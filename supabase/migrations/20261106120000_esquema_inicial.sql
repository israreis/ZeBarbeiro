-- =============================================================================
-- BarberApp — esquema inicial no Supabase (PostgreSQL)
--
-- Arquitetura de acesso: o navegador NUNCA fala direto com o banco. Toda leitura
-- e escrita passa pela API Node, que usa a chave service_role (só no servidor).
-- Por isso o RLS fica ATIVO e SEM políticas em todas as tabelas: as chaves
-- anon/publishable não conseguem ler nem gravar nada, mesmo que vazem.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Perfis: dados do usuário ligados ao Supabase Auth (auth.users).
-- O e-mail/senha de login ficam no Auth; aqui fica o que a aplicação exibe.
-- -----------------------------------------------------------------------------
create table public.perfis (
  id              uuid primary key references auth.users (id) on delete cascade,
  nome            text not null check (char_length(nome) between 1 and 120),
  email           text not null check (email = lower(email)),
  telefone        text not null check (char_length(telefone) <= 20),
  data_nascimento date not null,
  perfil          text not null default 'cliente'
                  check (perfil in ('administrador', 'barbeiro', 'cliente')),
  criado_em       timestamptz not null default now()
);

create unique index perfis_email_key on public.perfis (email);

-- -----------------------------------------------------------------------------
-- Serviços oferecidos pela barbearia.
-- -----------------------------------------------------------------------------
create table public.servicos (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null check (char_length(nome) between 1 and 60),
  valor            numeric(10, 2) not null check (valor > 0),
  duracao_minutos  integer not null check (duracao_minutos between 1 and 480),
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now()
);

-- Nome único sem diferenciar maiúsculas/minúsculas.
create unique index servicos_nome_key on public.servicos (lower(nome));

-- -----------------------------------------------------------------------------
-- Barbeiros: expediente, dias de atendimento e foto (caminho no Storage).
-- -----------------------------------------------------------------------------
create table public.barbeiros (
  id                uuid primary key references public.perfis (id) on delete cascade,
  ativo             boolean not null default true,
  horario_inicial   time not null,
  horario_final     time not null,
  dias_disponiveis  text[] not null,
  foto_path         text,
  constraint barbeiros_expediente_minimo
    check (horario_final - horario_inicial >= interval '30 minutes'),
  constraint barbeiros_dias_validos
    check (
      cardinality(dias_disponiveis) > 0
      and dias_disponiveis <@ array['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']
    )
);

create table public.barbeiro_servicos (
  barbeiro_id  uuid not null references public.barbeiros (id) on delete cascade,
  servico_id   uuid not null references public.servicos (id) on delete restrict,
  primary key (barbeiro_id, servico_id)
);

-- -----------------------------------------------------------------------------
-- Agendamentos (um registro por horário de 30 minutos).
-- -----------------------------------------------------------------------------
create table public.agendamentos (
  id                uuid primary key default gen_random_uuid(),
  barbeiro_id       uuid not null references public.barbeiros (id) on delete restrict,
  -- Cliente cadastrado (agendou pelo app) OU nome informado pelo barbeiro.
  cliente_id        uuid references public.perfis (id) on delete set null,
  cliente_nome      text check (char_length(cliente_nome) <= 120),
  cliente_telefone  text check (char_length(cliente_telefone) <= 20),
  servico_id        uuid references public.servicos (id) on delete restrict,
  -- Preço do serviço no momento da reserva (relatórios não mudam se o preço mudar).
  valor             numeric(10, 2) check (valor >= 0),
  data              date not null,
  horario_inicio    time not null,
  horario_fim       time not null,
  status            text not null
                    check (status in ('Agendado', 'Agendado Barbeiro', 'Bloqueado', 'Concluído', 'Cancelado')),
  criado_em         timestamptz not null default now(),
  cancelado_em      timestamptz,
  constraint agendamentos_horario_valido check (horario_fim > horario_inicio),
  constraint agendamentos_servico_com_valor check ((servico_id is null) = (valor is null)),
  constraint agendamentos_servico_obrigatorio
    check (servico_id is not null or status in ('Bloqueado', 'Cancelado'))
);

-- Garantia final contra reserva dupla: um único agendamento "vivo" por
-- barbeiro/data/horário. Cancelados liberam o horário.
create unique index agendamentos_horario_ocupado_key
  on public.agendamentos (barbeiro_id, data, horario_inicio)
  where status <> 'Cancelado';

create index agendamentos_data_idx on public.agendamentos (data, barbeiro_id);
create index agendamentos_cliente_idx on public.agendamentos (cliente_id, data);

-- -----------------------------------------------------------------------------
-- Segurança: RLS ativo e sem políticas (acesso somente pela service_role).
-- -----------------------------------------------------------------------------
alter table public.perfis            enable row level security;
alter table public.servicos          enable row level security;
alter table public.barbeiros         enable row level security;
alter table public.barbeiro_servicos enable row level security;
alter table public.agendamentos      enable row level security;

revoke all on table
  public.perfis, public.servicos, public.barbeiros, public.barbeiro_servicos, public.agendamentos
  from anon, authenticated;

grant select, insert, update, delete on table
  public.perfis, public.servicos, public.barbeiros, public.barbeiro_servicos, public.agendamentos
  to service_role;

-- -----------------------------------------------------------------------------
-- salvar_barbeiro: grava perfil, expediente e serviços numa única transação.
-- -----------------------------------------------------------------------------
create or replace function public.salvar_barbeiro(
  p_id               uuid,
  p_nome             text,
  p_email            text,
  p_telefone         text,
  p_data_nascimento  date,
  p_ativo            boolean,
  p_horario_inicial  time,
  p_horario_final    time,
  p_dias             text[],
  p_servicos         uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- O administrador também pode atender como barbeiro; clientes, não.
  if exists (select 1 from public.perfis where id = p_id and perfil = 'cliente') then
    raise exception 'O usuário % é um cliente e não pode ser cadastrado como barbeiro.', p_id
      using errcode = 'check_violation';
  end if;

  insert into public.perfis (id, nome, email, telefone, data_nascimento, perfil)
  values (p_id, p_nome, p_email, p_telefone, p_data_nascimento, 'barbeiro')
  on conflict (id) do update
    set nome = excluded.nome,
        email = excluded.email,
        telefone = excluded.telefone,
        data_nascimento = excluded.data_nascimento;

  insert into public.barbeiros (id, ativo, horario_inicial, horario_final, dias_disponiveis)
  values (p_id, p_ativo, p_horario_inicial, p_horario_final, p_dias)
  on conflict (id) do update
    set ativo = excluded.ativo,
        horario_inicial = excluded.horario_inicial,
        horario_final = excluded.horario_final,
        dias_disponiveis = excluded.dias_disponiveis;

  delete from public.barbeiro_servicos where barbeiro_id = p_id;
  insert into public.barbeiro_servicos (barbeiro_id, servico_id)
  select p_id, unnest(p_servicos);
end;
$$;

-- -----------------------------------------------------------------------------
-- revogar_sessoes: encerra as sessões de um usuário (ex.: senha redefinida
-- pelo administrador). A API valida tokens com auth.getUser, que recusa
-- tokens de sessões apagadas.
-- -----------------------------------------------------------------------------
create or replace function public.revogar_sessoes(p_usuario uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.sessions where user_id = p_usuario;
$$;

-- Funções só podem ser chamadas pelo servidor.
revoke execute on function public.salvar_barbeiro(uuid, text, text, text, date, boolean, time, time, text[], uuid[])
  from public, anon, authenticated;
revoke execute on function public.revogar_sessoes(uuid) from public, anon, authenticated;
grant execute on function public.salvar_barbeiro(uuid, text, text, text, date, boolean, time, time, text[], uuid[])
  to service_role;
grant execute on function public.revogar_sessoes(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Storage: bucket público (somente leitura pela URL) para fotos dos barbeiros.
-- Uploads e exclusões são feitos pela API com a service_role; sem políticas de
-- escrita, ninguém mais consegue enviar arquivos.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-barbeiros', 'fotos-barbeiros', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
