-- Visualizações de cada solução da Base: cada vez que alguém abre uma
-- solução (na Base ou na triagem do Novo chamado), conta uma. O número
-- aparece no topo do card.
--
-- Contador numa tabela à parte, e não uma coluna em `artigos`: um update em
-- `artigos` dispara os triggers de atualizado_em e do vetor de busca — cada
-- visualização mudaria a data de "atualizado" e recalcularia a busca.
--
-- Ninguém grava direto: só pela função registrar_visualizacao_artigo, que
-- confere se quem chama pode ver aquela solução (mesma regra da policy
-- artigos_leitura) e soma 1.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.artigo_visualizacoes (
  artigo_id uuid primary key references public.artigos(id) on delete cascade,
  total bigint not null default 0 check (total >= 0),
  atualizado_em timestamptz not null default now()
);

comment on table public.artigo_visualizacoes is
  'Quantas vezes cada solução da Base foi aberta. Só muda pela função registrar_visualizacao_artigo.';

alter table public.artigo_visualizacoes enable row level security;

-- Lê o contador quem consegue ver a solução: o exists roda com a RLS de
-- artigos de quem pergunta (aprovado, e do setor, autor ou equipe de TI).
drop policy if exists artigo_visualizacoes_leitura on public.artigo_visualizacoes;
create policy artigo_visualizacoes_leitura
  on public.artigo_visualizacoes for select
  to authenticated
  using (exists (select 1 from public.artigos a where a.id = artigo_visualizacoes.artigo_id));

revoke insert, update, delete on public.artigo_visualizacoes from anon, authenticated;
grant select on public.artigo_visualizacoes to authenticated;

create or replace function public.registrar_visualizacao_artigo(p_artigo_id uuid)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_total bigint;
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada.' using errcode = '42501';
  end if;

  -- Mesma regra da policy artigos_leitura: só conta quem pode abrir.
  if not exists (
    select 1 from public.artigos a
    where a.id = p_artigo_id
      and a.ativo
      and public.is_aprovado()
      and (public.is_equipe_ti() or a.autor_id = auth.uid() or public.meu_setor_id() = any (a.setores))
  ) then
    raise exception 'Solução não encontrada.' using errcode = '42501';
  end if;

  insert into public.artigo_visualizacoes as v (artigo_id, total, atualizado_em)
  values (p_artigo_id, 1, now())
  on conflict (artigo_id) do update
    set total = v.total + 1,
        atualizado_em = now()
  returning v.total into v_total;

  return v_total;
end;
$$;

revoke all on function public.registrar_visualizacao_artigo(uuid) from public, anon;
grant execute on function public.registrar_visualizacao_artigo(uuid) to authenticated;

commit;
