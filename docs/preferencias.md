# Preferências do Enzo — Central Única de TI

Arquivo de referência rápida, separado do [plano de implementação](plano-implementacao.md)
(que é o histórico do que foi feito). Este aqui é "como trabalhar", não "o que já foi feito".

## Git e commits

- **Nunca commitar sem autorização explícita, por instância.** Aprovação de
  uma mudança não é aprovação para commitar — são pedidos separados.
  Migrações de banco, por exemplo, são aplicadas direto no Supabase via
  `db query --file` e ficam como arquivo não commitado até autorização.
- Branch atual de trabalho é `main` direto — sem branch de feature por
  padrão, a menos que peça.
- `supabase-config.js` é commitado de propósito (chave publicável, não
  secreta) — nunca tentar escondê-lo ou movê-lo para `.env`; já causou bug
  de senha na URL quando alguém tentou "proteger" isso antes.

## Conexão com o banco (Supabase)

- Projeto linkado: `pmwcfdxryjwsvwsmcufm`. Sempre usar
  `npx supabase db query --linked --file <arquivo>` — **nunca** o comando
  sem `--linked` (ele tenta Postgres local via Docker e falha com
  `ECONNREFUSED`, sem esse projeto ter ambiente local configurado).
- **Testar mudanças de RLS/trigger dentro de transação com rollback**, nunca
  direto: `begin; set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub', '<uuid>', 'role','authenticated')::text, true); ...; rollback;`.
  Isso permite simular qualquer usuário (inclusive criando um `auth.users`
  sintético dentro da própria transação) sem deixar rastro.
- **Cuidado com dados de teste que colidem com contas reais.** O usuário já
  tem contas de teste no banco de produção (ex.: "Vendedor Teste") — usá-las
  é ok, mas sempre restaurar o estado original depois (mesmo
  `status_aprovacao`, mesmo `fechamento_em`). Nunca mexer na conta pessoal
  do usuário (`enzo.xs@hotmail.com`) sem perguntar antes, mesmo para teste.
- **Antes de escrever uma migração para "consertar" um fluxo, procurar se já
  existe function/trigger para isso.** Várias vezes já existiam functions
  `SECURITY DEFINER` criadas direto no Supabase Studio, sem arquivo de
  migração local (`handle_new_user`, `reabrir_chamado`, `aprovar_acesso`,
  `rejeitar_acesso`, sistema de triagem inteiro) — sempre rodar
  `select proname from pg_proc where prosrc ilike '%<palavra-chave>%'` antes
  de desenhar uma solução do zero.
- RLS deste projeto segue um padrão: policies simples (`USING`/`WITH CHECK`)
  para o que dá para expressar direto, e RPCs `SECURITY DEFINER` (com
  checagem de permissão manual dentro da function) para operações que
  precisam de lógica condicional que RLS puro não expressa bem (ex.:
  "só pode reabrir, não editar outros campos"). **Preferir RPC a
  trigger `BEFORE UPDATE` de restrição** — um trigger de restrição em cima
  de UPDATE genérico tende a colidir com outras functions internas que
  também fazem UPDATE na mesma tabela em nome do mesmo usuário.

## Padrão de código

- **Vanilla HTML/CSS/JS, sem build step**, servido estático pela Vercel.
  Next.js foi cogitado na proposta original mas adiado — só entra se o
  estado da tela justificar.
- Comentários em português, no mesmo tom do resto do arquivo: explicam o
  *porquê* de uma decisão não óbvia, não o que o código já diz sozinho.
- Nomes de variável/função em português (`campoDados`, `desenharLista`,
  `ehAprovacaoDeAcesso`).
- `data-*` attributes para hooks de JS, nunca `id`/classe como seletor de
  comportamento (classe é para estilo).
- Elemento nativo `<dialog>` para todo modal (backdrop, Esc, foco preso de
  graça) — não reinventar com `<div>` + `position: fixed`.
- Padrão "nasce escondido, JS revela" (`data-equipe-ti`, `data-menu-portal`)
  para conteúdo condicionado a papel/permissão — mas **cuidado**: isso só
  funciona se o CSS tiver `[hidden] { display: none !important; }`
  declarado. Sem essa regra, uma classe com `display` explícito na mesma
  especificidade vence o atributo nativo silenciosamente. Já faltava em
  `index.css` (existia em `base.css`/`nova-solucao.css`) — checar isso
  sempre que introduzir um novo esconde/revela num arquivo CSS novo.
