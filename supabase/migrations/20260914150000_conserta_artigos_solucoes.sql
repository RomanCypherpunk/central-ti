-- Conserta a Base de Soluções: a migration 20260911_artigos_solucoes.sql
-- nunca aplicou (42P17 "generation expression is not immutable" —
-- array_to_string() sobre text[] dentro de coluna GENERATED ALWAYS AS ...
-- STORED não é aceito como immutable neste banco), então nenhuma das
-- colunas que nova-solucao.js grava existe. Testado em 2026-09-14: salvar
-- falha com PGRST204 "Could not find the 'anexos' column".
--
-- Cria só o que o front-end usa hoje (nova-solucao.js): tipo, codigo_erro,
-- sintomas, passos, anexos, modulo, relacionadas, autor. Ficam de fora
-- tabelas_campos, criticidade e acessos — previstos na migration antiga,
-- mas sem uso no formulário atual; entram numa migration própria se algum
-- dia o front passar a usá-los.
--
-- categoria_id e busca_vetor (coluna gerada com titulo+conteudo) já
-- existiam antes desta migration; ficam como estão.

-- ==========================================================================
-- COLUNAS NOVAS
-- ==========================================================================

alter table public.artigos
  -- "erro" ou "procedimento". O tipo define quais campos a tela mostra.
  add column if not exists tipo text
    check (tipo in ('erro', 'procedimento')),

  -- Só para tipo "erro": o código que o ERP exibe (ex: ORA-01722).
  add column if not exists codigo_erro text,

  -- Sintomas e palavras-chave, digitados como etiquetas.
  add column if not exists sintomas text[] not null default '{}',

  -- Passo a passo. Cada item: { ordem, texto, imagens: [{ nome, url }] }.
  add column if not exists passos jsonb not null default '[]'::jsonb,

  -- Anexos. Cada item: { nome, url }.
  add column if not exists anexos jsonb not null default '[]'::jsonb,

  -- Caminho dentro do ERP, montado de "nº da página" + "caminho".
  add column if not exists modulo text,

  -- Outras soluções ligadas a esta.
  add column if not exists relacionadas uuid[] not null default '{}',

  -- Nome de quem resolveu, digitado à mão. Pode não ser quem cadastrou, por
  -- isso é texto livre e não uma referência a usuarios.
  add column if not exists autor text;

-- ==========================================================================
-- BUSCA: A COLUNA GERADA JA EXISTIA (busca_vetor, so titulo+conteudo).
-- array_to_string(sintomas, ' ') nao entra numa expressao gerada — e
-- exatamente essa combinacao que o Postgres recusa como immutable neste
-- banco. Um trigger, em vez de coluna gerada, contorna a restricao: o
-- trigger roda em PL/pgSQL, fora da checagem de immutabilidade do planner.
--
-- Por isso a coluna precisa deixar de ser GENERATED antes do trigger poder
-- escrever nela — Postgres recusa UPDATE/INSERT explicito numa coluna
-- gerada, mesmo vindo de um trigger BEFORE.
-- ==========================================================================

alter table public.artigos alter column busca_vetor drop expression if exists;

create or replace function public.artigos_atualizar_busca()
returns trigger
language plpgsql
as $$
begin
  new.busca_vetor := to_tsvector(
    'portuguese',
    coalesce(new.titulo, '') || ' ' ||
    coalesce(new.conteudo, '') || ' ' ||
    coalesce(new.codigo_erro, '') || ' ' ||
    coalesce(new.modulo, '') || ' ' ||
    array_to_string(new.sintomas, ' ')
  );
  return new;
end;
$$;

drop trigger if exists artigos_busca_vetor on public.artigos;

create trigger artigos_busca_vetor
  before insert or update on public.artigos
  for each row
  execute function public.artigos_atualizar_busca();

-- Preenche o que já existe (registros cadastrados antes do trigger existir).
update public.artigos set titulo = titulo;

create index if not exists artigos_busca_idx on public.artigos using gin (busca_vetor);
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
-- ROW LEVEL SECURITY: SO A POLICY DE SETOR SOBREVIVE
-- ==========================================================================

-- Havia duas policies de SELECT: "artigos: leitura autenticada" (mais
-- permissiva, ativo OR is_equipe_ti — liberava qualquer artigo ativo para
-- qualquer autenticado, sem arquivo de migration correspondente) e
-- "artigos_leitura" (a regra por setor, de 20260914120000). Como policies
-- de SELECT se combinam com OR, a mais permissiva vencia e a regra de
-- setor não tinha efeito. Derruba a antiga para a regra de setor valer.
drop policy if exists "artigos: leitura autenticada" on public.artigos;

-- Escrita: só equipe de TI cadastra, edita e apaga — decisão de produto,
-- igual à policy que já existia. Recriada aqui, idempotente, para o
-- arquivo desta migration não depender da 20260911 (que nunca aplicou).
drop policy if exists "artigos: escrita equipe TI" on public.artigos;

create policy "artigos: escrita equipe TI" on public.artigos
  for all
  to authenticated
  using (is_equipe_ti())
  with check (is_equipe_ti());

-- ==========================================================================
-- BUCKET DOS ANEXOS E IMAGENS DO PASSO A PASSO
-- ==========================================================================

insert into storage.buckets (id, name, public)
values ('artigos', 'artigos', true)
on conflict (id) do nothing;

-- Qualquer um lê os arquivos (o bucket é público, mesmo padrão do avatares),
-- mas só a equipe de TI envia, troca ou apaga — acompanha quem pode
-- cadastrar solução.
drop policy if exists artigos_arquivos_leitura on storage.objects;

create policy artigos_arquivos_leitura on storage.objects
  for select
  using (bucket_id = 'artigos');

drop policy if exists artigos_arquivos_envio on storage.objects;

create policy artigos_arquivos_envio on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'artigos' and is_equipe_ti());

drop policy if exists artigos_arquivos_troca on storage.objects;

create policy artigos_arquivos_troca on storage.objects
  for update
  to authenticated
  using (bucket_id = 'artigos' and is_equipe_ti());

drop policy if exists artigos_arquivos_exclusao on storage.objects;

create policy artigos_arquivos_exclusao on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'artigos' and is_equipe_ti());
