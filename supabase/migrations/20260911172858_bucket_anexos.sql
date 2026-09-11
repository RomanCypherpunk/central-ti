-- Bucket dos anexos de chamado. Privado: o arquivo so e alcancavel por URL
-- assinada, gerada na hora para quem ja tem permissao de ver o chamado.

insert into storage.buckets (id, name, public)
values ('anexos', 'anexos', false)
on conflict (id) do nothing;

-- O caminho do arquivo comeca com o id do chamado (ex: "<chamado_id>/print.png"),
-- entao da para amarrar a permissao do arquivo a permissao do chamado.
create policy "anexos: equipe TI le todos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'anexos' and is_equipe_ti());

create policy "anexos: solicitante le dos proprios chamados"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'anexos'
    and exists (
      select 1 from chamados
      where chamados.id::text = split_part(name, '/', 1)
        and chamados.solicitante_id = auth.uid()
    )
  );

create policy "anexos: equipe TI envia"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'anexos' and is_equipe_ti());

create policy "anexos: solicitante envia no proprio chamado"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'anexos'
    and exists (
      select 1 from chamados
      where chamados.id::text = split_part(name, '/', 1)
        and chamados.solicitante_id = auth.uid()
    )
  );

create policy "anexos: equipe TI apaga"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'anexos' and is_equipe_ti());
