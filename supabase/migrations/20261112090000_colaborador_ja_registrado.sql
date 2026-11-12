-- ============================================================================
-- FLAG INTERNA "COLABORADOR JÁ CADASTRADO / JÁ DESLIGADO"
--
-- Quando o mesmo colaborador é pedido duas vezes (dois chamados de cadastro ou
-- de desligamento), a equipe de TI marca o repetido com esta flag e ele deixa
-- de entrar nas contagens da análise de Cadastros e Desligamentos.
--
-- Só a equipe edita (policy "chamados: equipe TI atualiza"); nenhuma tela do
-- solicitante lê esta coluna. Chamados já existentes ficam como não marcados.
-- ============================================================================

alter table public.chamados
  add column if not exists colaborador_ja_registrado boolean not null default false;
