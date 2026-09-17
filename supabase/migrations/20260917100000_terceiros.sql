-- ============================================================================
-- TERCEIROS (FORNECEDORES) NO CHAMADO
--
-- Pedido do usuario: quando a equipe de TI aciona um fornecedor externo
-- (Vivo, Sematec, RealConnect, LocaWeb, DBCore — a internet caiu no meio de
-- um chamado de rede, por exemplo), o sistema precisa registrar quem estava
-- atendendo, para medir SLA por fornecedor no painel de Atendentes — sem
-- criar uma conta de login para cada um, porque eles nunca acessam o Portal.
--
-- Por isso duas tabelas novas em vez de reaproveitar chamado_membros:
--   terceiros            mesmo desenho de unidades/setores (id, nome, ativo)
--   chamado_terceiros    mesmo desenho de chamado_membros (chamado_id +
--                        terceiro_id), so que aponta pra terceiros em vez
--                        de usuarios — um chamado_membros.usuario_id NOT
--                        NULL apontando pra uma linha fake em usuarios
--                        teria efeito colateral em TUDO que já confia que
--                        membro = pessoa com login (SLA de atendente, RLS,
--                        o "quem responde vira membro" do chat).
--
-- SLA do terceiro = tempo do chamado inteiro (abertura a fechamento), igual
-- ao atendente interno — decisao do usuario, por simplicidade.
-- ============================================================================

create table public.terceiros (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

alter table public.terceiros enable row level security;

-- Leitura: todo aprovado ve a lista (precisa aparecer no seletor do Portal
-- pra qualquer analista/admin escolher). Escrita: so equipe de TI, mesma
-- regra das outras listas do Painel (unidades/setores/categorias).
create policy "terceiros: leitura de quem esta aprovado"
on public.terceiros
for select
using (is_aprovado());

create policy "terceiros: escrita da equipe de TI"
on public.terceiros
for all
using (is_equipe_ti())
with check (is_equipe_ti());

create table public.chamado_terceiros (
  chamado_id uuid not null references public.chamados(id) on delete cascade,
  terceiro_id uuid not null references public.terceiros(id),
  adicionado_em timestamptz not null default now(),
  primary key (chamado_id, terceiro_id)
);

alter table public.chamado_terceiros enable row level security;

-- Mesma regra de chamado_membros: equipe de TI gerencia; o solicitante do
-- chamado tambem ve quem foi acionado (mesma transparencia que ja tem sobre
-- os membros humanos).
create policy "chamado_terceiros: equipe TI gerencia"
on public.chamado_terceiros
for all
using (is_equipe_ti())
with check (is_equipe_ti());

create policy "chamado_terceiros: solicitante ve os do proprio chamado"
on public.chamado_terceiros
for select
using (
  exists (
    select 1 from chamados c
    where c.id = chamado_terceiros.chamado_id
      and c.solicitante_id = auth.uid()
  )
);

-- Os 5 fornecedores atuais, ja citados pelo usuario.
insert into public.terceiros (nome) values
  ('Vivo'), ('Sematec'), ('RealConnect'), ('LocaWeb'), ('DBCore');
