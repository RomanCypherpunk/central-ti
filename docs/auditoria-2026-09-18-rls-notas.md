# Complemento da auditoria: RLS, privilégios e migrations — 18/09/2026

Estas notas subsidiam a auditoria principal. A análise cobre o Git disponível e não certifica o catálogo atual de produção. O relatório anterior registrou um export de 16/09, mas o export integral não está versionado. Não foram feitas escritas remotas. As sondagens anônimas da auditoria principal complementam esta análise; um resultado `[]` só comprova a consulta testada, com aquele papel, naquele instante.

## Superfície anônima identificável no repositório

| Objeto | O que o código permite/indica | Limite da conclusão |
|---|---|---|
| `public.setores`, `public.unidades` | SELECT anônimo das linhas `ativo=true`; migration `20260910125000_setores_unidades_leitura_anon.sql:7` e `:13` | Confirmado também pela sondagem REST; revisar colunas retornadas, pois RLS filtra linhas |
| `storage.objects` de `artigos`, `avatares`, `terceiros-fotos` | Policies SELECT sem `TO`, logo `PUBLIC`, filtradas somente por bucket | ACLs e exposição pela API também contam; a entrega pública de objetos independe dessas policies |
| `public.limpar_historico_do_cron()` | DEFINER sem autorização interna, DELETE de sucessos do cron com mais de 24h | Sem REVOKE no Git; EXECUTE efetivo e cache PostgREST exigem inventário. Não chamar remotamente para testar porque modifica histórico |
| `public.reabrir_chamado(uuid)` | Sem REVOKE no Git; checa dono ou equipe antes de atualizar | Chamada anônima deve ser recusada internamente; falta restringir ACL |
| Helpers `is_equipe_ti`, `is_admin`, `pode_escrever_artigo`, `meu_setor_id`, `minha_unidade_id`, `meu_setor_nome`, `setores_permitidos_para_artigo`, `pode_abrir_chamado_de_colaborador` | DEFINER, STABLE, sem parâmetros, vinculados a `auth.uid()` | Sem REVOKE versionado; em anon normalmente false, null ou array vazio; isso não é vazamento de cadastro completo |
| `is_aprovado()` e outras rotinas criadas no Studio | Definição ausente no Git | Não afirmar assinatura, STABLE, `search_path` ou autorização sem `pg_proc`/definição real |
| Funções `RETURNS trigger` | Muitas são DEFINER e têm EXECUTE público por default | Não são RPCs normais. Não alegar que `POST /rpc/handle_new_user` cria usuários: funções trigger precisam ser invocadas em contexto de trigger |
| Demais tabelas públicas | As policies visíveis usualmente usam `auth.uid()` ou helpers | SELECTs anônimos vazios são positivo; grants, outras policies, views e RPCs exigem catálogo completo |

Há quatro `CREATE TABLE` versionados: `textos_rapidos`, `terceiros`, `chamado_terceiros`, `push_subscriptions`. As doze tabelas básicas continuam sem CREATE no repositório; o inventário esperado já é de pelo menos **16 tabelas**, não 13. `scripts/security/rls-inventory.sql` enumera todas as existentes, inclusive views/partições e schemas sensíveis, sem consultar valores de secrets ou payloads pg_net.

## Achado RLS-01 — Alta: a unidade usada para autorizar leitura pode ser alterada pelo próprio usuário

**Diagnóstico:** `20260916140000_niveis_de_acesso.sql:177` autoriza UPDATE da própria linha; o trigger `protege_perfil_usuario`, em `:140`, só considera `perfil`, `status_aprovacao`, `ativo`. `20260916150000_perfil_independente_do_setor.sql:38` protege apenas `setor_id`. Não existe proteção versionada de `unidade_id`, usada pelo helper `minha_unidade_id` (`20260916190000_artigos_unidades_e_autor.sql:61`) e pela leitura de artigos (`20260916200000_unidades_explicitas_nos_artigos.sql:41`). Um solicitante aprovado pode trocar de unidade e ler artigos do mesmo setor destinados a outra unidade, se não houver grant por coluna/trigger adicional em produção. A tela de perfil não oferecer esse campo não protege a API.

