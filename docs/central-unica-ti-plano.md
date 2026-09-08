# Central Única de TI — Plano de Implementação

**Organização:** Grupo Gasômetro Madeiras
**Setor:** Tecnologia da Informação
**Autor:** Enzo Xavier Santos — Analista e Desenvolvedor
**Data:** Setembro de 2026
**Status:** Para avaliação do time de TI

---

## 1. Objetivo

Unificar em uma plataforma própria o portal de chamados, a base de soluções, a triagem prévia e o dashboard operacional do setor de TI, hospedada em domínio da empresa e sob controle integral do time.

O modelo atual depende de três ferramentas que não conversam entre si: Hipporello para abertura, Trello para atendimento e um relatório de Power BI alimentado por extração e tratamento manual no fechamento de cada mês. Não existe camada de autoatendimento, o que faz com que todo chamado, inclusive o repetitivo, chegue até um analista.

### Resultados esperados

- Redução do volume de chamados de nível I por deflexão na triagem.
- Fim do tratamento manual de dados no fechamento mensal.
- Base de conhecimento que cresce a partir dos próprios chamados resolvidos.
- Autonomia sobre os dados de atendimento, sem dependência de fornecedor externo.
- Histórico estruturado como insumo para triagem assistida por IA no futuro.

---

## 2. Escopo

Cinco módulos sobre o mesmo banco de dados:

| Módulo | Função |
|---|---|
| **Central** | Porta de entrada única com login corporativo. |
| **Base de soluções** | Artigos por categoria e unidade, com busca em português. |
| **Triagem** | Sugere artigos antes da abertura. "Isso resolveu?" encerra o atendimento sem gerar chamado. |
| **Portal do TI** | Quadro de atendimento próprio, com filas, atribuição, prioridade, SLA, comentários e anexos. Substitui o Trello. |
| **Dashboard** | Painel operacional nativo, lendo direto do banco, em tempo real. |

> **Sobre o dashboard:** é um painel construído dentro da própria plataforma, sobre o mesmo banco da operação. Não é uma integração com o Power BI. O relatório atual em Power BI pode ser mantido em paralelo durante a transição e para análises históricas.

### Fluxo do usuário

1. Acessa a Central e faz login com a conta corporativa.
2. Descreve o problema no campo de abertura.
3. A triagem retorna artigos relacionados enquanto ele digita.
4. Se um artigo resolve, ele confirma e o atendimento termina ali. A deflexão fica registrada.
5. Se não resolve, o chamado é aberto já com categoria inferida, unidade, prioridade e o histórico do que consultou.
6. O chamado entra na fila do Portal do TI e o dashboard reflete a mudança imediatamente.

---

## 3. Arquitetura

| Camada | Tecnologia | Justificativa |
|---|---|---|
| Front-end (Central, Base, Triagem) | HTML, CSS e JavaScript | Telas de leitura e formulários simples. Não justificam framework nem etapa de build. |
| Front-end (Portal do TI) | Next.js | Estado complexo, atualização ao vivo e interação intensa. Aqui o framework se paga. |
| Banco de dados | Supabase (PostgreSQL) | Postgres gerenciado, busca textual nativa em português, trilha de auditoria. |
| API | Supabase (PostgREST) + Edge Functions | REST gerado automaticamente sobre as tabelas. Edge Functions só para regras que não cabem no banco. |
| Autenticação | Supabase Auth | Login corporativo com SSO. Permissão por perfil via Row Level Security. |
| Tempo real | Supabase Realtime | Atualização do quadro e do dashboard por WebSocket. |
| Anexos | Supabase Storage | Prints e documentos vinculados ao chamado, com controle de acesso. |
| Hospedagem | Vercel | Deploy contínuo a partir do repositório, HTTPS e domínio próprio. |

### Princípios de decisão

- **A regra de permissão mora no banco.** RLS garante que um usuário de loja só enxergue os próprios chamados, independentemente de qual tela chame a API.
- **Sem camada de API redundante.** O Supabase já expõe REST sobre as tabelas; um backend só para repassar consultas adiciona manutenção sem ganho.
- **Framework só onde há complexidade.** Vanilla nas telas simples, Next.js apenas no Portal do TI.
- **Modelagem primeiro.** Com o schema correto, trocar qualquer camada acima é barato. Com o schema errado, tudo acima herda o erro.