- Tempo real (Supabase Realtime) segue o padrão do Portal
  (`ligarTempoReal` em `portal.js`): canal por página, debounce por
  chamado (várias mudanças em sequência viram uma busca só), reconciliação
  em memória, ressincronização ao voltar a aba/reconectar. Replicar esse
  padrão reduzido (sem quadro/fila/drag) em telas novas que mostrem dados
  ao vivo, em vez de inventar um esquema novo.
- CSS: `portal.css` usa um sistema de tokens (`--superficie`, `--texto`,
  `--status-*`); `base.css`/`nova-solucao.css` (tela do João Gabriel)
  **não** usam tokens — são sistemas de design deliberadamente separados,
  não misturar.
- Ao esconder/mostrar link de navegação por permissão, replicar em **todos**
  os pontos de entrada (menu do topo em cada página, não só a home) — já
  aconteceu de corrigir só a home e esquecer o menu de outras 4 telas.

## Padrão de design

- Identidade visual: laranja `#dd5b12` como cor primária, tokens de status
  (aberto=azul `#2c5c96`, aguardando retorno/andamento=amarelo `#a37a0a`,
  aguardando você=vermelho `#d64545`, fechado=cinza `#8a8a8a`) replicados
  de forma consistente em Portal, Home e Solicitações.
- Fontes: Sora nos títulos/destaques, Poppins no corpo.
- Fundo "respirante" (gradiente animado) em telas de auth e Portal: sempre
  **20s de ciclo**, nunca mais rápido (foi corrigido de 7s por já ter sido
  rápido demais uma vez — abaixo de 0.2Hz de oscilação, senão incomoda).
- Botão desativado (sem permissão): cinza claro `#d4d4d8`/texto `#71717a`,
  sem hover nem brilho, sem `href` (não só `disabled` — remover o link de
  fato). Nunca esconder o botão inteiro quando dá para explicar por que
  está apagado.
- Avatar: foto de perfil (`foto_path`, bucket `avatares`) com fallback para
  iniciais coloridas — a mesma foto em todo canto que uma pessoa aparece
  (Portal, chat, conta, menu do topo). Nunca miniatura própria por tela.
- Ao revisar design, preferir ajuste pontual e cirúrgico sobre refatoração
  ampla, mesmo quando uma auditoria (ex.: lente de design da Apple) aponta
  vários pontos — perguntar prioridade em vez de aplicar tudo de uma vez.

### Padrão shadcn

O usuário pede explicitamente o **padrão visual shadcn/ui** para componentes
novos (cards, listas, formulários) — mesmo o projeto sendo vanilla CSS, sem
a lib React. É um vocabulário visual a seguir à mão, não uma dependência a
instalar:

- Superfície branca (ou `var(--superficie)` onde o arquivo usa tokens),
  borda de 1px em cinza claro (`#e5e5e5` / `var(--borda-suave)`),
  `border-radius` generoso (12–14px), sombra discreta em repouso que
  ganha profundidade no hover (`translateY(-2px)` + sombra maior + borda
  em tom da cor primária).
- Exemplo já implementado no projeto: os cards da seção "Equipe de TI" na
  Home (`.equipe__pessoa` em [index.css](../public/css/index.css), HTML em
  [index.html](../public/index.html)) — documentado em
  [plano-implementacao.md](plano-implementacao.md), na seção
  `### Seção "Equipe de TI" (2026-09-11)`. Usar como referência de "isto é
  shadcn neste projeto" antes de desenhar um card novo do zero.
- A barra de status de 5px nos cards do Portal/Solicitações
  (`.chamado__barra` em [solicitacoes.css](../public/css/solicitacoes.css))
  segue a mesma lógica de hierarquia visual discreta — um único elemento
  de destaque, resto quieto — mesmo sem ser um card shadcn clássico.