**PoC transacional em staging:** usar solicitante aprovado real, unidade diferente e artigo cujo setor inclua o usuário, mas cuja unidade originalmente não o inclua. Executar como postgres no SQL Editor, preenchendo UUIDs. Os `set_config` abaixo simulam claims somente em conexão administrativa local; não são algo acessível ao navegador pela API normal.

```sql
begin;
select set_config('request.jwt.claims',
  '{"sub":"UUID_SOLICITANTE","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'UUID_SOLICITANTE', true);
set local role authenticated;
select id from public.artigos where id='UUID_ARTIGO_RESTRITO'; -- esperado antes: 0
update public.usuarios set unidade_id='UUID_OUTRA_UNIDADE'
where id=auth.uid(); -- vulnerável: UPDATE 1; corrigido: SQLSTATE 42501
select id from public.artigos where id='UUID_ARTIGO_RESTRITO';
rollback;
```

Mesmo que o cliente pare na exceção esperada, execute `ROLLBACK` antes de reutilizar a conexão. Sem artigo de teste adequadamente segmentado, o UPDATE prova a alteração indevida de atributo, mas não a leitura cruzada.

**Correção completa:** bloco `RLS-01` de `scripts/security/rls-hardening-candidate.sql`. Acrescenta um trigger, sem reescrever o trigger de perfil nem remover checks existentes. Revisar também todos os outros triggers BEFORE: um que altere `NEW.unidade_id` sem a coluna constar do comando deve ser coberto por uma política de autorização igualmente restrita.

**Regressão:** solicitante consegue editar nome/foto/preferência; mudar unidade/perfil/status falha; TI autenticado altera unidade de usuário de teste e artigos mudam conforme o escopo. Não desabilitar triggers para fazer teste passar. Atribuir setor/unidade no cadastro ainda exige validação pela equipe antes de aprovação.

## Achado RLS-02 — Média: contribuinte pode atribuir artigo a outro usuário

**Diagnóstico:** `20260917090000_regras_contribuinte_e_colaborador.sql:76` restringe capacidade de escrita e setores, mas não exige `autor_id=auth.uid()` no INSERT. A restrição existe no UPDATE (`:101` e `:107`), então a criação pode produzir um artigo com autoria falsa que o próprio contribuinte não poderá editar. `autor_id` também concede exceção na leitura (`20260916200000_unidades_explicitas_nos_artigos.sql:39`), permitindo enviar o conteúdo ao usuário indicado fora de seu setor/unidade. Impacto de integridade/atribuição e segmentação, condicionado à ausência de trigger adicional que normalize autor.

**PoC em staging** (somente dados de teste, em transação como a anterior):

```sql
insert into public.artigos
  (titulo,conteudo,tipo,autor_id,setores,unidades,ativo)
values ('AUDITORIA autoria','Conteúdo sintético','procedimento',
  'UUID_OUTRO_USUARIO',array['UUID_SETOR_PERMITIDO']::uuid[],
  array['UUID_UNIDADE']::uuid[],true);
-- Vulnerável: INSERT aceito e autor_id preservado; corrigido: 42501.
-- Ajustar campos NOT NULL da baseline real, sem enfraquecer constraints/policies.
rollback;
```

Falha de FK/NOT NULL não prova autorização correta: separar esse erro de `42501`. **Correção:** bloco `RLS-02` candidato adiciona policy `AS RESTRICTIVE`, evitando que outra policy permissiva anule a nova trava com OR. **Regressão:** contribuinte cria e edita artigo próprio em setores permitidos; criação em setor proibido, edição de terceiros e DELETE continuam negados; TI conserva atribuição e manutenção previstas.

## Achado RLS-03 — Alta: solicitante pode forjar “Mensagem automática” no chat

**Diagnóstico:** o INSERT do solicitante só restringe autor, visibilidade pública e propriedade do chamado (`20260914210000_acesso_sem_aprovacao_previa.sql:29`). `tipo` não é validado por papel. A constraint permite `sistema` e agora `solucao` (`20260917120000_comentario_solucao.sql:6`). `portal.js:2063` troca a autoria exibida por “Mensagem automática” quando `tipo=sistema`. Assim a identidade de origem exibida não corresponde a uma fonte confiável; é possível injetar uma falsa aprovação, mudança de status ou instrução de atendimento. Também é possível inserir `tipo=solucao`/`artigo_id` sem ser TI, sujeito à FK. Isso não remove a RLS de `artigos`: conhecer um ID ou criar a referência não autoriza ler o artigo.