### Modelo de dados

| Tabela | Conteúdo |
|---|---|
| `usuarios` | Colaborador, unidade, setor, perfil de acesso. |
| `unidades` | Lojas e centros de distribuição (SJC, GRU, Diadema, Uberlândia e demais). |
| `categorias` | Taxonomia: sistema, equipamentos, conexão, pedidos, financeiro, logística. |
| `chamados` | Número, solicitante, unidade, categoria, prioridade, status, responsável, datas de abertura, primeira resposta e fechamento. |
| `comentarios` | Histórico da conversa, com autor e visibilidade interna ou pública. |
| `anexos` | Arquivos vinculados ao chamado. |
| `artigos` | Base de soluções: título, conteúdo, categoria, vetor de busca. |
| `artigo_feedback` | Registro de cada "isso resolveu?", base do cálculo de deflexão. |
| `sla_politicas` | Prazo de resposta e de resolução por prioridade e categoria. |

**Busca:** primeira versão com full-text search nativo do PostgreSQL usando dicionário em português. Se as consultas escritas de forma diferente da do artigo deixarem de encontrar resultado, a evolução é busca semântica com `pgvector`, já suportada pelo Supabase e sem troca de banco.

---

## 4. Plano de implementação

Cinco fases, cada uma entregando algo utilizável por conta própria. A ordem é deliberada: a base de soluções vem antes do quadro de atendimento porque é ela que reduz volume. O quadro apenas organiza o que já entrou.

### Fase 0 — Modelagem e migração de dados
**Prazo:** 2 semanas
**Objetivo:** estabelecer o schema definitivo e trazer o histórico do Trello para dentro dele.

- [ ] Modelagem completa no PostgreSQL e políticas de Row Level Security
- [ ] Importação do JSON histórico do quadro Suporte TI
- [ ] Normalização de unidade, categoria, solicitante e responsável
- [ ] Repositório, projeto Supabase e ambiente na Vercel configurados

**Critério de conclusão:** histórico completo consultável por SQL, com contagens conferindo com o Power BI atual.

---

### Fase 1 — Base de soluções
**Prazo:** 3 a 4 semanas
**Objetivo:** publicar a documentação e observar o que os usuários realmente procuram.

- [ ] Central com login corporativo (Supabase Auth)
- [ ] Listagem e leitura de artigos por categoria e unidade
- [ ] Busca em português e registro de cada termo pesquisado
- [ ] Primeiros artigos escritos a partir dos chamados mais recorrentes do histórico
- [ ] Botão "isso resolveu?" em cada artigo

**Critério de conclusão:** base no ar em domínio próprio, divulgada às unidades, com métricas de busca sendo coletadas.

---

### Fase 2 — Triagem e abertura de chamado
**Prazo:** 3 a 4 semanas
**Objetivo:** colocar a deflexão em operação antes de migrar o atendimento.

- [ ] Formulário de abertura com sugestão de artigos em tempo real
- [ ] Confirmação de resolução encerrando o atendimento sem abrir chamado
- [ ] Abertura de chamado com categoria inferida e histórico de consulta anexado
- [ ] Notificação por e-mail de abertura e atualização

**Critério de conclusão:** taxa de deflexão medida e estável por pelo menos duas semanas.

---

### Fase 3 — Portal do TI
**Prazo:** 4 a 6 semanas
**Objetivo:** substituir o Trello como ferramenta de atendimento.

- [ ] Quadro com filas equivalentes às listas atuais e atualização em tempo real
- [ ] Atribuição, prioridade, mudança de status, comentários e anexos
- [ ] Controle de SLA por prioridade, com alerta de vencimento
- [ ] Operação em paralelo com o Trello durante todo o período

**Critério de conclusão:** time de TI operando integralmente no portal por duas semanas sem retorno ao Trello.

---

### Fase 4 — Dashboard operacional
**Prazo:** 2 a 3 semanas
**Objetivo:** encerrar o tratamento manual de dados do fechamento mensal.

