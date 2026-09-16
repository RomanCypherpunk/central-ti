-- ============================================================================
-- CHAMADO DE "APROVAÇÃO DE ACESSO" SÓ DEPOIS DE CONFIRMAR O E-MAIL
--
-- Ate aqui handle_new_user() fazia duas coisas no mesmo instante: criava a
-- linha em public.usuarios E abria o chamado que pede a liberacao do acesso.
-- Como o cadastro entrava direto (sem confirmar e-mail), isso bastava.
--
-- Agora o cadastro exige um codigo de 6 digitos enviado por e-mail, entao as
-- duas coisas se separam:
--
--   criacao da conta  -> linha em usuarios (o cadastro precisa dela para
--                        guardar nome/setor/unidade)
--   e-mail confirmado -> chamado de Aprovação de Acesso
--
-- Sem essa separacao o TI receberia um chamado para cada cadastro comecado e
-- abandonado no meio, inclusive de e-mails que ninguem nunca abriu.
-- ============================================================================

-- handle_new_user perde a parte do chamado e passa a so criar o perfil.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_unidade_id uuid;
  v_setor_id uuid;
  v_nome text;
  v_sobrenome text;
begin
  v_unidade_id := nullif(new.raw_user_meta_data ->> 'unidade_id', '')::uuid;
  v_setor_id := nullif(new.raw_user_meta_data ->> 'setor_id', '')::uuid;

  v_nome := nullif(trim(new.raw_user_meta_data ->> 'nome'), '');
  v_sobrenome := nullif(trim(new.raw_user_meta_data ->> 'sobrenome'), '');

  -- Sem nome no metadata sobra o e-mail, como era antes.
  v_nome := coalesce(v_nome, new.email);

  if v_unidade_id is null then
    select id into v_unidade_id from unidades order by nome limit 1;
  end if;

  insert into public.usuarios (id, nome, sobrenome, email, unidade_id, setor_id)
  values (new.id, v_nome, v_sobrenome, new.email, v_unidade_id, v_setor_id);

  return new;
end;
$$;

-- O chamado nasce quando o e-mail e confirmado: email_confirmed_at sai de
-- nulo para uma data. E AFTER UPDATE em auth.users, tabela que o Supabase
-- controla — so lemos a mudanca, nunca escrevemos nela.
create or replace function public.abrir_chamado_de_acesso()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_categoria_id uuid;
  v_fila_id uuid;
  v_unidade_id uuid;
  v_completo text;
begin
  -- So no instante da confirmacao. Qualquer outro update em auth.users
  -- (troca de senha, novo login) passa batido.
  if new.email_confirmed_at is null or old.email_confirmed_at is not null then
    return new;
  end if;

  -- Reconfirmacao nao abre um segundo chamado.
  if exists (
    select 1 from chamados c
    join categorias cat on cat.id = c.categoria_id
    where c.solicitante_id = new.id and cat.nome = 'Aprovação de Acesso'
  ) then
    return new;
  end if;

  select unidade_id, trim(nome || ' ' || coalesce(sobrenome, ''))
    into v_unidade_id, v_completo
  from usuarios where id = new.id;

  select id into v_categoria_id from categorias where nome = 'Aprovação de Acesso';
  select id into v_fila_id from filas where nome = 'Internet, Conexão e Telefonia';

  insert into chamados (solicitante_id, unidade_id, categoria_id, fila_id, descricao)
  values (
    new.id,
    v_unidade_id,
    v_categoria_id,
    v_fila_id,
    format('Solicitação de acesso à Central de TI de %s (%s).', v_completo, new.email)
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_email_confirmed on auth.users;

create trigger on_auth_user_email_confirmed
after update of email_confirmed_at on auth.users
for each row
execute function public.abrir_chamado_de_acesso();
