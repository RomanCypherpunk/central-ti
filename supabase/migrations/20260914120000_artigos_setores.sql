-- Visibilidade da base de soluções por setor.
--
-- Na tela de nova solução, "Categoria" deu lugar a "Setores": quem cadastra
-- marca um ou mais setores, e a solução só aparece para os usuários daqueles
-- setores. A regra fica aqui, na policy de leitura, e não só na tela —
-- esconder na interface não impede ninguém de consultar a API direto.
--
-- `categoria_id` continua na tabela; a tela só deixou de preencher.

alter table public.artigos
  add column if not exists setores uuid[] not null default '{}';

comment on column public.artigos.setores is
  'Setores que enxergam a solução. Vazio: só a equipe de TI e o autor.';

create index if not exists artigos_setores_idx on public.artigos using gin (setores);

-- security definer: a policy de artigos não deve depender das policies de
-- usuarios para descobrir o setor de quem está logado.
create or replace function public.meu_setor_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select setor_id from public.usuarios where id = auth.uid();
$$;

drop policy if exists artigos_leitura on public.artigos;

-- A equipe de TI enxerga tudo (é quem mantém a base); o autor enxerga o que
-- cadastrou; os demais, só o que foi marcado para o próprio setor.
create policy artigos_leitura on public.artigos
  for select
  to authenticated
  using (
    ativo
    and (
      is_equipe_ti()
      or auth.uid() = autor_id
      or public.meu_setor_id() = any (setores)
    )
  );