- [ ] Painel em tempo real: volume, backlog, tempo médio de resolução e cumprimento de SLA
- [ ] Recortes por unidade, categoria, prioridade e analista
- [ ] Indicador de deflexão e ranking de artigos por chamados evitados
- [ ] Exportação para os relatórios de gestão

**Critério de conclusão:** fechamento mensal gerado pela própria plataforma, sem extração manual.

---

### Fase 5 — Automação e integrações
**Prazo:** contínuo
**Objetivo:** ampliar o alcance da plataforma depois que a base estiver madura.

- [ ] Vínculo entre artigos da base e treinamentos da Academia Gasômetro
- [ ] Sugestão automática de novo artigo a partir de chamados resolvidos e recorrentes
- [ ] Triagem assistida por IA sugerindo resposta de nível I com base no histórico
- [ ] Abertura e acompanhamento de chamado por e-mail

**Critério de conclusão:** cada item avaliado individualmente por ganho medido, sem prazo fechado.

---

### Migração

O Trello não é desligado em nenhum momento antes da Fase 3 estar validada. Durante todo o período de paralelo o histórico continua sendo importado, e o desligamento só acontece quando o time confirmar que não precisa mais voltar à ferramenta antiga.

---

## 5. Métricas de sucesso

Medir desde o início, com a linha de base extraída do histórico atual do Trello.

| Indicador | Como medir | Fase |
|---|---|---|
| Taxa de deflexão | Consultas resolvidas na base ÷ total de tentativas de abertura | 2 |
| Volume de chamados | Comparação mês a mês contra a linha de base do histórico importado | 2 |
| Tempo médio de resolução | Diferença entre abertura e fechamento, por categoria e prioridade | 3 |
| Cumprimento de SLA | % de chamados respondidos e resolvidos dentro do prazo | 3 |
| Cobertura da base | % de chamados abertos cuja categoria já possui artigo publicado | 1 |
| Chamados evitados por artigo | Ranking dos artigos por confirmação de resolução | 2 |

---

## 6. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Concentração de conhecimento em uma única pessoa | Documentação versionada no repositório, tecnologias de mercado e revisão de código com o time desde a Fase 0. |
| Usuário ignorar a triagem e insistir em abrir chamado | A triagem sugere, não bloqueia. O ganho vem da qualidade dos artigos, e o indicador de deflexão mostra rapidamente se a base está fraca. |
| Base de soluções desatualizar | Feedback de utilidade em cada artigo e revisão periódica dos que acumulam avaliação negativa. |
| Resistência do time à mudança de ferramenta | Operação em paralelo com o Trello durante toda a Fase 3, com paridade de recursos antes do desligamento. |
| Limite das faixas gratuitas de Supabase e Vercel | Monitoramento de uso desde a Fase 1. Planos pagos têm custo baixo e previsível, muito abaixo de licenças de helpdesk por agente. |
| Perda de dados na migração | Importação validada por conferência de contagem contra o Power BI atual, com o JSON original preservado. |

---

## 7. Decisões pendentes

Precisam de definição do time e da gestão antes do início da Fase 0.

- **Autenticação.** SSO com a conta corporativa existente ou cadastro próprio. Influencia a adoção mais do que qualquer outro item desta lista.
- **Domínio.** Endereço da central e apontamento de DNS.
- **Envio de e-mail.** Serviço de disparo e remetente institucional para as notificações.
- **Taxonomia de categorias.** Revisar e congelar a lista antes da migração, corrigindo as inconsistências do histórico.
- **Política de SLA.** Prazos por prioridade, hoje inexistentes de forma formal.
- **Responsáveis pelo conteúdo.** Quem escreve e quem revisa os artigos da base.

---

## 8. Próximos passos

1. Apresentar a proposta ao time de TI e coletar objeções.
2. Fechar as decisões pendentes acima.
3. Levantar os vinte problemas mais recorrentes do histórico, que serão os primeiros artigos da base.
4. Iniciar a Fase 0.

> **Ponto de partida com menor risco:** se houver hesitação em aprovar o projeto completo, a Fase 1 pode ser tratada como piloto isolado. Ela entrega valor sozinha, não altera nada do fluxo atual de atendimento e, ao fim, mostra com dados reais se a base de soluções reduz chamados o suficiente para justificar as fases seguintes.
