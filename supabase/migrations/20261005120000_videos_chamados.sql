-- Vídeos têm retenção de três meses de calendário, contados do upload.
begin;
update storage.buckets set file_size_limit = 52428800,
 allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','application/pdf','video/mp4','video/webm','video/quicktime']
where id = 'anexos';

alter table public.anexos add column video_expira_em timestamptz;
create index anexos_videos_expiracao on public.anexos(video_expira_em) where video_expira_em is not null;

create function public.definir_expiracao_video() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- A data é derivada do Storage, nunca fornecida pelo cliente.
  new.video_expira_em := null;
  select o.created_at + interval '3 months' into new.video_expira_em
  from storage.objects o where o.bucket_id = 'anexos' and o.name = new.storage_path
    and o.metadata->>'mimetype' in ('video/mp4','video/webm','video/quicktime');
  return new;
end;
$$;
revoke all on function public.definir_expiracao_video() from public, anon, authenticated;
create trigger anexos_definir_expiracao before insert or update on public.anexos
for each row execute function public.definir_expiracao_video();
update public.anexos a set video_expira_em = o.created_at + interval '3 months'
from storage.objects o where o.bucket_id = 'anexos' and o.name = a.storage_path
 and o.metadata->>'mimetype' in ('video/mp4','video/webm','video/quicktime');

-- Inclui uploads órfãos; mantém anexos expirados disponíveis para repetir
-- a limpeza se o arquivo foi removido mas a remoção da linha falhou.
create function public.videos_expirados_chamados() returns table(storage_path text)
language sql security definer set search_path = '' as $$
 select paths.storage_path from (
   select a.storage_path from public.anexos a where a.video_expira_em <= now()
   union
   select o.name from storage.objects o where o.bucket_id = 'anexos'
    and o.metadata->>'mimetype' in ('video/mp4','video/webm','video/quicktime')
    and o.created_at + interval '3 months' <= now()
 ) paths order by paths.storage_path limit 100;
$$;
revoke all on function public.videos_expirados_chamados() from public, anon, authenticated;
grant execute on function public.videos_expirados_chamados() to service_role;

create function public.agendar_limpeza_videos() returns void
language plpgsql security definer set search_path = '' as $$
declare destino text; chave text;
begin
 select decrypted_secret into destino from vault.decrypted_secrets where name = 'supabase_url';
 select decrypted_secret into chave from vault.decrypted_secrets where name = 'service_role_key';
 if destino is distinct from 'https://pmwcfdxryjwsvwsmcufm.supabase.co' or chave is null then
   raise exception 'Limpeza de vídeos: configure supabase_url e service_role_key no Vault';
 end if;
 perform net.http_post(url := destino || '/functions/v1/limpar-videos-chamados',
   headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || chave),
   body := '{}'::jsonb, timeout_milliseconds := 5000);
end;
$$;
revoke all on function public.agendar_limpeza_videos() from public, anon, authenticated;
select cron.schedule('limpar-videos-chamados', '30 3 * * *', 'select public.agendar_limpeza_videos();');
commit;