**PoC transacional** com papel/claims de solicitante e chamado próprio de teste:

```sql
insert into public.comentarios(chamado_id,autor_id,texto,visibilidade,tipo)
values ('UUID_CHAMADO_PROPRIO',auth.uid(),
  'AUDITORIA: mensagem sintética sem efeito operacional','publico','sistema');
-- Antes: INSERT aceito; depois da correção: 42501.
rollback;
```

**Correção completa:** bloco `RLS-03` candidato limita inserts diretos do cliente a humano; TI pode enviar solução ligada a artigo visível. A autoria de todo insert direto fica presa a `auth.uid()`. Mensagens de sistema continuam nos fluxos DEFINER existentes (`reabrir_chamado`, `notificar_aprovacao_cadastro`), que devem ter owner e ACL revisados. **Regressão:** mensagem humana pública do solicitante funciona; nota interna e solução de TI funcionam; mensagem `sistema` direta falha inclusive para TI; reabertura legítima continua gravando a mensagem automática; solicitante continua sem ler notas internas. Não substituir a função privilegiada por um INSERT cliente que precise afrouxar a policy.

## Achado ACL-01 — Média: privilégios públicos continuam implícitos; correção antiga é incompleta

Nenhum `GRANT`/`REVOKE` de função está versionado nas migrations examinadas. `limpar_historico_do_cron` apaga **apenas sucessos com mais de 24h**, não todas as falhas ou todo o histórico (`20260916180000_limpar_historico_do_cron.sql:26`). O problema é uma rotina de manutenção exposta sem necessidade, sujeito a ACL real. `reabrir_chamado` valida dono/equipe (`20260914220000_reabrir_chamado_topo_fila.sql:23`); sem sessão, a comparação resulta null e o ramo “não encontrado” recusa, um controle positivo.

