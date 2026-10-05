# Vídeos nos chamados

MP4, MOV e WebM: até 50 MB. Imagens: até 10 MB; PDF: até 5 MB.
Os vídeos abrem pelo link privado do anexo. A reprodução depende do codec e do navegador.

## Ativação pelo responsável pelo ambiente

1. Publicar a Edge Function `limpar-videos-chamados` com verificação JWT habilitada.
2. Aplicar `supabase/migrations/20261005120000_videos_chamados.sql` no banco.
3. Publicar os arquivos estáticos atualizados.

A migration depende de pg_cron, pg_net e dos segredos `supabase_url` e
`service_role_key` no Vault, já utilizados pelas notificações do projeto.
O host está fixado ao projeto de produção; ajustar explicitamente em staging.
Não expor a chave de serviço no frontend.

A limpeza roda diariamente às 03:30 UTC. Remove vídeos que completaram três
meses de calendário desde o upload, inclusive uploads sem registro de anexo.
A exclusão pode ocorrer até um dia depois do vencimento. Vídeos existentes
também entram na regra, com base na data original do Storage.

Primeiro remove os arquivos pela API do Storage; depois remove suas linhas
de anexos, mantendo chamados e comentários. Falhas ficam pendentes para nova
tentativa. Cada execução trata até 1.000 arquivos; excedentes ficam para o dia
seguinte. Monitorar os logs da função e `cron.job_run_details`.

Verificação local: `node scripts/maintenance/test-anexos-chamado.mjs`.
Para verificar o fluxo no ambiente de teste, enviar um vídeo em cada tela,
confirmar `video_expira_em` e testar um upload vencido com uma conta de serviço.
Somente vídeos vencidos devem desaparecer; imagens, PDFs e vídeos recentes
devem permanecer. A rotina faz exclusão definitiva.
