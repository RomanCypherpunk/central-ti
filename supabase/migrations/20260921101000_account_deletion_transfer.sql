begin;

create or replace function public.transferir_historico_e_reservar_exclusao(
  p_ator_id uuid,
  p_usuario_id uuid,
  p_destino_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  alvo public.usuarios%rowtype;
  destino public.usuarios%rowtype;
  total_admins integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('central-ti.account-deletion', 0)
  );

  if p_ator_id = p_usuario_id or p_usuario_id = p_destino_id then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid-target');
  end if;

  select * into alvo from public.usuarios where id = p_usuario_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'target-not-found');
  end if;

  select * into destino from public.usuarios where id = p_destino_id for update;
  if not found or not destino.ativo or destino.status_aprovacao <> 'aprovado' then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid-destination');
  end if;

  if alvo.perfil in ('analista', 'admin') and destino.perfil not in ('analista', 'admin') then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'team-destination-required');
  end if;

  if alvo.perfil = 'admin' and alvo.status_aprovacao = 'aprovado' and alvo.ativo then
    select count(*) into total_admins
      from public.usuarios
      where perfil = 'admin' and status_aprovacao = 'aprovado' and ativo;
    if total_admins <= 1 then
      return pg_catalog.jsonb_build_object('ok', false, 'code', 'last-admin');
    end if;
  end if;

  update public.chamados set solicitante_id = p_destino_id where solicitante_id = p_usuario_id;

  delete from public.chamado_membros origem
  using public.chamado_membros ja_destino
  where origem.usuario_id = p_usuario_id
    and ja_destino.usuario_id = p_destino_id
    and ja_destino.chamado_id = origem.chamado_id;
  update public.chamado_membros set usuario_id = p_destino_id where usuario_id = p_usuario_id;

  update public.comentarios set autor_id = p_destino_id where autor_id = p_usuario_id;
  update public.anexos set usuario_id = p_destino_id where usuario_id = p_usuario_id;
  update public.artigos set autor_id = p_destino_id where autor_id = p_usuario_id;

  delete from public.artigo_feedback origem
  using public.artigo_feedback ja_destino
  where origem.usuario_id = p_usuario_id
    and ja_destino.usuario_id = p_destino_id
    and ja_destino.artigo_id = origem.artigo_id;
  update public.artigo_feedback set usuario_id = p_destino_id where usuario_id = p_usuario_id;

  -- Reserva a exclusão. Isso impede uma corrida que poderia remover dois
  -- administradores ao mesmo tempo, enquanto a Edge remove o login no Auth.
  update public.usuarios set ativo = false where id = p_usuario_id;
  return pg_catalog.jsonb_build_object('ok', true, 'foto_path', alvo.foto_path);
end;
$$;

revoke all on function public.transferir_historico_e_reservar_exclusao(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.transferir_historico_e_reservar_exclusao(uuid, uuid, uuid) to service_role;

commit;
