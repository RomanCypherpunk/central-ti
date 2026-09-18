-- Web Push de verdade para as notificacoes do Portal: a versao anterior
-- (Notification API pura, sem Service Worker) so dispara com a aba em
-- primeiro plano, porque o navegador suspende o WebSocket do tempo real
-- com a aba em segundo plano. Aqui o SERVIDOR e quem detecta a novidade
-- (via trigger) e empurra o push — funciona com a aba minimizada/em outra
-- aba, so nao com o navegador inteiro fechado.

create extension if not exists pg_net with schema extensions;

-- INSCRICOES DE PUSH: uma linha por navegador/dispositivo que ligou as
-- notificacoes. endpoint e unico porque o mesmo navegador pode gerar o
-- mesmo endpoint de novo depois de desligar e ligar (upsert no cliente).
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  criado_em timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

create policy "push_subscriptions: dono ve e gerencia a propria"
  on push_subscriptions for all
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

-- SO A EDGE FUNCTION (service_role, ignora RLS) le a tabela inteira pra
-- mandar os pushes — nao precisa de policy extra pra isso.

comment on table push_subscriptions is
  'Inscricoes de Web Push por navegador/dispositivo. A Edge Function notificar-portal le tudo via service_role para enviar os pushes.';

-- GATILHO NO SERVIDOR: chama a Edge Function notificar-portal a cada
-- INSERT relevante, via pg_net (chamada HTTP assincrona, nao trava o
-- INSERT esperando resposta). A service_role key e o project URL ficam no
-- Supabase Vault (vault.create_secret), nao em texto puro nesta migration
-- — precisa ser configurado uma vez, manualmente, antes deste trigger
-- funcionar (ver instrucoes no plano-implementacao.md).
create or replace function notificar_portal_via_webhook()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  url text;
  chave text;
begin
  select decrypted_secret into url from vault.decrypted_secrets where name = 'supabase_url';
  select decrypted_secret into chave from vault.decrypted_secrets where name = 'service_role_key';

  -- Secrets ainda nao configurados: nao quebra o INSERT do chamado/comentario,
  -- so nao dispara a notificacao (fica so no log do Postgres).
  if url is null or chave is null then
    raise warning 'notificar_portal_via_webhook: secrets supabase_url/service_role_key ainda nao configurados no Vault';
    return new;
  end if;

  perform net.http_post(
    url := url || '/functions/v1/notificar-portal',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || chave
    ),
    body := jsonb_build_object(
      'table', tg_table_name,
      'record', to_jsonb(new)
    )
  );

  return new;
end;
$$;

create trigger comentarios_notificar_portal
  after insert on comentarios
  for each row execute function notificar_portal_via_webhook();

create trigger chamados_notificar_portal
  after insert on chamados
  for each row execute function notificar_portal_via_webhook();
