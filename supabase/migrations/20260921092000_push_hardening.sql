-- Candidato: aplicar em staging com schema reconciliado. Nenhuma policy ampliada.
begin;

create table if not exists public.push_eventos_processados (
  tabela text not null check (tabela in ('chamados', 'comentarios')),
  registro_id uuid not null,
  processado_em timestamptz not null default now(),
  primary key (tabela, registro_id)
);
alter table public.push_eventos_processados enable row level security;
revoke all on public.push_eventos_processados from public, anon, authenticated;
grant select, insert on public.push_eventos_processados to service_role;

-- NOT VALID preserva inscrições históricas inválidas para revisão, mas bloqueia
-- novas escritas inválidas. A Edge também recusa os endpoints históricos.
alter table public.push_subscriptions add constraint push_endpoint_seguro check (
  char_length(endpoint) <= 4096 and (
    endpoint ~ '^https://fcm[.]googleapis[.]com/(fcm/send|wp)/[^#[:space:]]+$' or
    endpoint ~ '^https://updates[.]push[.]services[.]mozilla[.]com/wpush/[^#[:space:]]+$' or
    endpoint ~ '^https://web[.]push[.]apple[.]com/[^#[:space:]]+$'
  )
) not valid;
alter table public.push_subscriptions add constraint push_chaves_formato check (
  p256dh ~ '^[A-Za-z0-9_-]{87}$' and auth ~ '^[A-Za-z0-9_-]{22}$'
) not valid;

-- Restrictive combina com AND com policies permissivas existentes; evita OR bypass.
create policy push_usuario_habilitado on public.push_subscriptions
as restrictive for all to authenticated
using (usuario_id = auth.uid() and exists (
  select 1 from public.usuarios u where u.id = auth.uid()
    and u.ativo and u.status_aprovacao = 'aprovado'
))
with check (usuario_id = auth.uid() and exists (
  select 1 from public.usuarios u where u.id = auth.uid()
    and u.ativo and u.status_aprovacao = 'aprovado'
));
revoke all on public.push_subscriptions from anon;

-- O Vault protege em repouso; a queue de pg_net contém Authorization em claro.
-- Preserva permissões de postgres/service_role e restringe clientes.
revoke all on schema vault from public, anon, authenticated;
revoke all on all tables in schema vault from public, anon, authenticated;
revoke all on all functions in schema vault from public, anon, authenticated;
revoke all on schema net from public, anon, authenticated;
revoke all on all tables in schema net from public, anon, authenticated;
revoke all on all sequences in schema net from public, anon, authenticated;
revoke all on all functions in schema net from public, anon, authenticated;

create or replace function public.notificar_portal_via_webhook()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  destino text;
  chave text;
begin
  if tg_table_schema <> 'public' or tg_op <> 'INSERT'
    or tg_table_name not in ('chamados', 'comentarios') then
    raise exception 'Contexto de trigger inválido';
  end if;
  if tg_table_name = 'comentarios' then
    if new.tipo <> 'humano' or new.visibilidade <> 'publico' then return new; end if;
  end if;
  select decrypted_secret into destino from vault.decrypted_secrets where name = 'supabase_url';
  select decrypted_secret into chave from vault.decrypted_secrets where name = 'service_role_key';
  -- Fixar host do projeto: editar somente para um ambiente de staging autorizado.
  if destino <> 'https://pmwcfdxryjwsvwsmcufm.supabase.co' or destino is null or chave is null then
    raise warning 'push: configuração inválida/ausente';
    return new;
  end if;
  perform net.http_post(
    url := destino || '/functions/v1/notificar-portal',
    headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || chave),
    body := pg_catalog.jsonb_build_object('table', tg_table_name, 'id', new.id),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;
revoke all on function public.notificar_portal_via_webhook() from public, anon, authenticated;
commit;
