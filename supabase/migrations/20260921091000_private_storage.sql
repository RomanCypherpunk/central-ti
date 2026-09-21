-- CANDIDATO, NAO APLICADO. Aplicar junto de private-storage.patch em staging.
-- Nao altera INSERT/UPDATE/DELETE nem permissao de upload de contribuinte.
-- Referencias antigas /object/public/artigos/... continuam no JSON apenas
-- como identificadores: o patch extrai o path e assina sob a sessao atual.
begin;

do $$
begin
  if (select count(*) from storage.buckets where id in ('artigos', 'terceiros', 'avatares')) <> 3 then
    raise exception 'Esperados os buckets artigos, terceiros e avatares; conferir inventario antes de aplicar';
  end if;
end;
$$;

-- Restritiva = AND com todas as policies permissivas existentes.
-- As subconsultas rodam como o chamador e herdam RLS das tabelas de origem.
-- Sem helper SECURITY DEFINER, sem duplicar a regra de setor/unidade.
drop policy if exists auditoria_arquivos_privados on storage.objects;
create policy auditoria_arquivos_privados
on storage.objects as restrictive
for select to public
using (
  case
    when bucket_id = 'artigos' then
      auth.uid() is not null
      and exists (
        select 1 from public.artigos a
        where a.id::text = split_part(storage.objects.name, '/', 1)
      )
    when bucket_id = 'terceiros' then
      auth.uid() is not null
      and exists (
        select 1 from public.terceiros t
        where t.id::text = split_part(storage.objects.name, '.', 1)
      )
    when bucket_id = 'avatares' then
      auth.uid() is not null and exists (
        select 1 from public.usuarios u
        where u.id = auth.uid() and u.ativo and u.status_aprovacao = 'aprovado'
      )
    else true
  end
);

update storage.buckets set public = false where id in ('artigos', 'terceiros', 'avatares');

-- Defesa em profundidade contra HTML/SVG executável, arquivos enormes e MIME arbitrário.
update storage.buckets set
  file_size_limit = 15728640,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','application/pdf']
where id in ('artigos', 'anexos');

update storage.buckets set
  file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg','image/png','image/webp']
where id in ('terceiros', 'avatares');

commit;
