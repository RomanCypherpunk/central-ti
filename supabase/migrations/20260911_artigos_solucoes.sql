-- Base de soluções: amplia a tabela `artigos` para comportar os campos que a
-- tela de nova solução preenche, cria o bucket de anexos e abre as políticas
-- de acesso.
--
-- A tabela `artigos` já existia com: id, titulo, conteudo, categoria_id,
-- unidade_id, autor_id, criado_em, atualizado_em, ativo. Tudo abaixo é adição;
-- nada é removido nem renomeado.

-- ==========================================================================
-- COLUNAS NOVAS
-- ==========================================================================

alter table public.artigos
  -- "erro" ou "procedimento". O tipo define quais campos a tela mostra.
  add column if not exists tipo text
    check (tipo in ('erro', 'procedimento')),

  -- Só para tipo "erro": o código que o ERP exibe (ex: ORA-01722).
  add column if not exists codigo_erro text,

  -- Sintomas e tabelas/campos envolvidos, digitados como etiquetas.
  add column if not exists sintomas text[] not null default '{}',
  add column if not exists tabelas_campos text[] not null default '{}',

  -- Passo a passo. Cada item: { texto, imagens: [url] }.
  add column if not exists passos jsonb not null default '[]'::jsonb,

  -- Anexos. Cada item: { nome, url, tamanho }.
  add column if not exists anexos jsonb not null default '[]'::jsonb,

  -- Caminho dentro do ERP, montado de "nº da página" + "caminho".
  add column if not exists modulo text,

  add column if not exists criticidade text
    check (criticidade in ('baixa', 'media', 'alta', 'critica')),

  -- Outras soluções ligadas a esta.
  add column if not exists relacionadas uuid[] not null default '{}',

  -- Nome de quem resolveu, digitado à mão. Pode não ser quem cadastrou, por
  -- isso é texto livre e não uma referência a usuarios.
  add column if not exists autor text,

  -- Quantas vezes o artigo foi aberto. Alimenta os "mais vistos" da home.
  add column if not exists acessos integer not null default 0;

-- ==========================================================================
-- BUSCA EM PORTUGUÊS
-- ==========================================================================

-- Coluna gerada: o Postgres mantém sozinho a cada insert/update.
alter table public.artigos
  add column if not exists busca tsvector
  generated always as (
    to_tsvector(
      'portuguese',
      coalesce(titulo, '') || ' ' ||
      coalesce(conteudo, '') || ' ' ||
      coalesce(codigo_erro, '') || ' ' ||
      coalesce(modulo, '') || ' ' ||
      array_to_string(sintomas, ' ') || ' ' ||
      array_to_string(tabelas_campos, ' ')
    )
  ) stored;

create index if not exists artigos_busca_idx on public.artigos using gin (busca);
create index if not exists artigos_criado_em_idx on public.artigos (criado_em desc);

-- ==========================================================================
-- ATUALIZADO_EM AUTOMÁTICO
-- ==========================================================================

create or replace function public.tocar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists artigos_atualizado_em on public.artigos;

create trigger artigos_atualizado_em
  before update on public.artigos
  for each row
  execute function public.tocar_atualizado_em();

-- ==========================================================================
-- ROW LEVEL SECURITY
-- ==========================================================================

alter table public.artigos enable row level security;

-- Quem está logado lê os artigos ativos.
drop policy if exists artigos_leitura on public.artigos;

create policy artigos_leitura on public.artigos
  for select
  to authenticated
  using (ativo);

-- Quem está logado cadastra, desde que assine como autor.
drop policy if exists artigos_insercao on public.artigos;

create policy artigos_insercao on public.artigos
  for insert
  to authenticated
  with check (auth.uid() = autor_id);

-- Só quem cadastrou edita ou apaga.
drop policy if exists artigos_edicao on public.artigos;

create policy artigos_edicao on public.artigos
  for update
  to authenticated
  using (auth.uid() = autor_id)
  with check (auth.uid() = autor_id);

drop policy if exists artigos_exclusao on public.artigos;

create policy artigos_exclusao on public.artigos
  for delete
  to authenticated
  using (auth.uid() = autor_id);

-- A tela de nova solução deixa criar categoria na hora, pelo botão "+".
alter table public.categorias enable row level security;

drop policy if exists categorias_leitura on public.categorias;

create policy categorias_leitura on public.categorias
  for select
  to authenticated
  using (true);

drop policy if exists categorias_insercao on public.categorias;

create policy categorias_insercao on public.categorias
  for insert
  to authenticated
  with check (true);

-- ==========================================================================
-- BUCKET DOS ANEXOS
-- ==========================================================================

insert into storage.buckets (id, name, public)
values ('artigos', 'artigos', true)
on conflict (id) do nothing;

-- Qualquer um lê os arquivos (o bucket é público), mas só quem está logado
-- envia, troca ou apaga.
drop policy if exists artigos_arquivos_leitura on storage.objects;

create policy artigos_arquivos_leitura on storage.objects
  for select
  using (bucket_id = 'artigos');

drop policy if exists artigos_arquivos_envio on storage.objects;

create policy artigos_arquivos_envio on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'artigos');

drop policy if exists artigos_arquivos_exclusao on storage.objects;

create policy artigos_arquivos_exclusao on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'artigos');
