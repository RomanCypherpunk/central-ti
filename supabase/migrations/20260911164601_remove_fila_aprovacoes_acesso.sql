-- Remove a fila "Aprovações de Acesso": os pedidos de acesso passam a cair
-- direto em "Internet, Conexão e Telefonia", junto com o resto do atendimento.

-- Chamados que estavam nela (e o historico de quem passou por ela) mudam de fila.
update chamados
set fila_id = (select id from filas where nome = 'Internet, Conexão e Telefonia')
where fila_id = (select id from filas where nome = 'Aprovações de Acesso');

update chamados
set fila_anterior_id = null
where fila_anterior_id = (select id from filas where nome = 'Aprovações de Acesso');

delete from chamado_retorno_pendente
where fila_destino_id = (select id from filas where nome = 'Aprovações de Acesso');

-- O trigger de cadastro apontava para a fila que esta sendo removida.
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
  select id into v_fila_id from filas where nome = 'Internet, Conexão e Telefonia';

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

delete from filas where nome = 'Aprovações de Acesso';
