-- LISTA DE ENTRADA POR CATEGORIA: no Painel, aba Listas, cada lista pode
-- "receber direto" chamados de uma ou mais categorias. Ex.: criar a lista
-- "Cadastro de colaborador" e marcar a categoria Cadastro de Colaborador —
-- todo chamado novo dessa categoria nasce nela, em vez do Inbox.
--
-- A regra mora na categoria (categorias.fila_entrada_id), e nao na lista:
-- assim uma categoria nunca aponta para duas listas ao mesmo tempo.
-- Quem configura e so o administrador, pela funcao
-- definir_categorias_da_lista (que grava a lista inteira de uma vez).
--
-- So vale para chamado NOVO (gatilho no INSERT); o que ja existe fica onde
-- esta. Lista arquivada nao recebe: o chamado segue o caminho normal.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.categorias
  add column if not exists fila_entrada_id uuid references public.filas(id) on delete set null;

comment on column public.categorias.fila_entrada_id is
  'Lista onde todo chamado novo desta categoria entra direto (configurado no Painel, aba Listas). Nulo: segue o caminho normal (Inbox).';

create or replace function public.aplicar_fila_de_entrada_da_categoria()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_fila_id uuid;
begin
  if new.categoria_id is null then
    return new;
  end if;

  select c.fila_entrada_id
    into v_fila_id
    from public.categorias c
    join public.filas f on f.id = c.fila_entrada_id and f.ativo
   where c.id = new.categoria_id;

  if v_fila_id is not null then
    new.fila_id := v_fila_id;
  end if;

  return new;
end;
$$;

revoke all on function public.aplicar_fila_de_entrada_da_categoria() from public, anon, authenticated;

-- "zz" no nome: gatilhos BEFORE do mesmo evento rodam em ordem alfabetica,
-- entao este roda por ultimo e a regra configurada no Painel vence o
-- roteamento antigo por categoria, se os dois existirem.
drop trigger if exists chamados_zz_fila_de_entrada_da_categoria on public.chamados;
create trigger chamados_zz_fila_de_entrada_da_categoria
before insert on public.chamados
for each row execute function public.aplicar_fila_de_entrada_da_categoria();

-- CONFIGURAR UMA LISTA: recebe a lista e as categorias que devem cair nela.
-- As marcadas passam a apontar para a lista (saindo de outra, se estavam
-- em outra); as que apontavam para ela e foram desmarcadas voltam para o
-- caminho normal. Tudo numa transacao so.
create or replace function public.definir_categorias_da_lista(p_fila_id uuid, p_categorias uuid[])
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente administradores podem configurar as listas.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.filas where id = p_fila_id) then
    raise exception 'Lista não encontrada.' using errcode = 'P0002';
  end if;

  update public.categorias
     set fila_entrada_id = null
   where fila_entrada_id = p_fila_id
     and not (id = any (coalesce(p_categorias, '{}')));

  update public.categorias
     set fila_entrada_id = p_fila_id
   where id = any (coalesce(p_categorias, '{}'));
end;
$$;

revoke all on function public.definir_categorias_da_lista(uuid, uuid[]) from public, anon;
grant execute on function public.definir_categorias_da_lista(uuid, uuid[]) to authenticated;

commit;
