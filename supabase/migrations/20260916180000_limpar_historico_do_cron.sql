-- ============================================================================
-- LIMPEZA DO HISTORICO DO CRON
--
-- cron.job_run_details guarda uma linha por execucao e nunca apaga nada. O
-- job processar-retornos-pendentes roda a cada minuto (precisa dessa
-- frequencia: ele devolve chamados para a fila 10 minutos depois), entao sao
-- 1.440 linhas/dia — ~265 KB/dia, ~95 MB/ano, crescendo sozinho mesmo que
-- ninguem abra um unico chamado. Em um ano o log de um job passaria a ocupar
-- mais espaco que os 14 mil chamados da migracao.
--
-- Regra escolhida: guardar as FALHAS (que sao o que interessa investigar, e
-- hoje sao zero em 11 mil execucoes) e descartar os sucessos.
--
-- Os sucessos das ultimas 24h ficam de proposito: sem nenhum sucesso na
-- tabela nao da para responder "o job ainda esta rodando?" — a tabela vazia
-- ficaria igual a um cron parado. Com 24h da para ver as ultimas 1.440
-- execucoes e confirmar que esta vivo, sem acumular nada.
-- ============================================================================

create or replace function public.limpar_historico_do_cron()
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from cron.job_run_details
  where status = 'succeeded'
    and end_time < now() - interval '24 hours';
$$;

-- 03:10 todo dia: fora do expediente (que comeca as 8h), e num minuto
-- quebrado para nao cair junto de outras tarefas de madrugada.
select cron.schedule(
  'limpar-historico-do-cron',
  '10 3 * * *',
  $$select public.limpar_historico_do_cron();$$
);

-- Primeira limpeza agora: sem isso as ~11 mil linhas ja acumuladas ficariam
-- esperando ate a proxima madrugada.
select public.limpar_historico_do_cron();
