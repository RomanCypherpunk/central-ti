-- Categorias dos dois tipos de chamado de colaborador da tela "Abrir chamado".
--
-- A tela tem três caixas: Cadastro de colaborador, Desligamento de
-- colaborador e Suporte TI. No suporte a pessoa escolhe a categoria; nos
-- dois de colaborador a categoria é fixa, e o abrir-chamado.js a encontra
-- pelo nome. Sem estas linhas, esses chamados abrem sem categoria.
--
-- Só insere se ainda não existir uma categoria com o mesmo nome.

insert into public.categorias (nome, ativo)
select novas.nome, true
from (values
  ('Cadastro de Colaborador'),
  ('Desligamento de Colaborador')
) as novas(nome)
where not exists (
  select 1
  from public.categorias existente
  where lower(existente.nome) = lower(novas.nome)
);
