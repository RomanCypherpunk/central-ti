-- ============================================================================
-- UNIDADES EXPLICITAS NOS ARTIGOS
--
-- A migration anterior usava a convencao "lista vazia = todas as unidades".
-- Funcionava, mas escondia a regra: olhando a linha no banco nao dava para
-- saber se o artigo valia para todo mundo ou se alguem esqueceu de preencher.
-- Agora a lista guarda os ids DE VERDADE — "todas as unidades" quer dizer as
-- 12 marcadas, uma a uma.
--
-- Isso cria um problema que a convencao do vazio resolvia de graca: uma
-- unidade cadastrada depois nao esta em lista nenhuma, e nasceria sem
-- enxergar nada. Por isso o trigger abaixo: toda unidade nova entra
-- automaticamente em todos os artigos que ja existem.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) As listas vazias viram a lista completa
-- ----------------------------------------------------------------------------

update public.artigos
set unidades = (select coalesce(array_agg(id), '{}') from public.unidades where ativo)
where cardinality(unidades) = 0;

-- ----------------------------------------------------------------------------
-- 2) Policy sem o caso especial do vazio
-- ----------------------------------------------------------------------------

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
      -- coalesce porque `null = any(...)` devolve NULL para quem nao tem
      -- unidade no cadastro, e regra de acesso nao pode depender de NULL
      -- se comportar como falso.
      and coalesce(public.minha_unidade_id() = any (unidades), false)
    )
  )
);

-- ----------------------------------------------------------------------------
-- 3) Unidade nova entra em todos os artigos existentes
-- ----------------------------------------------------------------------------

-- Sem isto, criar uma loja no Painel a deixaria sem acesso a nenhuma solucao
-- ja escrita — e ninguem lembraria de reabrir artigo por artigo para inclui-la.
-- O caminho inverso (tirar a unidade de um artigo especifico) continua sendo
-- feito na tela de edicao, que e onde a excecao deve ser decidida.
create or replace function public.incluir_unidade_nos_artigos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update artigos
  set unidades = unidades || new.id
  where not (new.id = any (unidades));

  return new;
end;
$$;

drop trigger if exists unidades_incluir_nos_artigos on public.unidades;

create trigger unidades_incluir_nos_artigos
after insert on public.unidades
for each row
execute function public.incluir_unidade_nos_artigos();
