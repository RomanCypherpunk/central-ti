-- A exclusão administrativa primeiro reserva a conta como inativa na mesma
-- transação, para impedir que ela volte a ser usada entre a transferência do
-- histórico e a remoção do usuário de Auth. O gatilho de perfil corretamente
-- bloqueava essa alteração, pois uma Edge Function usa service_role e não tem
-- auth.uid(). Este marcador LOCAL só é definido pela RPC privada abaixo.

begin;

create or replace function public.protege_perfil_usuario()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- Fluxo interno de exclusão. Ele só pode alterar ativo de true para false;
  -- não aprova, não reativa e não modifica perfil. A RPC que define o
  -- marcador é executável exclusivamente por service_role.
  if pg_catalog.current_setting('app.central_ti_account_deletion', true) = 'on'
     and old.ativo
     and not new.ativo
     and new.perfil is not distinct from old.perfil
     and new.status_aprovacao is not distinct from old.status_aprovacao then
    return new;
  end if;

  if new.perfil is not distinct from old.perfil
     and new.status_aprovacao is not distinct from old.status_aprovacao
     and new.ativo is not distinct from old.ativo then
    return new;
  end if;

  if new.perfil is distinct from old.perfil and not public.is_admin() then
    raise exception 'Somente administradores podem alterar o perfil de acesso.'
      using errcode = '42501';
  end if;

  if (new.status_aprovacao is distinct from old.status_aprovacao
      or new.ativo is distinct from old.ativo)
     and not (public.is_equipe_ti() and new.id <> auth.uid()) then
    raise exception 'Somente a equipe de TI pode aprovar ou desativar um cadastro.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

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

  if p_ator_id = p_usuario_id
    or (p_destino_id is not null and p_usuario_id = p_destino_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid-target');
  end if;

  select * into alvo from public.usuarios where id = p_usuario_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'code', 'target-not-found');
  end if;

  if alvo.perfil = 'admin' and alvo.status_aprovacao = 'aprovado' and alvo.ativo then
    select count(*) into total_admins
      from public.usuarios
      where perfil = 'admin' and status_aprovacao = 'aprovado' and ativo;
    if total_admins <= 1 then
      return pg_catalog.jsonb_build_object('ok', false, 'code', 'last-admin');
    end if;
  end if;

  if p_destino_id is not null then
    select * into destino from public.usuarios where id = p_destino_id for update;
    if not found or not destino.ativo or destino.status_aprovacao <> 'aprovado' then
      return pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid-destination');
    end if;
    if alvo.perfil in ('analista', 'admin') and destino.perfil not in ('analista', 'admin') then
      return pg_catalog.jsonb_build_object('ok', false, 'code', 'team-destination-required');
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
  end if;

  perform pg_catalog.set_config('app.central_ti_account_deletion', 'on', true);
  update public.usuarios set ativo = false where id = p_usuario_id;
  return pg_catalog.jsonb_build_object('ok', true, 'foto_path', alvo.foto_path);
end;
$$;

revoke all on function public.transferir_historico_e_reservar_exclusao(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.transferir_historico_e_reservar_exclusao(uuid, uuid, uuid) to service_role;

commit;