- Se o pedido não deixar claro se é "padrão shadcn" ou algo mais autoral,
  perguntar — telas como Solicitações já foram construídas assim de
  propósito ("estilo visual que já estamos utilizando... e também
  utilizando o padrão shadcn.ui").

### Onde olhar para cada arquitetura de tela

Antes de montar uma tela nova, ler a mais parecida entre as que já existem
— cada uma resolveu decisões de arquitetura que vale reaproveitar em vez de
redescobrir:

| Tela | HTML | CSS | JS | Quando usar de referência |
| --- | --- | --- | --- | --- |
| Login/Cadastro/Recuperar senha | [login.html](../public/login.html), [cadastro.html](../public/cadastro.html), [recuperar-senha.html](../public/recuperar-senha.html) | arquivos correspondentes em `public/css/` | idem em `public/js/pages/` | Fundo respirante, cartão de auth, `<script>` inline no `<head>` para aplicar tema antes da 1ª pintura |
| Home | [index.html](../public/index.html) | [index.css](../public/css/index.css) | [index.js](../public/js/pages/index.js) | `.topo` (header padrão do site), sistema de tokens de cor, seção "Equipe de TI" (padrão shadcn), cards de destaque/resumo com dados reais |
| Portal de Chamados | [portal.html](../public/portal.html) | [portal.css](../public/css/portal.css) | [portal.js](../public/js/pages/portal.js) | Tela mais complexa do projeto: quadro com filas, `<dialog>` de detalhe, tempo real (`ligarTempoReal`), zoom do quadro, menu de 3 pontos, tema escuro, sistema de tokens completo — referência obrigatória para qualquer feature de tempo real ou permissão condicional |
| Solicitações (visão do solicitante) | [solicitacoes.html](../public/solicitacoes.html) | [solicitacoes.css](../public/css/solicitacoes.css) | [solicitacoes.js](../public/js/pages/solicitacoes.js) | Versão reduzida do Portal para quem abriu o chamado — mesma lógica de tempo real e status, sem quadro/fila/drag. Boa referência para "a mesma informação do Portal, do lado de outra pessoa" |
| Dados pessoais | [perfil.html](../public/perfil.html) | [perfil.css](../public/css/perfil.css) | [perfil.js](../public/js/pages/perfil.js) | Upload de foto de perfil, troca de senha — referência para formulário simples de edição de conta |
| Base de Soluções / Nova Solução | [base.html](../public/base.html), [nova-solucao.html](../public/nova-solucao.html) | [base.css](../public/css/base.css), [nova-solucao.css](../public/css/nova-solucao.css) | [base.js](../public/js/pages/base.js), [nova-solucao.js](../public/js/pages/nova-solucao.js) | **Sistema de design separado** (sidebar laranja sólida, sem tokens CSS) — é a área do João Gabriel; usar de referência só para entender o que existe, não misturar estilo com o resto do site sem alinhar com ele antes |
| `dashboard.html` / `triagem.html` | — | — | — | Esqueleto do commit inicial, nunca desenvolvido — **não usar como referência de padrão**, é código morto |

`main.js` e `auth-guard.js`/`acesso-guard.js` (em `public/js/`) são
compartilhados por quase toda página autenticada — checar lá antes de
duplicar lógica de header/avatar/permissão numa tela nova.

## Fluxo de trabalho preferido

- Ao mexer em RLS/trigger/lógica de permissão, **testar de verdade antes de
  declarar pronto** — não confiar só na leitura do código. Esta sessão teve
  pelo menos dois casos de "parecia certo, não estava" que só apareceram
  testando de ponta a ponta (bug de duplicação de zoom, trigger de
  restrição colidindo com function interna).
- Ao usar Playwright para testar, sempre limpar screenshots/arquivos
  temporários e restaurar dados de teste no banco ao final — nunca deixar
  lixo de teste em produção nem no working tree do git.
- **Testar arrastar-e-soltar (HTML5 drag) com `locator.dragTo()`, nunca com
  `DragEvent` disparado via `dispatchEvent`.** O evento sintético deixa
  escolher o `target` à mão — o que esconde bugs reais de detecção de alvo,
  porque um `dragstart` de verdade sempre reporta `target` como o elemento
  que tem `draggable="true"` (nunca um descendente, não importa o pixel
  pressionado). Foi exatamente esse bug que passou pela primeira rodada de
  teste (com `DragEvent` sintético) na feature de arrastar lista do Portal
  e só apareceu quando o usuário tentou usar de verdade — `dragTo()`
  simula o gesto real (mousedown → mousemove → mouseup, o Chromium decide
  quando é um drag) e teria pegado o bug na hora.
- Perguntar antes de expandir escopo (ex.: "esconder também em outras 6
  telas, ou só onde pedi?") em vez de assumir a interpretação mais ampla.
- Um único arquivo `.md` (`docs/plano-implementacao.md`) concentra todo o
  histórico de implementação, atualizado incrementalmente por fase — não
  criar arquivos de spec separados por feature.
