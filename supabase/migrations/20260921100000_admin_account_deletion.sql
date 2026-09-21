begin;

create table public.admin_user_deletion_limits (
  ator_id uuid primary key,
  janela_inicio timestamptz not null,
  requisicoes integer not null check (requisicoes > 0)
);
alter table public.admin_user_deletion_limits enable row level security;
revoke all on public.admin_user_deletion_limits from public, anon, authenticated;
grant select, insert, update, delete on public.admin_user_deletion_limits to service_role;
create policy admin_user_deletion_limits_service_role on public.admin_user_deletion_limits
for all to service_role using (true) with check (true);

create function public.consumir_limite_exclusao_usuario(p_ator_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  total integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_ator_id::text, 0));
  insert into public.admin_user_deletion_limits as limite (ator_id, janela_inicio, requisicoes)
  values (p_ator_id, pg_catalog.now(), 1)
  on conflict (ator_id) do update set
    janela_inicio = case
      when limite.janela_inicio < pg_catalog.now() - interval '5 minutes' then pg_catalog.now()
      else limite.janela_inicio
    end,
    requisicoes = case
      when limite.janela_inicio < pg_catalog.now() - interval '5 minutes' then 1
      else limite.requisicoes + 1
    end
  returning requisicoes into total;
  return total <= 5;
end;
$$;
revoke all on function public.consumir_limite_exclusao_usuario(uuid) from public, anon, authenticated;
grant execute on function public.consumir_limite_exclusao_usuario(uuid) to service_role;

commit;
