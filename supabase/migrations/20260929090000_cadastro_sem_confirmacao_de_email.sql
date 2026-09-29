-- ============================================================================
-- CADASTRO SEM CODIGO POR E-MAIL: O CHAMADO DE ACESSO CONTINUA NASCENDO
--
-- O provedor de e-mail bloqueava ou atrasava parte das mensagens, e o
-- cadastro travava esperando um codigo que nao chegava. A confirmacao de
-- e-mail foi desligada (Authentication > Providers > Email > Confirm email).
--
-- O risco disso ficava escondido no banco. Desde a migration
-- 20260916170000_chamado_de_acesso_apos_confirmar_email.sql, o chamado de
-- "Aprovação de Acesso" so nasce num gatilho AFTER UPDATE OF
-- email_confirmed_at — isto e, quando o e-mail PASSA de nao confirmado para
-- confirmado. Com a confirmacao desligada, a conta pode ja nascer
-- confirmada, esse UPDATE nunca acontece, e o TI deixaria de receber os
-- pedidos de acesso sem nenhum erro aparecer em lugar nenhum.
--
-- A correcao cobre os dois caminhos:
--
--   conta que ja nasce confirmada -> handle_new_user abre o chamado, logo
--                                    depois de criar a linha em usuarios.
--   conta confirmada depois       -> o gatilho de UPDATE continua valendo
--                                    (contas antigas pendentes, ou se um dia
--                                    a confirmacao voltar a ser ligada).
--
-- Por que dentro do handle_new_user, e nao num gatilho de INSERT novo: o
-- chamado precisa ler nome e unidade da linha em usuarios, que e o
-- handle_new_user quem cria. Dois gatilhos AFTER INSERT na mesma tabela
-- rodam em ordem alfabetica de nome — e o gatilho do handle_new_user foi
-- criado fora das migrations, entao o nome dele nao esta garantido aqui.
-- Fazendo as duas coisas na mesma funcao, a ordem fica certa por construcao.
--
-- Os dois caminhos passam pela mesma funcao, que nao abre um segundo chamado
-- para quem ja tem um — entao nao ha duplicata mesmo que os dois disparem.
-- ============================================================================

-- O chamado em si, num lugar so.
create or replace function public.criar_chamado_de_acesso(p_usuario_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_categoria_id uuid;
  v_fila_id uuid;
  v_unidade_id uuid;
  v_completo text;
begin
  -- Um chamado de acesso por pessoa: reconfirmar, ou os dois caminhos acima
  -- dispararem para a mesma conta, nao abre outro.
  if exists (
    select 1 from chamados c
    join categorias cat on cat.id = c.categoria_id
    where c.solicitante_id = p_usuario_id and cat.nome = 'Aprovação de Acesso'
  ) then
    return;
  end if;

  select unidade_id, trim(nome || ' ' || coalesce(sobrenome, ''))
    into v_unidade_id, v_completo
  from usuarios where id = p_usuario_id;

  select id into v_categoria_id from categorias where nome = 'Aprovação de Acesso';
  select id into v_fila_id from filas where nome = 'Internet, Conexão e Telefonia';

  insert into chamados (solicitante_id, unidade_id, categoria_id, fila_id, descricao)
  values (
    p_usuario_id,
    v_unidade_id,
    v_categoria_id,
    v_fila_id,
    format('Solicitação de acesso à Central de TI de %s (%s).', v_completo, p_email)
  );
end;
$$;

-- Funcao interna: so os gatilhos chamam. Sem isto ela ficaria exposta como
-- RPC e qualquer pessoa logada poderia abrir chamados em nome de outra.
revoke execute on function public.criar_chamado_de_acesso(uuid, text) from public, anon, authenticated;

-- handle_new_user: mesmo corpo da 20260916170000, com o search_path da
-- 20260921090000_security_authorization_hardening.sql, mais o chamado para
-- quem ja nasce confirmado.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
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

  -- A NOVIDADE: conta que ja nasce confirmada (confirmacao de e-mail
  -- desligada) nao passa pelo gatilho de UPDATE, entao o chamado sai daqui.
  if new.email_confirmed_at is not null then
    perform public.criar_chamado_de_acesso(new.id, new.email);
  end if;

  return new;
end;
$$;

-- O caminho antigo continua, agora usando a mesma funcao.
create or replace function public.abrir_chamado_de_acesso()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- So no instante da confirmacao. Qualquer outro update em auth.users
  -- (troca de senha, novo login) passa batido.
  if new.email_confirmed_at is null or old.email_confirmed_at is not null then
    return new;
  end if;

  perform public.criar_chamado_de_acesso(new.id, new.email);

  return new;
end;
$$;
