-- Desmembra o nome do usuário em duas colunas: `nome` passa a guardar só o
-- primeiro nome (o que aparece na saudação da home e nos cards do Portal) e
-- `sobrenome` guarda o resto.
--
-- Antes, `nome` era o nome completo e cada tela recortava o que precisava no
-- JavaScript. Guardar separado deixa a pessoa decidir como quer ser chamada:
-- "João Paulo" e "João Gabriel" são dois nomes compostos que, cortados na
-- primeira palavra, virariam dois "João" iguais no quadro.

alter table public.usuarios
  add column if not exists sobrenome text;

-- Os três cadastros que já existem, divididos como o time pediu. São poucos e
-- todos da equipe, então vale gravar na mão em vez de adivinhar por regra.
update public.usuarios
set nome = 'João Paulo', sobrenome = 'Cardoso Antunes'
where email = 'joao.paulo@madeirasgasometro.com.br';

update public.usuarios
set nome = 'João Gabriel', sobrenome = 'Arantes'
where email = 'joao.gabriel@madeirasgasometro.com.br';

update public.usuarios
set nome = 'Enzo', sobrenome = 'Xavier'
where email = 'enzo.xavier@madeirasgasometro.com.br';

-- Quem por acaso tenha escapado dos updates acima (cadastro feito entre o
-- deploy e esta migration) fica com a 1ª palavra no nome e o resto no
-- sobrenome, em vez de ficar com o nome completo no campo do primeiro nome.
-- O SET lê todos os valores da linha antes de gravar, então `nome` dos dois
-- lados é o valor original — mas deixo explícito com a subconsulta para não
-- depender de leitura atenta de quem revisar depois.
update public.usuarios as u
set nome = split_part(o.nome, ' ', 1),
    sobrenome = nullif(trim(substr(o.nome, strpos(o.nome, ' ') + 1)), '')
from public.usuarios as o
where o.id = u.id
  and u.sobrenome is null
  and u.nome like '% %';

comment on column public.usuarios.nome is
  'Primeiro nome (pode ser composto: "João Paulo"). É o que aparece na saudação e nos cards.';
comment on column public.usuarios.sobrenome is
  'Sobrenome. Junto com nome forma o nome completo mostrado no detalhe do chamado.';

-- O cadastro passa a mandar nome e sobrenome separados no metadata do signUp.
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
  v_nome text;
  v_sobrenome text;
  v_completo text;
begin
  v_unidade_id := nullif(new.raw_user_meta_data ->> 'unidade_id', '')::uuid;
  v_setor_id := nullif(new.raw_user_meta_data ->> 'setor_id', '')::uuid;

  v_nome := nullif(trim(new.raw_user_meta_data ->> 'nome'), '');
  v_sobrenome := nullif(trim(new.raw_user_meta_data ->> 'sobrenome'), '');

  -- Sem nome no metadata sobra o e-mail, como era antes.
  v_nome := coalesce(v_nome, new.email);
  v_completo := trim(v_nome || ' ' || coalesce(v_sobrenome, ''));

  if v_unidade_id is null then
    select id into v_unidade_id from unidades order by nome limit 1;
  end if;

  insert into public.usuarios (id, nome, sobrenome, email, unidade_id, setor_id)
  values (new.id, v_nome, v_sobrenome, new.email, v_unidade_id, v_setor_id);

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
$function$;
