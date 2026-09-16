-- ============================================================================
-- 1) URGENCIA AUTOMATICA
--
-- Ate aqui nada escrevia em chamados.eh_urgente: a coluna tinha default false
-- e o formulario so mandava cliente_na_loja / sistema_lento_ou_fora. Resultado:
-- todo chamado nascia normal, mesmo com as duas marcacoes de urgencia ligadas
-- (foi o caso do #49, "Impressora com defeito").
--
-- A regra combinada: qualquer uma das duas marcacoes ja torna o chamado
-- urgente. Fica no banco, e nao no JS, porque e uma regra de negocio que vale
-- para qualquer origem (portal, futura migracao, insercao manual) — o front
-- nunca precisa saber calcular urgencia.
-- ============================================================================

create or replace function public.definir_urgencia_chamado()
returns trigger
language plpgsql
as $$
begin
  new.eh_urgente = coalesce(new.cliente_na_loja, false)
                or coalesce(new.sistema_lento_ou_fora, false);

  return new;
end;
$$;

-- BEFORE: precisa alterar a linha antes de gravar, nao depois.
-- Tambem no UPDATE: desmarcar "cliente na loja" na ficha do chamado tem de
-- refletir na urgencia, senao ela congela no valor da abertura.
drop trigger if exists chamados_definir_urgencia on public.chamados;

create trigger chamados_definir_urgencia
before insert or update of cliente_na_loja, sistema_lento_ou_fora
on public.chamados
for each row
execute function public.definir_urgencia_chamado();

-- Retroativo: os chamados ja abertos com as marcacoes ligadas estavam todos
-- como normais. Corrige o historico para bater com a regra nova.
update public.chamados
set eh_urgente = true
where eh_urgente = false
  and (cliente_na_loja = true or sistema_lento_ou_fora = true);

-- ============================================================================
-- 2) TITULO PADRONIZADO COM O NUMERO DO TICKET
--
-- Formato pedido, sempre comecando pelo numero do ticket:
--   com assunto digitado ... "#46 - Impressora com erro"
--   sem assunto ............ "#46 - Aprovacao de Acesso: Enzo"
--   cadastro ............... "#46 - Cadastro de Colaborador: Enzo"
--   desligamento ........... "#46 - Desligamento de Colaborador: Enzo"
--
-- Por que no banco e nao no JS: numero e GENERATED ALWAYS AS IDENTITY, ou
-- seja, so existe DEPOIS do insert — o formulario nao tem como montar "#46"
-- antes de gravar. O JS manda o assunto cru (ou nada) e quem monta o titulo
-- final e este trigger, que tambem cobre chamado criado fora do portal.
--
-- Substitui preencher_titulo_chamado (formato antigo "Categoria | Ticket-N"),
-- que so agia quando o titulo vinha nulo e rodava um UPDATE extra na tabela.
-- ============================================================================

-- O nome do colaborador (cadastro/desligamento) e digitado no formulario e
-- chega em dados_formulario; nos demais o nome e o de quem abriu o chamado.
-- Em ambos os casos so o primeiro nome entra no titulo.
create or replace function public.montar_titulo_chamado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
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

-- BEFORE INSERT: o numero da identity ja esta disponivel em new.numero aqui,
-- entao da para gravar o titulo definitivo de uma vez — sem o UPDATE extra
-- que o trigger antigo precisava fazer depois.
drop trigger if exists chamados_preencher_titulo on public.chamados;
drop trigger if exists chamados_montar_titulo on public.chamados;

create trigger chamados_montar_titulo
before insert on public.chamados
for each row
execute function public.montar_titulo_chamado();

drop function if exists public.preencher_titulo_chamado();

-- ============================================================================
-- 3) LIMITE DE TEXTO NO TITULO E NA DESCRICAO
--
-- Os dois campos eram text sem teto: dava para colar paginas inteiras no
-- assunto, o que arrebenta a tabela do painel e o card do quadro. O limite
-- real mora aqui (e nao so no maxlength do HTML) porque maxlength e so
-- conforto de digitacao — nao vale nada contra uma insercao pela API.
-- ============================================================================

alter table public.chamados
  drop constraint if exists chamados_titulo_tamanho,
  drop constraint if exists chamados_descricao_tamanho;

alter table public.chamados
  add constraint chamados_titulo_tamanho
    check (titulo is null or char_length(titulo) <= 120),
  add constraint chamados_descricao_tamanho
    check (char_length(descricao) <= 1200);
