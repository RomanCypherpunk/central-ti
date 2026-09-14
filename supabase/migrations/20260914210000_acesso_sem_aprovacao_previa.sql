-- Muda onde a aprovação de cadastro trava o acesso: até aqui ela travava
-- abrir/ver chamado e responder o próprio chamado (via is_aprovado() nas
-- policies), e liberava a Base de Soluções sem checar aprovação nenhuma —
-- o oposto do que devia ser.
--
-- A partir daqui: qualquer um com conta pode abrir e acompanhar chamado
-- (é o próprio canal para pedir ajuda, inclusive para reclamar de acesso
-- pendente — não faz sentido travar). A Base de Soluções passa a exigir
-- aprovação: quem está pendente não vê nenhum artigo, nem por engano de
-- setor coincidir.
--
-- artigo_feedback continua exigindo aprovação — coerente com artigos
-- agora exigir também: não dá pra avaliar uma solução que não devia ver.

-- CHAMADOS: solicitante abre e ve os proprios sem precisar de aprovacao.
drop policy if exists "chamados: solicitante abre chamado" on public.chamados;
create policy "chamados: solicitante abre chamado"
  on public.chamados for insert
  with check (solicitante_id = auth.uid());

drop policy if exists "chamados: solicitante vê os próprios" on public.chamados;
create policy "chamados: solicitante vê os próprios"
  on public.chamados for select
  using (solicitante_id = auth.uid());

-- COMENTARIOS: responder o proprio chamado tambem nao depende mais de
-- aprovacao — e o canal usado ate para reclamar do acesso pendente.
drop policy if exists "comentarios: solicitante comenta no próprio chamado" on public.comentarios;
create policy "comentarios: solicitante comenta no próprio chamado"
  on public.comentarios for insert
  with check (
    autor_id = auth.uid()
    and visibilidade = 'publico'
    and exists (
      select 1 from chamados
      where chamados.id = comentarios.chamado_id
        and chamados.solicitante_id = auth.uid()
    )
  );

-- ARTIGOS: agora exige aprovacao, alem da regra de setor que ja existia.
-- Pendente nao ve nada da Base, nem do proprio setor.
drop policy if exists "artigos_leitura" on public.artigos;
create policy "artigos_leitura"
  on public.artigos for select
  using (
    ativo
    and is_aprovado()
    and (is_equipe_ti() or auth.uid() = autor_id or meu_setor_id() = any (setores))
  );
