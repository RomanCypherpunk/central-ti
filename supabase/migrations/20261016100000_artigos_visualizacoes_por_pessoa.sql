-- Quem viu cada solução, e quantas vezes. Complementa o contador geral
-- (20261016090000_artigos_visualizacoes): o total continua para todos; o
-- detalhe por pessoa SÓ o administrador lê (clicando no olho do card).
--
-- As visualizações de antes desta migration ficam só no total — não havia
-- registro de quem foi.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.artigo_visualizacoes_por_pessoa (
  artigo_id uuid not null references public.artigos(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  total bigint not null default 0 check (total >= 0),
  primeira_em timestamptz not null default now(),
  ultima_em timestamptz not null default now(),
  primary key (artigo_id, usuario_id)
);

comment on table public.artigo_visualizacoes_por_pessoa is
  'Quantas vezes cada pessoa abriu cada solução. Só administrador lê; só muda pela função registrar_visualizacao_artigo.';

alter table public.artigo_visualizacoes_por_pessoa enable row level security;

-- SÓ ADMINISTRADOR: nem a equipe de TI nem o autor da solução veem quem leu.
drop policy if exists artigo_visualizacoes_por_pessoa_admin on public.artigo_visualizacoes_por_pessoa;
create policy artigo_visualizacoes_por_pessoa_admin
  on public.artigo_visualizacoes_por_pessoa for select
  to authenticated
  using (public.is_admin());

revoke insert, update, delete on public.artigo_visualizacoes_por_pessoa from anon, authenticated;
grant select on public.artigo_visualizacoes_por_pessoa to authenticated;

-- A mesma função de antes, agora somando também na linha da pessoa.
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

  insert into public.artigo_visualizacoes_por_pessoa as p (artigo_id, usuario_id, total, primeira_em, ultima_em)
  values (p_artigo_id, auth.uid(), 1, now(), now())
  on conflict (artigo_id, usuario_id) do update
    set total = p.total + 1,
        ultima_em = now();

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