O relatório anterior recomenda `REVOKE ... FROM anon` para helpers, mas isso **não remove** o privilégio herdado de `PUBLIC`. Novas funções normalmente dão EXECUTE a PUBLIC; funções `CREATE OR REPLACE` preservam ACL existente, portanto ausência de REVOKE no Git não prova que produção não tenha sido endurecida. [PostgreSQL: segurança de funções](https://www.postgresql.org/docs/16/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY).

**Validação sem modificar histórico:**

```sql
select p.oid::regprocedure,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('limpar_historico_do_cron','reabrir_chamado','is_equipe_ti','is_admin','is_aprovado');
```

**Correção segura imediata:** bloco `ACL-01` candidato revoga manutenção de PUBLIC/anon/authenticated e limita reabertura a authenticated. Depois verificar o role do job cron; owner mantém privilégio. Para helpers, inventariar antes: policies omitindo `TO` se aplicam a PUBLIC e podem invocar esses helpers até numa tabela com outra policy anônima. Revogar helpers sem revisar essas policies pode causar erro na lista do cadastro. Com todas as policies dependentes limitadas aos roles corretos, o padrão para cada helper é:

```sql
begin;
revoke execute on function public.is_equipe_ti() from public, anon;
grant execute on function public.is_equipe_ti() to authenticated;
-- Repetir para a allowlist revisada; não usar grant em todas as funções.
commit;
```

Default privileges são por **role criador**; depois de identificar todos os criadores, padronizar `ALTER DEFAULT PRIVILEGES FOR ROLE <criador> REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`, e conceder explicitamente só a função necessária na mesma transação. Não usar apenas `IN SCHEMA public` para tentar subtrair o default global de PUBLIC.

## Achado PATH-01 — Baixa/defesa em profundidade: search_path fixo ainda permite sombra por tabela temporária

Os oito helpers presentes no Git são STABLE, sem argumento manipulável e usam `auth.uid()`, um ponto positivo. Porém `SET search_path='public'` não equivale ao arranjo completo recomendado: quando omitido, `pg_temp` é pesquisado primeiro para relações; vários helpers referenciam `usuarios`, `setores` sem schema. Também é necessário provar que anon/authenticated não podem criar objetos nos schemas pesquisados. Isso exige um canal SQL com criação de objetos temporários ou no schema; **não foi demonstrado um exploit pelo REST**. Corrigir as flags de volatilidade não resolveria esse problema; STABLE é uma propriedade do otimizador, não uma verificação de identidade. [PostgreSQL: funções DEFINER](https://www.postgresql.org/docs/16/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY).

**Correção:** bloco `PATH-01` candidato coloca `pg_catalog` primeiro e `pg_temp` por último sem mudar os corpos existentes. Preferir no futuro referências qualificadas (`public.usuarios`, `auth.uid`) e `search_path` vazio. O inventário mede `CREATE` por schema e `TEMP`. `is_aprovado()` precisa ser exportada antes de alterá-la. **Teste:** mesmos resultados por papel antes/depois; listas anônimas continuam funcionando. Em laboratório SQL isolado, uma tabela temporária chamada `usuarios` não pode fazer `is_admin()` retornar true.

## Cadeia de confiança e pontos positivos/limites

- **OR das policies:** políticas permissivas são somadas por OR; restrictive acrescenta AND. A migration `20260914150000_conserta_artigos_solucoes.sql:123` remove a policy ampla de leitura conhecida; `20260917090000_regras_contribuinte_e_colaborador.sql:71` remove o `FOR ALL` de escrita que concedia leitura/DELETE amplos aos contribuintes. Nenhuma das duas prova inexistência de policies extras do Studio. Inventário inclui todas as policies e `ALL`, não só `SELECT`. [PostgreSQL: RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
- **Leitura global do contribuinte continua por decisão explícita:** `artigos_leitura` ainda usa `pode_escrever_artigo()`, logo contribuinte aprovado vê artigos ativos de todos os setores/unidades. A feature de 17/09 restringiu escrita, não leitura. Não chamar isso de bypass acidental sem revisar a intenção de produto.
- **Unidades novas ampliam acesso automaticamente:** `incluir_unidade_nos_artigos` (`20260916200000_unidades_explicitas_nos_artigos.sql:65`) inclui toda unidade nova em todos os artigos existentes. Se unidades forem fronteiras de confidencialidade, a decisão documentada conflita com menor privilégio; novas unidades deveriam ser incluídas apenas em artigos explicitamente marcados como globais. É decisão estrutural, não escrita arbitrária anônima demonstrada.
- **SECURITY DEFINER e triggers:** a função executa com privilégios do owner; bypass de RLS depende do owner/superuser/BYPASSRLS/FORCE RLS. Triggers de aplicação continuam executando em INSERT/UPDATE de funções privilegiadas. O próprio histórico (`docs/plano-implementacao.md:3163`) registra esse comportamento. Não desabilitar triggers como parte dos testes de segurança.
- **Vínculo de trigger ausente:** `bloquear_autoaprovacao` é redefinida, mas seu CREATE TRIGGER inicial não está versionado. `handle_new_user` também depende de vínculo inicial ausente. É necessário conferir `pg_trigger`, `tgenabled` e ordem alfabética dos BEFORE; não basta encontrar o corpo da função.
- **Terceiros:** `terceiros` e `chamado_terceiros` habilitam RLS explicitamente (`20260917100000_terceiros.sql:31`/`:54`). A escrita depende de TI; vínculo é legível ao dono do chamado. O cadastro de fornecedores fica legível a todos os aprovados, conforme policy explícita. Fotos têm proteção diferente, abordada no relatório principal.
- **Push:** owner-only de `push_subscriptions` protege leitura/escrita entre usuários, mas não valida sintaxe/host das URLs (`20260917140000_push_notifications.sql:13`). A função de webhook lê Vault por nome e manda `to_jsonb(NEW)`; não inventar acesso cliente ao segredo apenas porque há DEFINER. Auditar grants em Vault e `net.http_request_queue` — o header com service role pode aparecer nessa fila mesmo que Vault esteja protegido. O inventário verifica ACLs sem ler segredos. Rejeitar nomes de tabela/payloads inválidos na Edge é necessário, mas não substitui autorização de origem.
- **Cadastro e desligamento de colaborador:** a nova policy nega categorias sensíveis a quem não satisfaz o helper (`20260917090000_regras_contribuinte_e_colaborador.sql:150`). A decisão usa nomes de categorias/setores, alteráveis administrativamente: prefira chaves estáveis e testes de rename. `dados_formulario` continua conteúdo informado pelo usuário; não deve iniciar provisionamento de pessoas automaticamente sem comparar categoria autorizada e estado revisado.
- **Desativação:** chamados próprios, comentários e push subscriptions não exigem `usuarios.ativo`. Um JWT ainda válido pode continuar operando esses escopos mesmo após desativação no perfil, salvo hooks/policies adicionais não versionadas. Distinguir permitir *pendente pedir ajuda* de permitir *desativado operar*. Confirmar política de produto e revogação de sessões antes de endurecer; não confundir com escalada de admin.
- **RLS filtra linhas, não campos:** a policy `usuarios: solicitante vê quem respondeu seus chamados` (`20260915120000_usuarios_ver_quem_respondeu.sql:19`) libera a linha do atendente. Sem grants de coluna/view específica, REST pode selecionar também email, unidade, perfil e preferências dessa linha; não só nome/foto que a UI pede. Inventário inclui grants de coluna. Isso não equivale a enumerar todos os usuários.
- **Ausência de UPDATE/DELETE:** manter bloqueios de histórico como positivo. Resposta REST `200/204` com zero linhas afetadas não prova sucesso de ataque; pedir representação/contagem e confirmar sobrevivência do registro. Não criar permissões para “consertar” tentativas negadas.

## Reavaliação dos itens anteriores relevantes a este complemento

| Item anterior | Estado hoje |
|---|---|
| 1 — baseline/schema | Continua válido; passou de 1 a 4 CREATE TABLE, mas as 12 bases permanecem ausentes. O reset continua sem reprodução completa |
| 2 — domínio no cadastro | Sem restrição de domínio versionada; auth remota deve ser avaliada separadamente da configuração local |
| 8 — ACLs DEFINER | Continua válido; o REVOKE apenas de anon para helpers é insuficiente; impacto do cron é limitado aos sucessos antigos |
| 10 — operações sem policy | Negação continua um controle positivo; não inventar policy mais permissiva sem requisito de produto |
| 11 — migration órfã | Continua presente `20260911_artigos_solucoes.sql`; erro de imutabilidade relatado anteriormente e timestamp irregular persistem |
| “todos helpers validados” | Mudou: oito visíveis são STABLE/no-args; `is_aprovado` não pode ser validada; search_path fixo requer reforço |
| “escalada fechada” | Perfil/admin e aprovação continuam protegidos no código; unidade é atributo de autorização desprotegido e precisa teste específico |

Não criar uma baseline renomeando um diff atual para antes de todas as migrations sem reconciliação. Uma fotografia final pode já conter mudanças que migrations históricas não idempotentes tentarão repetir. Capturar schema e ledger reais, preservar histórico, criar baseline/squash em cópia isolada e comprovar reset integral; só então planejar eventual `migration repair`. Não executar repair nem push para descobrir a ordem correta.

## Verificação e entregáveis

`scripts/security/rls-inventory.sql`: somente leitura, `BEGIN READ ONLY`/`ROLLBACK`, catálogos, ACLs efetivas, policies, funções, triggers, views, buckets e contagens; não lê conteúdo de secrets. Deve ser executado com role administrativo para dar inventário completo. Exemplo: `psql "$env:AUDIT_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/security/rls-inventory.sql` no PowerShell, com a URL fornecida fora do histórico do shell.

`scripts/security/rls-hardening-candidate.sql`: correções completas aditivas prontas para revisão em staging; **não aplicadas**. A baseline ausente impede certificar que o arquivo não conflita com objetos manuais de produção. Promover como migration apenas após inventário e regressão por solicitante pendente/aprovado/desativado, contribuinte, analista e admin. Incluir casos de negação cruzada, mensagem interna, reabertura, aprovação, autoria, setor e unidade.
