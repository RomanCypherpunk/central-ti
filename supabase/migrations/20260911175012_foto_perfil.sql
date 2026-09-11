-- Foto de perfil do usuario. Guarda so o caminho no Storage; o arquivo em si
-- vai para o bucket "avatares".

alter table usuarios add column foto_path text;

-- Bucket publico: um avatar aparece na conversa de todo mundo que participa
-- do chamado, e URL assinada com validade curta nao serve para <img> que fica
-- na tela. Nao ha dado sensivel numa foto de perfil.
insert into storage.buckets (id, name, public)
values ('avatares', 'avatares', true)
on conflict (id) do nothing;

-- O arquivo e nomeado pelo id do usuario, entao cada um so mexe no proprio.
create policy "avatares: leitura publica"
  on storage.objects for select
  using (bucket_id = 'avatares');

create policy "avatares: cada um envia a propria foto"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatares'
    and split_part(name, '.', 1) = auth.uid()::text
  );

create policy "avatares: cada um troca a propria foto"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatares'
    and split_part(name, '.', 1) = auth.uid()::text
  );

create policy "avatares: cada um apaga a propria foto"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatares'
    and split_part(name, '.', 1) = auth.uid()::text
  );
