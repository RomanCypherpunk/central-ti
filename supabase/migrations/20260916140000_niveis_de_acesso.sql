-- ============================================================================
-- NIVEIS DE ACESSO
--
-- Quatro perfis, do menor para o maior:
--
--   solicitante  abre chamado, le a Base de Solucoes
--   contribuinte + cadastra solucoes na Base
--   analista     + acessa o Portal de chamados do TI (nao acessa o Painel)
--   admin        tudo, inclusive o Painel e a troca de perfil dos outros
--
-- O que muda em relacao ao que existia:
--
-- 1) 'parceiro' vira 'contribuinte' (ninguem usava o perfil antigo).
-- 2) is_equipe_ti() para de incluir o contribuinte: essa funcao guarda os
--    CHAMADOS, e contribuinte nao ve chamado. Como a escrita de artigos
--    tambem usava is_equipe_ti(), a Base ganha uma funcao propria
--    (pode_escrever_artigo) — senao o contribuinte perderia justamente o
--    que define o perfil dele.
-- 3) Trocar o 'perfil' de alguem passa a ser exclusividade do admin. Antes
--    qualquer um podia editar a PROPRIA linha inteira (policy "edita o
--    proprio perfil", sem restricao de coluna), o que na pratica deixava
--    um solicitante se promover a admin pela API. E a policy de editar
--    OUTROS usava is_equipe_ti(), o que daria esse poder ao analista.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) parceiro -> contribuinte
-- ----------------------------------------------------------------------------

-- Ninguem tem 'parceiro' hoje, mas o update deixa a migration segura caso
-- alguem receba o perfil antigo entre escrever isto e aplicar.
update public.usuarios set perfil = 'contribuinte' where perfil = 'parceiro';

alter table public.usuarios drop constraint if exists usuarios_perfil_check;

alter table public.usuarios
  add constraint usuarios_perfil_check
  check (perfil in ('solicitante', 'contribuinte', 'analista', 'admin'));

-- ----------------------------------------------------------------------------
-- 2) Quem e equipe de TI (chamados) x quem escreve na Base
-- ----------------------------------------------------------------------------

-- CHAMADOS: so analista e admin. O contribuinte saiu daqui.
create or replace function public.is_equipe_ti()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from usuarios
    where id = auth.uid()
      and perfil in ('analista', 'admin')
      and status_aprovacao = 'aprovado'
      and ativo
  );
$$;

-- BASE DE SOLUCOES: contribuinte tambem escreve. Funcao separada de
-- is_equipe_ti de proposito — sao duas permissoes diferentes que so por
-- coincidencia tinham a mesma lista antes.
create or replace function public.pode_escrever_artigo()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from usuarios
    where id = auth.uid()
      and perfil in ('contribuinte', 'analista', 'admin')
      and status_aprovacao = 'aprovado'
      and ativo
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from usuarios
    where id = auth.uid()
      and perfil = 'admin'
      and status_aprovacao = 'aprovado'
      and ativo
  );
$$;

-- A escrita de artigos passa a usar a funcao propria da Base.
drop policy if exists "artigos: escrita equipe TI" on public.artigos;

create policy "artigos: escrita de quem pode cadastrar"
on public.artigos
for all
using (public.pode_escrever_artigo())
with check (public.pode_escrever_artigo());

-- A LEITURA continua valendo para todo mundo aprovado, mas quem escreve
-- precisa enxergar o que escreveu: a condicao antiga usava is_equipe_ti(),
-- que o contribuinte deixou de satisfazer.
drop policy if exists "artigos_leitura" on public.artigos;

create policy "artigos_leitura"
on public.artigos
for select
using (
  ativo
  and public.is_aprovado()
  and (
    public.pode_escrever_artigo()
    or auth.uid() = autor_id
    or public.meu_setor_id() = any (setores)
  )
);

-- ----------------------------------------------------------------------------
-- 3) So admin muda o perfil de alguem
-- ----------------------------------------------------------------------------

-- O controle vai num TRIGGER, e nao no WITH CHECK da policy: dentro do
-- WITH CHECK um subselect na propria tabela le a linha em estado ambiguo
-- (nao da para comparar "valor novo x valor antigo" de forma confiavel).
-- Num BEFORE UPDATE o OLD e o NEW sao explicitos, que e exatamente o que
-- esta regra precisa comparar.
create or replace function public.protege_perfil_usuario()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Nada mudou no que e sensivel: segue o jogo.
  if new.perfil is not distinct from old.perfil
     and new.status_aprovacao is not distinct from old.status_aprovacao
     and new.ativo is not distinct from old.ativo then
    return new;
  end if;

  -- Trocar o PERFIL de alguem (inclusive o proprio) e so do admin.
  if new.perfil is distinct from old.perfil and not public.is_admin() then
    raise exception 'Somente administradores podem alterar o perfil de acesso.'
      using errcode = '42501';
  end if;

  -- Aprovar/reativar cadastro: equipe de TI resolve, mas nunca o proprio
  -- usuario em si mesmo (senao um cadastro pendente se auto-aprova).
  if (new.status_aprovacao is distinct from old.status_aprovacao
      or new.ativo is distinct from old.ativo)
     and not (public.is_equipe_ti() and new.id <> auth.uid()) then
    raise exception 'Somente a equipe de TI pode aprovar ou desativar um cadastro.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists usuarios_protege_perfil on public.usuarios;

create trigger usuarios_protege_perfil
before update on public.usuarios
for each row
execute function public.protege_perfil_usuario();

-- Com o trigger cuidando das colunas sensiveis, as policies voltam a ser
-- simples: cada um edita a propria linha, equipe de TI edita as outras.
drop policy if exists "usuarios: edita o próprio perfil" on public.usuarios;
drop policy if exists "usuarios: edita os próprios dados" on public.usuarios;

create policy "usuarios: edita os próprios dados"
on public.usuarios
for update
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "usuarios: equipe TI aprova e edita outros" on public.usuarios;
drop policy if exists "usuarios: equipe TI edita outros" on public.usuarios;

create policy "usuarios: equipe TI edita outros"
on public.usuarios
for update
using (public.is_equipe_ti())
with check (public.is_equipe_ti());
