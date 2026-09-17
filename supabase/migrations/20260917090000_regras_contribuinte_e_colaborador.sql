-- ============================================================================
-- REGRAS NOVAS: CONTRIBUINTE RESTRITO AO PROPRIO SETOR, ACESSO A
-- CADASTRO/DESLIGAMENTO SO PARA QUEM GERENCIA GENTE, E CONTRIBUINTE NUNCA
-- EXCLUI SOLUÇÃO
--
-- Pedido do usuario, quatro itens (o de captcha ficou de fora por enquanto,
-- decisao dele):
--
--  1) Contribuinte so marca o PROPRIO setor ao criar/editar solucao — exceto
--     Lider de Logistica e Lider de Vendas, que podem marcar os dois setores
--     deles juntos (Logistica + Vendas). Unidades continuam livres.
--  2) So Admin, Recursos Humanos, Lider de Logistica, Lider de Vendas e
--     Gestor da Unidade podem abrir chamado de Cadastro/Desligamento de
--     colaborador — escondido na tela E bloqueado na RLS.
--  4) Contribuinte edita so o que ELE MESMO cadastrou, e nunca exclui
--     solucao nenhuma (nem a propria). Admin/analista continuam com
--     edicao e exclusao irrestritas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Setores que um contribuinte pode marcar ao escrever um artigo
-- ----------------------------------------------------------------------------

-- Falta uma funcao que devolva o NOME do setor (so existia meu_setor_id).
create or replace function public.meu_setor_nome()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.nome
  from usuarios u
  join setores s on s.id = u.setor_id
  where u.id = auth.uid();
$$;

-- Devolve os setores que a PESSOA LOGADA pode marcar num artigo que ela
-- mesma esta criando/editando. Regra especial: quem e "Líder de Logística"
-- ou "Líder de Vendas" pode marcar os dois setores de negocio (Logística e
-- Vendas), nao so o proprio — sao os dois times que essas lideranças
-- respondem. Todo mundo mais so marca o proprio setor.
--
-- So vale para quem tem setor_id preenchido; sem setor, lista vazia (nao
-- pode marcar nada).
create or replace function public.setores_permitidos_para_artigo()
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when meu_setor_nome() in ('Líder de Logística', 'Líder de Vendas') then (
      select coalesce(array_agg(id), '{}')
      from setores
      where nome in ('Logística', 'Vendas', 'Líder de Logística', 'Líder de Vendas')
    )
    else (
      select case when meu_setor_id() is null then '{}'::uuid[] else array[meu_setor_id()] end
    )
  end;
$$;

-- ----------------------------------------------------------------------------
-- 2) Escrita de artigos: contribuinte trava no proprio alcance de setor;
--    admin/analista continuam livres. E ninguem alem do proprio autor edita,
--    e so admin/analista excluem.
-- ----------------------------------------------------------------------------

drop policy if exists "artigos: escrita de quem pode cadastrar" on public.artigos;

-- INSERT: quem pode escrever (contribuinte/analista/admin), e se for
-- contribuinte os setores marcados tem que estar TODOS dentro do que
-- setores_permitidos_para_artigo() devolve (<@ = "esta contido em").
create policy "artigos: contribuinte insere no proprio alcance"
on public.artigos
for insert
with check (
  pode_escrever_artigo()
  -- cardinality > 0: sem isto um array vazio passaria "contido" em
  -- qualquer alcance (o operador <@ trata {} como subconjunto de tudo),
  -- e um artigo sem setor nenhum ficaria invisivel para todo mundo
  -- (a policy de leitura exige meu_setor_id() = any(setores)).
  and cardinality(setores) > 0
  and (
    is_equipe_ti() -- analista/admin: sem restricao de setor
    or setores <@ setores_permitidos_para_artigo()
  )
);

-- UPDATE: analista/admin editam qualquer artigo. Contribuinte so edita o
-- que ele mesmo criou (autor_id = auth.uid()), e so consegue gravar setores
-- dentro do proprio alcance — nao dá pra "escapar" pro setor de outro
-- editando depois de criado.
create policy "artigos: contribuinte edita so o proprio"
on public.artigos
for update
using (
  is_equipe_ti()
  or (pode_escrever_artigo() and auth.uid() = autor_id)
)
with check (
  is_equipe_ti()
  or (
    pode_escrever_artigo()
    and auth.uid() = autor_id
    and cardinality(setores) > 0
    and setores <@ setores_permitidos_para_artigo()
  )
);

-- DELETE: exclusiva de quem e equipe de TI (analista/admin). Contribuinte
-- nunca exclui, nem o que ele mesmo criou.
create policy "artigos: so equipe TI exclui"
on public.artigos
for delete
using (is_equipe_ti());

-- ----------------------------------------------------------------------------
-- 3) Cadastro/Desligamento de colaborador: so quem gerencia gente
-- ----------------------------------------------------------------------------

-- "Quem gerencia gente" = admin, RH, Líder de Logística, Líder de Vendas,
-- Gestor da Unidade. Funcao propria (e nao mais um "is_x_ou_y" solto na
-- policy) porque o mesmo criterio tambem decide o que aparece na tela de
-- Novo Chamado.
create or replace function public.pode_abrir_chamado_de_colaborador()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from usuarios u
    left join setores s on s.id = u.setor_id
    where u.id = auth.uid()
      and u.status_aprovacao = 'aprovado'
      and u.ativo
      and (
        u.perfil = 'admin'
        or s.nome in ('Recursos Humanos', 'Líder de Logística', 'Líder de Vendas', 'Gestor da Unidade')
      )
  );
$$;

drop policy if exists "chamados: solicitante abre chamado" on public.chamados;

create policy "chamados: solicitante abre chamado"
on public.chamados
for insert
with check (
  solicitante_id = auth.uid()
  and (
    categoria_id not in (
      select id from categorias where nome in ('Cadastro', 'Desligamento')
    )
    or pode_abrir_chamado_de_colaborador()
  )
);
