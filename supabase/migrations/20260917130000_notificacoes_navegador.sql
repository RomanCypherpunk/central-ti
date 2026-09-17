-- Preferencia de notificacoes do navegador no Portal de Chamados: opt-in
-- por usuario (a permissao do proprio navegador ja e opt-in, mas guardar
-- a preferencia evita pedir a permissao de novo a cada carga da pagina
-- pra quem ja recusou ou desligou no menu).

alter table usuarios add column notificacoes_ativas boolean not null default false;

comment on column usuarios.notificacoes_ativas is
  'Notificacoes do navegador no Portal de Chamados (novo chamado no Inbox, resposta do solicitante, adicionado como atendente). Ligado pelo proprio usuario no menu do quadro.';
