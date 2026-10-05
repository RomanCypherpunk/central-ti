-- O Painel usa atualizar-usuario: a Edge valida o administrador ativo e
-- aprovado, depois grava com service_role. Essa sessão não tem auth.uid().
-- RLS bypass não desabilita triggers; a proteção anterior bloqueava a Edge.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.proteger_unidade_usuario()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.unidade_id is distinct from old.unidade_id
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.is_equipe_ti() then
    raise exception 'Somente a equipe de TI pode alterar a unidade.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.proteger_unidade_usuario() from public, anon, authenticated;
drop trigger if exists usuarios_proteger_unidade on public.usuarios;
create trigger usuarios_proteger_unidade
before update on public.usuarios
for each row execute function public.proteger_unidade_usuario();
commit;
