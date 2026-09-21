begin;

create or replace function public.conta_ativa_para_acesso()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid() and u.ativo
  );
$$;
revoke all on function public.conta_ativa_para_acesso() from public, anon;
grant execute on function public.conta_ativa_para_acesso() to authenticated;

-- A policy restritiva é combinada com todas as policies existentes. Assim,
-- uma conta inativa perde acesso a qualquer tabela protegida por RLS, mesmo
-- se ainda possuir um JWT emitido antes da desativação.
do $$
declare
  item record;
begin
  for item in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute pg_catalog.format(
      'drop policy if exists conta_ativa_necessaria on public.%I', item.relname
    );
    execute pg_catalog.format(
      'create policy conta_ativa_necessaria on public.%I as restrictive for all to authenticated using (public.conta_ativa_para_acesso()) with check (public.conta_ativa_para_acesso())',
      item.relname
    );
  end loop;
end;
$$;

-- Evita que o navegador altere somente public.usuarios.ativo e deixe o Auth
-- sem banimento correspondente; a Edge Function usa service_role e faz ambos.
create or replace function public.bloquear_alteracao_direta_de_conta_ativa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ativo is distinct from old.ativo and auth.role() <> 'service_role' then
    raise exception 'A alteração de conta ativa deve ser feita pelo fluxo administrativo.';
  end if;
  return new;
end;
$$;
drop trigger if exists usuarios_bloquear_alteracao_direta_de_ativo on public.usuarios;
create trigger usuarios_bloquear_alteracao_direta_de_ativo
before update of ativo on public.usuarios
for each row execute function public.bloquear_alteracao_direta_de_conta_ativa();

commit;
