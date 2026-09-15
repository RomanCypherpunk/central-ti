-- Solicitante vê quem respondeu os próprios chamados.
--
-- Até aqui a leitura de `usuarios` era: cada um vê o próprio perfil e a
-- equipe de TI vê todos. Em "Minhas solicitações" a conversa traz
-- `comentarios(..., usuarios(nome, sobrenome, foto_path))`; para o
-- solicitante o join com o perfil de quem respondeu voltava nulo (a linha não
-- passava na policy) e a tela caía no texto padrão "Equipe de TI", sem nome
-- e sem foto.
--
-- A policy nova libera só o necessário: a linha de quem escreveu uma
-- mensagem pública num chamado aberto pela pessoa logada. Ninguém passa a
-- ver a lista de usuários, nem quem só está atribuído ao chamado sem ter
-- falado com o solicitante.
--
-- Sem recursão: a subconsulta lê `comentarios` e `chamados`, não `usuarios`.

drop policy if exists "usuarios: solicitante vê quem respondeu seus chamados" on public.usuarios;

create policy "usuarios: solicitante vê quem respondeu seus chamados"
  on public.usuarios for select
  to authenticated
  using (
    exists (
      select 1
      from public.comentarios co
      join public.chamados ch on ch.id = co.chamado_id
      where co.autor_id = usuarios.id
        and co.visibilidade = 'publico'
        and ch.solicitante_id = auth.uid()
    )
  );
