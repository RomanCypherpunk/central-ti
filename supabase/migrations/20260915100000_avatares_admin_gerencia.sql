-- O bucket "avatares" só deixava cada pessoa mexer na própria foto
-- (split_part(name, '.', 1) = auth.uid()). O Painel precisa deixar o admin
-- trocar ou remover a foto de QUALQUER pessoa, ao editar o cadastro dela em
-- Contatos — por isso estas policies somam às que já existiam, não
-- substituem: o dono continua podendo mexer na própria foto (perfil.js),
-- e agora o admin também pode mexer na de qualquer um.
--
-- Escopo intencionalmente estreito: só admin (não "equipe de TI" inteira,
-- que inclui analista/parceiro) — mesma régua de quem entra no Painel.
-- Checagem inline em vez de uma function nova (is_admin()): usada só aqui,
-- não vale criar mais uma peça reutilizável para uma regra tão específica.

create policy "avatares: admin envia foto de qualquer um"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatares'
    and exists (
      select 1 from usuarios
      where id = auth.uid() and perfil = 'admin' and status_aprovacao = 'aprovado' and ativo
    )
  );

create policy "avatares: admin troca foto de qualquer um"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatares'
    and exists (
      select 1 from usuarios
      where id = auth.uid() and perfil = 'admin' and status_aprovacao = 'aprovado' and ativo
    )
  );

create policy "avatares: admin remove foto de qualquer um"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatares'
    and exists (
      select 1 from usuarios
      where id = auth.uid() and perfil = 'admin' and status_aprovacao = 'aprovado' and ativo
    )
  );
