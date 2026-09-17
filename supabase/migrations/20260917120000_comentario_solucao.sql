-- Card de solução dentro da conversa do chamado: a equipe manda o link de
-- um artigo da base direto no chat, em vez de colar o link cru como texto.
-- Precisa de um terceiro tipo de comentário (além de humano/sistema) e de
-- uma referência ao artigo enviado.

alter table comentarios drop constraint comentarios_tipo_check;
alter table comentarios add constraint comentarios_tipo_check
  check (tipo = any (array['humano', 'sistema', 'solucao']));

alter table comentarios add column artigo_id uuid references artigos(id) on delete set null;

comment on column comentarios.artigo_id is
  'Preenchido só quando tipo = solucao: o artigo da base que foi enviado no chat.';
