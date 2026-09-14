-- Plano de fundo personalizado do Portal: cada usuario pode subir a propria
-- imagem, guardada no bucket "fundos-portal". Sem imagem, o quadro mantem o
-- degrade laranja padrao. Mesmo esquema de foto_path/avatares (arquivo
-- nomeado pelo id do usuario, uma policy por operacao), mas o bucket e
-- PRIVADO: e um fundo pessoal, ninguem mais precisa ver.

alter table usuarios add column fundo_path text;

insert into storage.buckets (id, name, public)
values ('fundos-portal', 'fundos-portal', false)
on conflict (id) do nothing;

create policy "fundos-portal: cada um le o proprio fundo"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'fundos-portal'
    and split_part(name, '.', 1) = auth.uid()::text
  );

create policy "fundos-portal: cada um envia o proprio fundo"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'fundos-portal'
    and split_part(name, '.', 1) = auth.uid()::text
  );

create policy "fundos-portal: cada um troca o proprio fundo"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'fundos-portal'
    and split_part(name, '.', 1) = auth.uid()::text
  );

create policy "fundos-portal: cada um apaga o proprio fundo"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'fundos-portal'
    and split_part(name, '.', 1) = auth.uid()::text
  );
