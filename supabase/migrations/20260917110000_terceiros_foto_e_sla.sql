-- ============================================================================
-- FOTO DO TERCEIRIZADO
--
-- Pedido do usuario: o terceirizado (Vivo, Sematec...) fica com o icone de
-- predio por padrao, mas o Painel ganha opcao de trocar por uma foto/logo —
-- mesma ideia do avatar de pessoa, so que quem troca e sempre a equipe de
-- TI (o terceirizado nao tem conta pra mexer na propria foto).
-- ============================================================================

alter table public.terceiros add column if not exists foto_path text;

insert into storage.buckets (id, name, public)
values ('terceiros', 'terceiros', true)
on conflict (id) do nothing;

create policy "terceiros-fotos: leitura publica"
on storage.objects
for select
using (bucket_id = 'terceiros');

create policy "terceiros-fotos: equipe TI envia"
on storage.objects
for insert
with check (bucket_id = 'terceiros' and is_equipe_ti());

create policy "terceiros-fotos: equipe TI troca"
on storage.objects
for update
using (bucket_id = 'terceiros' and is_equipe_ti());

create policy "terceiros-fotos: equipe TI remove"
on storage.objects
for delete
using (bucket_id = 'terceiros' and is_equipe_ti());
