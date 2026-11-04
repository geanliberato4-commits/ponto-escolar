-- Cole no Supabase › SQL Editor › Run (uma vez).
-- 1) Permite remover as digitais de um funcionário pelo painel.
create or replace function public.bio_remover_digitais(p_funcionario_id bigint)
returns json language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(public.meu_perfil(), '') not in ('admin','gestor') then
    return json_build_object('ok', false, 'erro', 'Sem permissão.');
  end if;
  delete from public.digitais where funcionario_id = p_funcionario_id;
  update public.funcionarios set digitais = 0 where id = p_funcionario_id;
  insert into public.auditoria (acao, detalhe) values ('funcionario.digital_remover', jsonb_build_object('id', p_funcionario_id));
  return json_build_object('ok', true);
end $$;
revoke all on function public.bio_remover_digitais(bigint) from public, anon;
grant execute on function public.bio_remover_digitais(bigint) to authenticated;

-- 2) Ao desligar alguém, apaga as digitais dele (LGPD).
create or replace function public.desligar_funcionario(p_id bigint, p_data date default null, p_motivo text default null)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  f public.funcionarios%rowtype;
  v_data date := coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if coalesce(public.meu_perfil(), '') not in ('admin','gestor') then
    return json_build_object('ok', false, 'erro', 'Sem permissão.');
  end if;
  select * into f from public.funcionarios where id = p_id;
  if not found then return json_build_object('ok', false, 'erro', 'Funcionário não encontrado.'); end if;
  delete from public.digitais where funcionario_id = p_id;
  update public.funcionarios
     set ativo = false, desligamento = v_data, digitais = 0,
         motivo_desligamento = nullif(trim(coalesce(p_motivo,'')), '')
   where id = p_id;
  insert into public.auditoria (acao, detalhe)
    values ('funcionario.desligar', jsonb_build_object('id', p_id, 'nome', f.nome, 'data', v_data, 'motivo', p_motivo));
  return json_build_object('ok', true);
end $$;
