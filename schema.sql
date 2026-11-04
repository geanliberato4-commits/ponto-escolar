-- ============================================================
-- schema.sql — Ponto Escolar (Supabase / PostgreSQL)
-- Rode inteiro no Supabase: SQL Editor > New query > colar > Run
-- ------------------------------------------------------------
-- Segurança:
--  * A recepção (usuário anônimo) NÃO lê nem grava tabelas.
--    Ela só chama as funções ponto_* (CPF -> próxima batida -> grava).
--  * O horário da batida é o now() do servidor.
--  * Batidas, versões de escala, alterações, invalidações, tentativas
--    e auditoria são IMUTÁVEIS (trigger bloqueia UPDATE/DELETE).
--  * Painel admin: Supabase Auth + tabela admins (perfil).
-- ============================================================

-- ---------- tabelas ----------
create table if not exists public.escalas (
  id int primary key,
  nome text not null
);

create table if not exists public.escala_versoes (
  id bigserial primary key,
  escala_id int not null references public.escalas(id),
  entrada time not null,
  saida time not null check (saida > entrada),
  vigencia_inicio date not null,
  motivo text not null,
  admin_email text,
  criado_em timestamptz not null default now()
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nome text,
  perfil text not null check (perfil in ('admin','gestor','consulta')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists public.funcionarios (
  id bigserial primary key,
  nome text not null,
  cpf text not null unique check (cpf ~ '^[0-9]{11}$'),
  cargo text,
  admissao date,
  escala_id int not null references public.escalas(id),
  ativo boolean not null default true,
  digitais int not null default 0 check (digitais between 0 and 2),
  criado_em timestamptz not null default now()
);

create table if not exists public.alteracoes (
  id bigserial primary key,
  funcionario_id bigint not null references public.funcionarios(id),
  tipo text not null check (tipo in ('permanente','temporaria')),
  data_inicio date not null,
  data_fim date,
  escala_id int references public.escalas(id),
  entrada time,
  saida time,
  anterior text,
  motivo text not null,
  admin_email text,
  criado_em timestamptz not null default now(),
  check (escala_id is not null or (entrada is not null and saida is not null)),
  check (data_fim is null or data_fim >= data_inicio)
);

create table if not exists public.batidas (
  id bigserial primary key,
  funcionario_id bigint not null references public.funcionarios(id),
  tipo text not null check (tipo in ('entrada','almoco_saida','almoco_retorno','saida')),
  data date not null,
  momento timestamptz not null default now(),
  origem text not null check (origem in ('recepcao','ajuste')),
  metodo text,
  terminal text,
  motivo text,
  admin_email text,
  criado_em timestamptz not null default now(),
  check (origem = 'recepcao' or (motivo is not null and length(trim(motivo)) > 0))
);
create index if not exists batidas_func_data on public.batidas (funcionario_id, data);
create index if not exists batidas_data on public.batidas (data);

create table if not exists public.batidas_invalidadas (
  batida_id bigint primary key references public.batidas(id),
  motivo text not null,
  admin_email text,
  criado_em timestamptz not null default now()
);

create table if not exists public.tentativas (
  id bigserial primary key,
  momento timestamptz not null default now(),
  cpf_mascarado text,
  funcionario_id bigint references public.funcionarios(id),
  resultado text not null,
  detalhe text,
  terminal text
);
create index if not exists tentativas_momento on public.tentativas (momento desc);

create table if not exists public.ocorrencias (
  id bigserial primary key,
  funcionario_id bigint not null references public.funcionarios(id),
  tipo text not null,
  data_inicio date not null,
  data_fim date,
  minutos int,
  descricao text,
  status text not null default 'pendente' check (status in ('pendente','aprovada','rejeitada')),
  admin_email text,
  decidido_por text,
  decidido_em timestamptz,
  criado_em timestamptz not null default now()
);

create table if not exists public.feriados (
  data date primary key,
  descricao text not null
);

create table if not exists public.configuracoes (
  id int primary key default 1 check (id = 1),
  tolerancia_min int not null default 5,
  tolerancia_clt boolean not null default false,
  dias_uteis int[] not null default '{1,2,3,4,5}'
);

create table if not exists public.auditoria (
  id bigserial primary key,
  momento timestamptz not null default now(),
  admin_email text,
  acao text not null,
  detalhe jsonb
);

-- ---------- funções auxiliares ----------
create or replace function public.mascara_cpf(c text) returns text
language sql immutable set search_path = public as $$
  select case when length(c) = 11 then '***.' || substr(c,4,3) || '.' || substr(c,7,3) || '-**' else '***' end
$$;

create or replace function public.nome_curto(n text) returns text
language sql immutable set search_path = public as $$
  select case when array_length(p, 1) > 1 then p[1] || ' ' || p[array_length(p, 1)] else coalesce(p[1], '') end
  from (select regexp_split_to_array(trim(n), '\s+') as p) x
$$;

create or replace function public.meu_perfil() returns text
language sql stable security definer set search_path = public as $$
  select perfil from public.admins where user_id = auth.uid() and ativo
$$;

-- carimba o e-mail do admin logado (não dá para falsificar pelo navegador)
create or replace function public.carimbar_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.admin_email := coalesce(auth.jwt() ->> 'email', new.admin_email);
  return new;
end $$;

-- registros imutáveis
create or replace function public.bloquear_alteracao() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'Registro imutável: % não permite %', tg_table_name, tg_op;
end $$;

-- decisão de ocorrência: grava quem decidiu e quando
create or replace function public.carimbar_decisao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    new.decidido_por := coalesce(auth.jwt() ->> 'email', new.decidido_por);
    new.decidido_em := now();
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['escala_versoes','alteracoes','batidas','batidas_invalidadas','ocorrencias','auditoria'] loop
    execute format('drop trigger if exists trg_carimbo on public.%I', t);
    execute format('create trigger trg_carimbo before insert on public.%I for each row execute function public.carimbar_admin()', t);
  end loop;
  foreach t in array array['escala_versoes','alteracoes','batidas','batidas_invalidadas','tentativas','auditoria'] loop
    execute format('drop trigger if exists trg_imutavel on public.%I', t);
    execute format('create trigger trg_imutavel before update or delete on public.%I for each row execute function public.bloquear_alteracao()', t);
  end loop;
end $$;

drop trigger if exists trg_decisao on public.ocorrencias;
create trigger trg_decisao before update on public.ocorrencias for each row execute function public.carimbar_decisao();

-- ---------- RLS (Row Level Security) ----------
do $$
declare t text;
begin
  foreach t in array array['escalas','escala_versoes','admins','funcionarios','alteracoes','batidas','batidas_invalidadas','tentativas','ocorrencias','feriados','configuracoes','auditoria'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- leitura: qualquer perfil administrativo ativo
  foreach t in array array['escalas','escala_versoes','funcionarios','alteracoes','batidas','batidas_invalidadas','tentativas','ocorrencias','feriados','configuracoes','auditoria'] loop
    execute format('drop policy if exists ler on public.%I', t);
    execute format('create policy ler on public.%I for select to authenticated using (public.meu_perfil() is not null)', t);
  end loop;

  -- inclusão: admin e gestor
  foreach t in array array['escala_versoes','funcionarios','alteracoes','batidas','batidas_invalidadas','ocorrencias'] loop
    execute format('drop policy if exists incluir on public.%I', t);
    execute format('create policy incluir on public.%I for insert to authenticated with check (public.meu_perfil() in (''admin'',''gestor''))', t);
  end loop;

  -- edição: admin e gestor (somente cadastros e ocorrências)
  foreach t in array array['funcionarios','ocorrencias'] loop
    execute format('drop policy if exists editar on public.%I', t);
    execute format('create policy editar on public.%I for update to authenticated using (public.meu_perfil() in (''admin'',''gestor'')) with check (public.meu_perfil() in (''admin'',''gestor''))', t);
  end loop;
end $$;

-- auditoria: qualquer perfil pode registrar (inclusive "consulta" ao gerar relatório)
drop policy if exists incluir on public.auditoria;
create policy incluir on public.auditoria for insert to authenticated with check (public.meu_perfil() is not null);

-- feriados e configurações: só admin
drop policy if exists fer_incluir on public.feriados;
create policy fer_incluir on public.feriados for insert to authenticated with check (public.meu_perfil() = 'admin');
drop policy if exists fer_remover on public.feriados;
create policy fer_remover on public.feriados for delete to authenticated using (public.meu_perfil() = 'admin');
drop policy if exists cfg_editar on public.configuracoes;
create policy cfg_editar on public.configuracoes for update to authenticated using (public.meu_perfil() = 'admin') with check (public.meu_perfil() = 'admin');

-- admins: cada um vê o próprio; admin vê e gerencia todos
drop policy if exists adm_ler on public.admins;
create policy adm_ler on public.admins for select to authenticated using (user_id = auth.uid() or public.meu_perfil() = 'admin');
drop policy if exists adm_incluir on public.admins;
create policy adm_incluir on public.admins for insert to authenticated with check (public.meu_perfil() = 'admin');
drop policy if exists adm_editar on public.admins;
create policy adm_editar on public.admins for update to authenticated using (public.meu_perfil() = 'admin');

-- ---------- funções da recepção (únicas coisas que o anônimo acessa) ----------
create or replace function public.ponto_hora() returns timestamptz
language sql stable set search_path = public as $$ select now() $$;

create or replace function public.ponto_identificar(p_cpf text, p_terminal text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  f public.funcionarios%rowtype;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_tipos text[] := array['entrada','almoco_saida','almoco_retorno','saida'];
  v_qtd int;
begin
  p_cpf := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  select * into f from public.funcionarios where cpf = p_cpf and ativo;
  if not found then
    insert into public.tentativas (cpf_mascarado, resultado, detalhe, terminal)
      values (public.mascara_cpf(p_cpf), 'nao_encontrado', 'CPF não cadastrado ou inativo', left(p_terminal, 40));
    return json_build_object('ok', false, 'erro', 'CPF não encontrado. Procure a secretaria.');
  end if;
  select count(*) into v_qtd from public.batidas b
   where b.funcionario_id = f.id and b.data = v_hoje
     and not exists (select 1 from public.batidas_invalidadas i where i.batida_id = b.id);
  return json_build_object('ok', true, 'nome', public.nome_curto(f.nome),
    'proxima', case when v_qtd < 4 then v_tipos[v_qtd + 1] else null end,
    'qtd', v_qtd, 'digitais', f.digitais);
end $$;

create or replace function public.ponto_registrar(p_cpf text, p_tipo text, p_metodo text default 'cpf', p_terminal text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  f public.funcionarios%rowtype;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_tipos text[] := array['entrada','almoco_saida','almoco_retorno','saida'];
  v_qtd int; v_ult timestamptz; v_prox text; v_momento timestamptz;
  v_cpfm text;
begin
  p_cpf := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_cpfm := public.mascara_cpf(p_cpf);
  p_terminal := left(p_terminal, 40);
  if p_metodo is null or p_metodo not in ('cpf','biometria','simulador') then p_metodo := 'cpf'; end if;

  select * into f from public.funcionarios where cpf = p_cpf and ativo;
  if not found then
    insert into public.tentativas (cpf_mascarado, resultado, detalhe, terminal) values (v_cpfm, 'nao_encontrado', 'Registro com CPF não cadastrado', p_terminal);
    return json_build_object('ok', false, 'erro', 'CPF não encontrado. Procure a secretaria.');
  end if;

  perform pg_advisory_xact_lock(f.id);   -- evita duas batidas simultâneas do mesmo funcionário

  select count(*), max(b.momento) into v_qtd, v_ult from public.batidas b
   where b.funcionario_id = f.id and b.data = v_hoje
     and not exists (select 1 from public.batidas_invalidadas i where i.batida_id = b.id);

  if v_qtd >= 4 then
    insert into public.tentativas (cpf_mascarado, funcionario_id, resultado, detalhe, terminal) values (v_cpfm, f.id, 'jornada_encerrada', 'Quinta batida recusada', p_terminal);
    return json_build_object('ok', false, 'erro', 'As 4 batidas de hoje já foram registradas.');
  end if;

  v_prox := v_tipos[v_qtd + 1];
  if p_tipo is distinct from v_prox then
    insert into public.tentativas (cpf_mascarado, funcionario_id, resultado, detalhe, terminal) values (v_cpfm, f.id, 'fora_sequencia', 'Esperado ' || v_prox || ', recebido ' || coalesce(p_tipo, '?'), p_terminal);
    return json_build_object('ok', false, 'erro', 'A sequência de batidas mudou. Identifique-se novamente.');
  end if;

  if v_ult is not null and now() - v_ult < interval '1 minute' then
    insert into public.tentativas (cpf_mascarado, funcionario_id, resultado, detalhe, terminal) values (v_cpfm, f.id, 'duplicada', 'Batida em menos de 1 minuto', p_terminal);
    return json_build_object('ok', false, 'erro', 'Já houve uma batida há menos de 1 minuto. Aguarde.');
  end if;

  insert into public.batidas (funcionario_id, tipo, data, momento, origem, metodo, terminal)
    values (f.id, v_prox, v_hoje, now(), 'recepcao', p_metodo, p_terminal)
    returning momento into v_momento;
  insert into public.tentativas (cpf_mascarado, funcionario_id, resultado, detalhe, terminal) values (v_cpfm, f.id, 'registrado', v_prox, p_terminal);

  return json_build_object('ok', true, 'tipo', v_prox, 'momento', v_momento, 'nome', public.nome_curto(f.nome));
end $$;

create or replace function public.ponto_log(p_detalhe text, p_terminal text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into public.tentativas (resultado, detalhe, terminal) values ('falha_comunicacao', left(p_detalhe, 300), left(p_terminal, 40));
  return true;
end $$;

revoke all on function public.ponto_identificar(text, text) from public;
revoke all on function public.ponto_registrar(text, text, text, text) from public;
revoke all on function public.ponto_log(text, text) from public;
revoke all on function public.meu_perfil() from public, anon;
revoke all on function public.carimbar_admin() from public, anon, authenticated;
revoke all on function public.carimbar_decisao() from public, anon, authenticated;
revoke all on function public.bloquear_alteracao() from public, anon, authenticated;
grant execute on function public.ponto_hora() to anon, authenticated;
grant execute on function public.ponto_identificar(text, text) to anon, authenticated;
grant execute on function public.ponto_registrar(text, text, text, text) to anon, authenticated;
grant execute on function public.ponto_log(text, text) to anon, authenticated;
grant execute on function public.meu_perfil() to authenticated;

-- ---------- dados iniciais ----------
insert into public.escalas (id, nome) values (1,'Escala 1'),(2,'Escala 2'),(3,'Escala 3'),(4,'Escala 4') on conflict do nothing;

insert into public.escala_versoes (escala_id, entrada, saida, vigencia_inicio, motivo, admin_email)
select * from (values
  (1, time '07:00', time '16:24', date '2000-01-01', 'Horário inicial', 'sistema'),
  (2, time '07:30', time '16:54', date '2000-01-01', 'Horário inicial', 'sistema'),
  (3, time '08:00', time '17:24', date '2000-01-01', 'Horário inicial', 'sistema'),
  (4, time '08:36', time '18:00', date '2000-01-01', 'Horário inicial', 'sistema')
) v where not exists (select 1 from public.escala_versoes);

insert into public.configuracoes (id) values (1) on conflict do nothing;

-- feriados nacionais (adicione os municipais/estaduais e o recesso escolar no painel)
insert into public.feriados (data, descricao) values
  ('2026-11-02','Finados'),('2026-11-15','Proclamação da República'),('2026-11-20','Dia da Consciência Negra'),('2026-12-25','Natal'),
  ('2027-01-01','Confraternização Universal'),('2027-03-26','Sexta-feira Santa'),('2027-04-21','Tiradentes'),('2027-05-01','Dia do Trabalho'),
  ('2027-09-07','Independência do Brasil'),('2027-10-12','Nossa Senhora Aparecida'),('2027-11-02','Finados'),
  ('2027-11-15','Proclamação da República'),('2027-11-20','Dia da Consciência Negra'),('2027-12-25','Natal')
on conflict do nothing;

-- ============================================================
-- PRIMEIRO ADMINISTRADOR (rode depois de criar o usuário em
-- Authentication > Users > Add user, com "Auto Confirm User"):
--
-- insert into public.admins (user_id, email, nome, perfil)
-- select id, email, 'Direção', 'admin' from auth.users where email = 'direcao@suaescola.com.br';
-- ============================================================
