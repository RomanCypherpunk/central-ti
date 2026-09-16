-- ============================================================================
-- BASE DE SOLUÇÕES: UNIDADES NO CONTROLE DE ACESSO E AUTOR VINDO DA CONTA
--
-- 1) Alcance por SETOR **e** UNIDADE
--
-- Ate aqui a policy de leitura so olhava o setor
-- (meu_setor_id() = ANY(setores)). Agora a unidade tambem conta: um
-- procedimento que so vale em algumas lojas nao precisa aparecer para as
-- outras.
--
-- A coluna nova e `unidades` (array), e nao a `unidade_id` (singular) que
-- existia: um artigo vale para VARIAS unidades, igual ja acontece com
-- setores. A unidade_id nunca chegou a ser usada (0 de 5 artigos) — fica
-- onde esta, sem uso, para nao mexer em quem possa ler a coluna.
--
-- Lista VAZIA quer dizer "todas as unidades". Sem isso, `= ANY('{}')` nunca
-- e verdadeiro e o artigo sumiria para todo mundo — inclusive os 5 ja
-- cadastrados. O formulario ja nasce com todas marcadas, entao a lista vazia
-- so acontece em artigo criado por fora.
--
-- 2) Autor deixa de ser digitado
--
-- Havia DUAS fontes para a mesma informacao: `autor_id` (uuid, obrigatorio,
-- gravado sozinho) e `autor` (texto que a pessoa redigitava a cada solucao).
-- A tela mostrava so o texto, por isso o avatar era generico: sem o id nao
-- havia como achar a foto. Agora vale o autor_id, e o texto vira historico.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Coluna de unidades
-- ----------------------------------------------------------------------------

alter table public.artigos
  add column if not exists unidades uuid[] not null default '{}';

-- Os 5 artigos existentes nasceram antes do campo: valem para todas as
-- unidades, que e o padrao combinado.
update public.artigos set unidades = '{}' where unidades is null;

-- ----------------------------------------------------------------------------
-- 2) Autor: o texto antigo sai de cena, o autor_id manda
-- ----------------------------------------------------------------------------

-- So uma pessoa cadastrou solucao ate agora; o autor_id ja aponta para ela.
-- Zerar o texto evita que a tela caia nele por engano mais tarde.
update public.artigos set autor = null where autor is not null;

-- ----------------------------------------------------------------------------
-- 3) Policy de leitura: setor E unidade
-- ----------------------------------------------------------------------------

-- Espelha meu_setor_id(), que a policy ja usava. SECURITY DEFINER porque a
-- policy de artigos precisa ler usuarios sem esbarrar na RLS de usuarios.
create or replace function public.minha_unidade_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select unidade_id from public.usuarios where id = auth.uid();
$$;

drop policy if exists "artigos_leitura" on public.artigos;

create policy "artigos_leitura"
on public.artigos
for select
using (
  ativo
  and public.is_aprovado()
  and (
    -- Quem escreve na Base ve tudo, e o autor sempre ve o proprio artigo.
    public.pode_escrever_artigo()
    or auth.uid() = autor_id
    or (
      public.meu_setor_id() = any (setores)
      -- Lista vazia = todas as unidades. O coalesce trata quem nao tem
      -- unidade no cadastro: `null = any(...)` devolve NULL, e depender de
      -- NULL se comportar como falso numa policy e fragil demais para uma
      -- regra de acesso — melhor dizer "nao ve" com todas as letras.
      and coalesce(
        cardinality(unidades) = 0
        or public.minha_unidade_id() = any (unidades),
        false
      )
    )
  )
);
