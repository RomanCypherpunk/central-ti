-- ============================================================================
-- TÍTULO DO CHAMADO COM A PRIMEIRA LETRA MAIÚSCULA
--
-- O assunto digitado no formulário chega ao Portal assim:
--   "RETORNAR PEDIDO 123456"  ->  "#297 - Retornar pedido 123456"
--
-- Regra: a primeira letra sempre sobe. Se o assunto veio TODO em maiúsculas,
-- o resto desce para minúsculas; se já tem mistura ("Erro no NL"), o resto é
-- preservado para não estragar siglas. Só mexe no assunto digitado: os títulos
-- montados pela categoria ("Cadastro: Enzo") continuam como estavam.
-- Vale para chamados novos; os já abertos não são alterados.
-- ============================================================================

create or replace function public.montar_titulo_chamado()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  v_tipo text;
  v_assunto text;
  v_nome text;
  v_rotulo text;
begin
  v_tipo := new.dados_formulario->>'tipo';
  v_assunto := nullif(btrim(coalesce(new.titulo, new.dados_formulario->>'assunto', '')), '');

  -- Assunto digitado manda: e o que a pessoa escreveu para descrever o caso.
  -- O corte garante que o titulo final (prefixo "#46 - " incluso) caiba nos
  -- 120 do CHECK: o maxlength do formulario limita o assunto, mas insercao
  -- pela API nao passa por ele, e ai o chamado seria recusado.
  if v_assunto is not null then
    if v_assunto = upper(v_assunto) then
      v_assunto := lower(v_assunto);
    end if;

    v_assunto := upper(left(v_assunto, 1)) || substr(v_assunto, 2);

    new.titulo := left(format('#%s - %s', new.numero, v_assunto), 120);
    return new;
  end if;

  -- O rotulo e SEMPRE o nome da categoria, venha o chamado de qual origem
  -- vier: "#46 - Cadastro: Enzo" tanto pelo formulario quanto por fora dele.
  select nome into v_rotulo from categorias where id = new.categoria_id;

  -- SO estas tres categorias levam nome no titulo; toda outra fica
  -- "#46 - Pedidos". Sao os chamados sobre uma PESSOA, onde saber de quem se
  -- trata bate o olho antes de abrir a ficha.
  if v_rotulo in ('Cadastro', 'Desligamento', 'Aprovação de Acesso') then
    if v_tipo in ('cadastro', 'desligamento') then
      -- Pelo formulario, o nome do COLABORADOR foi digitado num campo unico
      -- ("Enzo Xavier Santos"), entao o primeiro nome sai no primeiro espaco.
      v_nome := split_part(btrim(coalesce(new.dados_formulario->'colaborador'->>'nome', '')), ' ', 1);
    else
      -- Fora do formulario o nome e o de quem abriu. usuarios.nome ja guarda
      -- SO o primeiro nome (o resto fica em sobrenome), entao vai inteiro:
      -- cortar no primeiro espaco quebraria primeiro nome composto —
      -- "João Gabriel" viraria "João".
      select nome into v_nome from usuarios where id = new.solicitante_id;
    end if;
  end if;

  v_nome := nullif(btrim(coalesce(v_nome, '')), '');
  v_rotulo := coalesce(nullif(btrim(coalesce(v_rotulo, '')), ''), 'Chamado');

  if v_nome is null then
    new.titulo := left(format('#%s - %s', new.numero, v_rotulo), 120);
  else
    new.titulo := left(format('#%s - %s: %s', new.numero, v_rotulo, v_nome), 120);
  end if;

  return new;
end;
$$;
