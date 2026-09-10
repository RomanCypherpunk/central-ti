-- Corrige handle_new_user(): a versão anterior fazia INSERT seguido de
-- UPDATE em public.usuarios para gravar setor_id/unidade_id. Esse UPDATE
-- disparava a trigger usuarios_bloquear_autoaprovacao (que impede
-- alteração de setor_id por quem não é da equipe de TI), derrubando a
-- transação inteira e quebrando o signUp com erro 500.
--
-- A trigger de bloqueio só reage a UPDATE, não a INSERT — por isso a
-- correção é gravar setor_id/unidade_id já no INSERT original, sem UPDATE
-- separado. Mantém o mesmo comportamento: fallback de unidade quando não
-- informada, e abertura do chamado de aprovação de acesso.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_unidade_id uuid;
  v_setor_id uuid;
  v_categoria_id uuid;
  v_fila_id uuid;
begin
  v_unidade_id := nullif(new.raw_user_meta_data ->> 'unidade_id', '')::uuid;
  v_setor_id := nullif(new.raw_user_meta_data ->> 'setor_id', '')::uuid;

  if v_unidade_id is null then
    select id into v_unidade_id from unidades order by nome limit 1;
  end if;

  insert into public.usuarios (id, nome, email, unidade_id, setor_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nome', new.email),
    new.email,
    v_unidade_id,
    v_setor_id
  );

  select id into v_categoria_id from categorias where nome = 'Aprovação de Acesso';
  select id into v_fila_id from filas where nome = 'Aprovações de Acesso';

  insert into chamados (solicitante_id, unidade_id, categoria_id, fila_id, descricao)
  values (
    new.id,
    v_unidade_id,
    v_categoria_id,
    v_fila_id,
    format('Solicitação de acesso à Central de TI de %s (%s).', coalesce(new.raw_user_meta_data ->> 'nome', new.email), new.email)
  );

  return new;
end;
$function$;
