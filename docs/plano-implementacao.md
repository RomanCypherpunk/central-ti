# Central Única de TI — Plano de Implementação (execução)

**Organização:** Grupo Gasômetro Madeiras
**Autor:** Enzo Xavier Santos — Analista e Desenvolvedor
**Última atualização:** 2026-09-11
**Relação com outros documentos:** este arquivo acompanha a execução
fase a fase. A visão de produto, arquitetura de alto nível e métricas de
sucesso continuam em [central-unica-ti-plano.md](central-unica-ti-plano.md) —
esse arquivo aqui é o "o que foi feito e o que vem agora", atualizado
conforme o time avança.

---

## Fase 0 — Modelagem e regras do banco

**Status: concluída** (feita direto no Supabase Studio, fora do fluxo de
migrations da CLI — por isso não aparece em `supabase migration list`).

Projeto Supabase: `pmwcfdxryjwsvwsmcufm` (`TI gasometro`).

### O que existe hoje no banco

Tabelas (`schema public`), todas com RLS habilitado:

| Tabela | Papel |
|---|---|
| `usuarios` | Perfil do colaborador: nome, email, `setor_id`, `unidade_id`, `perfil` (default `solicitante`), `status_aprovacao` (default `pendente`), `ativo`. |
| `setores` | Setores da empresa (id, nome, ativo). |
| `unidades` | Lojas e centros de distribuição (id, nome, ativo). |
| `categorias` | Taxonomia dos chamados. |
| `filas` | Filas de atendimento do Portal do TI. |
| `chamados` | Registro de chamado: solicitante, unidade, categoria, fila, descrição, flags (urgente, prioridade, cliente na loja, sistema lento/fora), datas, `dados_formulario` (jsonb). |
| `chamado_membros` | Quem tem visibilidade/atribuição em cada chamado. |
| `chamado_retorno_pendente` | Controle de retorno de chamado para fila. |
| `comentarios` | Histórico de conversa do chamado (público/interno, humano/outro tipo). |
| `anexos` | Arquivos vinculados a chamado ou comentário. |
| `artigos` | Base de soluções (título, conteúdo, categoria, unidade, `busca_vetor` tsvector). |
| `artigo_feedback` | Registro de "isso resolveu?" por artigo. |

Funções auxiliares usadas nas policies:
- `is_equipe_ti()` — identifica se o usuário autenticado é da equipe de TI.
- `is_aprovado()` — identifica se `usuarios.status_aprovacao` permite uso
  pleno da plataforma (abrir chamado, dar feedback em artigo).

Regras de RLS já implementadas (resumo):
- Leitura de `setores`, `unidades`, `categorias`, `filas`, `artigos` liberada
  para qualquer autenticado; escrita restrita à equipe de TI.
- `chamados`: solicitante só vê/abre os próprios, e só se `is_aprovado()`;
  equipe de TI vê e atualiza todos.
- `usuarios`: cada um vê e edita o próprio perfil (`id = auth.uid()`);
  equipe de TI vê e edita todos (é aqui que a aprovação manual vai
  acontecer, no Portal do TI, mais adiante).
- **Não existe policy de INSERT em `usuarios`** — proposital: a criação da
  linha de perfil acontece via trigger (ver Fase 1), não por escrita direta
  do cliente.
- **Trigger `on_auth_user_created` em `auth.users`** já existe (criado no
  Studio, junto com o resto do schema), chamando
  `public.handle_new_user()`. Ao criar a conta no Supabase Auth, essa
  function: (1) insere a linha em `public.usuarios` com nome/email; (2)
  atualiza `setor_id`/`unidade_id` a partir de
  `raw_user_meta_data` (`setor_id`, `unidade_id`) enviados no signup; (3)
  se não vier `unidade_id`, usa a primeira unidade por ordem alfabética
  como fallback; (4) abre automaticamente um chamado na categoria
  "Aprovação de Acesso" / fila "Aprovações de Acesso", descrevendo a
  solicitação — ou seja, o fluxo de aprovação de cadastro (Fase 4) já
  nasce como um chamado normal do próprio sistema, sem precisar de tela
  dedicada.

### Decisões de arquitetura já tomadas

- Front-end das telas simples (Central, Base, Triagem, Cadastro, Login):
  HTML/CSS/JS puro, sem build, servido estático pela Vercel.
- Portal do TI (futuro): Next.js, por causa de estado complexo e tempo real.
- Banco: Supabase (Postgres) — REST automático via PostgREST, sem camada de
  API própria. Regra de permissão mora no banco (RLS), não no front nem em
  backend intermediário.
- Autenticação: Supabase Auth. Qualquer e-mail é aceito no cadastro (sem
  checagem de domínio corporativo nem lista prévia de colaboradores).
- Aprovação de cadastro: existe como campo (`status_aprovacao`) e já é
  respeitada pelas policies de `chamados`/`artigo_feedback`, mas **não
  bloqueia login nem navegação** enquanto o Portal do TI não existir — ver
  Fase 1.

---

## Fase 1.5 — Recuperação de senha

**Status: concluída** (2026-09-10) — SMTP próprio configurado (Resend),
template do código aplicado, testado pelo usuário com e-mail real.

O João Gabriel já construiu o front-end completo: `public/recuperar-senha.html`
+ `public/css/recuperar-senha.css` + `public/js/pages/recuperar-senha.js`,
mais o botão "Esqueceu a senha?" em `login.html`/`login.js`. O fluxo
esperado é: e-mail → código de 6 dígitos → `supabase.auth.verifyOtp()` →
nova senha via `supabase.auth.updateUser()`. Front-end pronto e correto.

**Bloqueio real:** o Supabase não permite customizar o template de e-mail
(trocar o link padrão `{{ .ConfirmationURL }}` pelo código `{{ .Token }}`)
no plano Free enquanto o projeto usa o provedor de e-mail compartilhado
deles — erro retornado: *"Email template modification is not available
for free tier projects using the default email provider."* Sem template
customizado, o e-mail que chega tem um link, não um código, e o formulário
de recuperação (que só aceita código de 6 dígitos) nunca funciona.

`otp_length` já foi ajustado de 8 para 6 (bate com o `maxlength="6"` do
front-end), aplicado via `supabase config push` — essa parte não depende
de SMTP e já está correta no projeto remoto.

**Resolvido com Resend** (não com Gmail — a tentativa com Gmail
`helpdeskti@madeirasgasometro.com.br` esbarrou em "Senhas de app" oculta,
comportamento normal do Google para contas recém-criadas):

- Domínio `madeirasgasometro.com.br` verificado no Resend (registros DKIM
  e SPF adicionados na zona DNS da Locaweb — coexistem sem conflito com o
  SendGrid que a empresa já usa para e-mail marketing, por usarem nomes
  de registro diferentes).
- SMTP configurado em `supabase/config.toml`
  (`[auth.email.smtp]`, host `smtp.resend.com`, porta 587) e aplicado via
  `supabase config push` — a senha (API key do Resend) é lida da variável
  de ambiente `RESEND_SMTP_PASS` no momento do push, nunca commitada em
  texto puro.
- Template do e-mail de recuperação (`supabase/templates/recovery.html`,
  mostra `{{ .Token }}`) aplicado com sucesso assim que o SMTP passou a
  existir — o erro 400 anterior ("not available for free tier... using
  the default email provider") não ocorre mais fora do provedor padrão.
- Remetente agora aparece como "TI Gasômetro Madeiras
  <helpdeskti@madeirasgasometro.com.br>" em vez de "Supabase Auth
  <noreply@mail.app.supabase.io>".
- Testado pelo usuário com e-mail real: código de 6 dígitos chegando
  corretamente.

**Pendência de segurança:** a API key do Resend foi colada uma vez direto
no chat durante a configuração — deve ser revogada no painel do Resend
(API Keys → revoke) e substituída por uma nova, gerada e usada sem passar
pelo histórico de conversa.

---

## Fase 1 — Cadastro e login

**Status: concluída** (2026-09-10) — testado de ponta a ponta manualmente
via navegador (cadastro completo, login, bloqueio sem sessão, e-mail
duplicado, senha incorreta). Contas de teste removidas do banco após a
validação.

**Objetivo:** ligar o front-end de cadastro (já construído pelo João
Gabriel, desenvolvedor front-end) e login à autenticação real do Supabase,
permitindo criar conta e entrar na plataforma. Sem tela de aprovação ainda
— isso é Fase 3 (Portal do TI). Por enquanto, criar a conta já libera o
acesso, para validar o fluxo de ponta a ponta.

### O que já existe (front-end)

- `public/cadastro.html` + `public/css/cadastro.css` + `public/js/pages/cadastro.js`:
  formulário funcional de 2 etapas (dados pessoais → acesso), com troca de
  etapa e mostrar/esconder senha já implementados. Selects de Setor e
  Unidade ainda vazios. Submit não faz nada ainda.
- `public/login.html`: só a tag de script, sem formulário.
- `public/js/pages/login.js`: vazio (comentário placeholder).
- `public/js/auth-guard.js`: redireciona para `login.html` se não há
  sessão Supabase; já funcional, não precisa mudar.

### O que falta implementar

**1. Migration: ponte `auth.users` → `public.usuarios`**

~~Não é mais necessário.~~ Verificado em 2026-09-10: o trigger
`on_auth_user_created` e a função `handle_new_user()` já existem no banco
(ver Fase 0 acima) e já leem `setor_id`/`unidade_id` dos metadados do
signup, exatamente como este plano previa. O cadastro só precisa mandar
esses metadados corretos — nenhuma migration nova é exigida para o
front-end funcionar.

Dependências confirmadas: categoria `'Aprovação de Acesso'` e fila
`'Aprovações de Acesso'` já existem nas respectivas tabelas.

**2. Configuração manual no Supabase Studio**

Desativar "Confirm email" em Authentication → Providers → Email, para o
cadastro autenticar na hora sem depender de envio de e-mail (serviço de
envio ainda é decisão pendente do plano geral). Ação manual, feita direto
no Studio por quem tem acesso — não é migration.

**3. `public/js/pages/cadastro.js`**

- Ao carregar: buscar `setores` e `unidades` (`select id, nome`, filtro
  `ativo = true`, ordenado por nome) e popular os `<option>` dos dois
  selects (`value` = uuid).
- Validação client-side no submit: nome não vazio, setor e unidade
  selecionados, e-mail em formato válido, senha ≥ 8 caracteres com
  maiúscula/número/símbolo (o texto de ajuda já promete isso), confirmação
  de senha batendo.
- Submit: `supabase.auth.signUp({ email, password, options: { data: {
  nome, setor_id, unidade_id } } })`.
- Sucesso → redireciona para `index.html`.
- Erro (e-mail duplicado, validação, etc.) → mensagem inline no formulário
  (precisa adicionar o elemento de erro ao HTML/CSS, não existe hoje).

**4. `public/login.html` + `public/js/pages/login.js`**

- `login.html` ganha formulário mínimo (e-mail, senha, botão, link para
  cadastro), reaproveitando as classes visuais `cadastro__*` já existentes
  em `cadastro.css` em vez de duplicar estilo.
- `login.js`: `supabase.auth.signInWithPassword({ email, password })`;
  sucesso → `index.html`; erro → mensagem inline.

### Problemas encontrados durante a implementação (e correções)

Nenhum estava previsto no design inicial — todos surgiram só ao testar de
ponta a ponta:

1. **Selects de setor/unidade vinham vazios.** As policies de leitura em
   `setores`/`unidades` exigiam `authenticated`, mas o cadastro roda sem
   sessão (é o formulário que cria a sessão). Corrigido com policies novas
   de `SELECT` para o role `anon` (migration
   `20260910125000_setores_unidades_leitura_anon.sql`) — dados públicos
   (só nome), sem risco.
2. **Signup retornava 500.** `handle_new_user()` fazia `INSERT` seguido de
   `UPDATE` em `usuarios` para gravar `setor_id`/`unidade_id`; esse UPDATE
   disparava a trigger `usuarios_bloquear_autoaprovacao` (que impede
   alteração de setor por quem não é da equipe de TI), derrubando a
   transação inteira. Corrigido reescrevendo `handle_new_user()` para
   gravar `setor_id`/`unidade_id` já no INSERT original, sem UPDATE
   separado (migration `20260910130000_corrige_handle_new_user.sql`).
3. **Conta criada mas sem sessão automática.** O projeto tinha
   `auth.email.enable_confirmations = true` (confirmação de e-mail
   obrigatória) — não aparecia mais como toggle "Confirm email" na tela
   de provider Email do Studio atual (parece ter sido reorganizado/
   renomeado na versão em uso). Identificado e corrigido via
   `supabase config pull` / edição de `supabase/config.toml` / `supabase
   config push`, desativando `enable_confirmations`.

### Fora de escopo nesta fase

- Tela de aprovação de cadastro (Portal do TI, Fase 3).
- Checagem de domínio de e-mail ou lista prévia de colaboradores.
- Envio de e-mail transacional / reativar confirmação de e-mail.
- Qualquer mudança nas policies de RLS existentes.

### Critério de conclusão

- Cadastro end-to-end: preencher as 2 etapas, conta criada, linha aparece
  em `public.usuarios` com os dados certos e `status_aprovacao = pendente`.
- Login end-to-end com a conta criada.
- `auth-guard.js` bloqueia sem sessão e libera com sessão.
- Casos de erro tratados: e-mail duplicado, senha fraca, credenciais
  erradas.

---

## Fase 1.8 — Home (index.html)

**Status: concluída** (2026-09-10 a 2026-09-11).

**Objetivo:** a tela que recebe o usuário logo após o login — duas portas
de entrada (Base de Soluções e Portal de Chamados) e um resumo do que
importa no dia a dia (artigos em destaque do setor da pessoa, chamados
recentes dela).

### O que existe (front-end)

`public/index.html` + `public/css/index.css` + `public/js/main.js`,
construído pelo João Gabriel em cima da mesma base de HTML/CSS/JS puro
das outras telas:

- **Barra do topo** (`.topo`): logo, nome do produto, avatar com iniciais
  do usuário, menu de perfil (dados pessoais / solicitações / soluções) e
  botão sair. `main.js` preenche nome/setor a partir de
  `supabase.auth.getUser()` e da tabela `setores`.
- **Seção de destaque** (`.destaque`): saudação personalizada com o nome
  do usuário e duas "portas" (cards) — Base de Soluções (mostra o setor de
  quem está logado) e Portal de Chamados (horário de atendimento, botão
  novo chamado).
- **Duas colunas inferiores** (`.colunas`): "Destaques da base" (lista de
  artigos, hoje com dados de exemplo fixos no HTML) e "Meus chamados
  recentes" (tabela, também com dados de exemplo) — ambos marcados no
  HTML como "VEM DO SUPABASE", ainda não ligados de verdade a uma query.
- **Entrada com fade em sequência** já implementada desde a criação
  (`.entrada`/`.entrada--visivel` em `main.js`, mesmo padrão usado em
  cadastro/login/recuperar-senha).

### Dark mode removido (2026-09-11)

A Home tinha nascido com um seletor de tema claro/escuro completo (dois
botões sol/lua no topo, `data-tema` no `<html>`, `localStorage`, uma
segunda logo branca para o tema escuro, e um bloco `[data-tema="escuro"]`
inteiro em `index.css`). Removido a pedido — a plataforma passa a ser
sempre clara, nas quatro telas que tinham algum resquício de tema:

- `index.html`/`index.css`/`main.js`: removidos o toggle, o script de
  aplicar tema antes da pintura, a segunda logo, e todo o bloco CSS de
  tema escuro (inclusive dentro do `prefers-reduced-motion`).
- `cadastro.css`, `login.css`, `recuperar-senha.css`: `color-scheme:
  light dark` trocado para `color-scheme: light` (controla só a
  aparência de elementos nativos do navegador, como scrollbar — essas
  três telas nunca tiveram toggle próprio, só herdavam o tema do SO).

### Redesign da seção de destaques/chamados (2026-09-11)

A segunda seção (destaques da base + chamados recentes) foi redesenhada
para sair do padrão genérico de "kit de cards" (chips de status com fundo
colorido, títulos em caixa alta com letter-spacing, itens de lista como
mini-cards com borda própria dentro de um card que já tem borda). Mudança
só visual, em `index.css` — nenhum comportamento ou dado mudou:

- **Títulos de seção** ("Destaques da base", "Meus chamados recentes"):
  de rótulo em uppercase para título normal (Sora, peso 600).
- **Lista de artigos**: de mini-cards com borda e sombra próprias para
  lista tipográfica com divisores finos; hover desloca o item levemente
  para a direita em vez de "levitar" com sombra.
- **Status dos chamados**: de chip preenchido para texto colorido + ponto
  (`.selo`), com uma barra de acento fina (`::before` em `td:first-child`)
  na borda esquerda de cada linha da tabela, marcando o status pela cor
  sem competir visualmente com o conteúdo. A cor da barra vem de
  `data-status` na `<tr>` (`andamento` / `resolvido` / `aguardando`) —
  hoje escrito à mão nas linhas de exemplo do HTML; quando a tabela passar
  a vir do Supabase, esse atributo precisa ser gerado junto com a linha.
- **Tabela**: cabeçalho mais discreto (peso 500, sem uppercase), coluna
  "Assunto" com `width: 100%` para absorver o espaço sobrando e não
  quebrar títulos longos em duas linhas.
- Micro-interações adicionadas no mesmo espírito das telas de
  login/cadastro: underline animado nos links "Ver tudo"/"Ver todos"
  (`.secao__link::after`), e a barra de acento da tabela "acende"
  (engrossa de 3px para 4px) no hover da linha.

### Fundo animado ajustado (2026-09-11)

A faixa laranja (`.destaque`) já tinha o mesmo efeito de "respiração" do
fundo copiado do cadastro (`radial-gradient` + `background-position`
animado), mas era quase imperceptível: o cadastro anima uma coluna
estreita e alta (35% de largura, 100% de altura), enquanto a faixa da
Home é larga e baixa — a mesma distância de deslocamento em porcentagem
representa pixels muito diferentes nos dois formatos. Ajustado
`background-size` de 160%/160% para 250%/500% (mais alcance no eixo
vertical, que é o mais curto) e o ciclo de 16s para 7s, deixando o
movimento visível sem ficar chamativo. Renomeado o keyframe de
`cadastro-fundo-respira` (nome herdado da cópia, mas incorreto neste
arquivo) para `destaque-fundo-respira`.

### Seção "Equipe de TI" (2026-09-11)

Nova seção no fim da Home, abaixo das duas colunas: quem é o time de TI e
como falar com cada um. Sete pessoas, em ordem alfabética pelo primeiro
nome, foto/iniciais + nome + cargo + e-mail, cada card no padrão shadcn.

- **HTML**: cada pessoa é um `<li class="equipe__item">` contendo uma
  `<div class="equipe__pessoa">` (o card) com duas áreas clicáveis dentro
  — um `<a class="equipe__link" href="mailto:...">` envolvendo foto, nome
  e cargo (abre o e-mail), e um `<button class="equipe__copiar">`
  separado, com o endereço de e-mail visível e um ícone de copiar. Um
  `<a>` não pode conter um `<button>` focável de forma válida, por isso o
  card virou uma `<div>` em vez do link único que era antes.
- **Copiar e-mail**: `main.js` usa `navigator.clipboard.writeText()` no
  clique do botão; por 1,5s o ícone de copiar vira um check verde
  (`.equipe__copiar--copiado`, dois SVGs sobrepostos alternados via CSS)
  e o `aria-label` muda para "E-mail copiado", depois volta ao normal. Se
  a API de clipboard falhar (sem permissão), não finge que copiou — só
  não faz nada.
- **Card**: cada pessoa é um card no padrão shadcn — superfície branca,
  borda de 1px (`#e5e5e5`), radius de 14px e sombra discreta que ganha
  profundidade no hover (`translateY(-2px)` + sombra maior + borda em tom
  laranja). O avatar tem um anel fino permanente em vez de ganhar anel no
  hover, para os dois efeitos não competirem. `.equipe__cargo` tem
  `min-height` reservando duas linhas, então todos os cards ficam com a
  mesma altura mesmo com cargos de comprimento diferente.
- **Fotos**: `public/assets/img/time-ti/<nome-sobrenome>.jpg`, um arquivo
  por pessoa — as sete já existem. Se alguma faltar,
  `onerror="this.hidden=true"` no `<img>` esconde a imagem quebrada e as
  iniciais em `.equipe__foto::before` (via `content: attr(data-iniciais)`)
  aparecem no lugar.
- **Layout**: duas listas `<ul>` separadas — a primeira com 4 pessoas
  (grid de 4 colunas), a segunda com 3 (grid de 3 colunas), ambas com a
  mesma largura de coluna e `justify-content: center`. São listas
  separadas de propósito: numa grade única de 4 colunas, `grid-column`
  não consegue centralizar 3 itens, porque isso exigiria deslocar meia
  coluna e o grid só trabalha com colunas inteiras. Em telas ≤860px as
  duas caem para 2 colunas.
- **Time atual**: Bruno Nucci (Coordenador de Projetos de TI), Daniel
  Oliveira (Coordenador de TI), Enzo Xavier (Analista de TI), Fábio Paiva
  (Gerente de Marketing e Inovação), João Gabriel (Analista de TI), João
  Paulo (Analista de TI), Paulo Silva (Analista de TI) — e-mails no
  padrão `nome.sobrenome@madeirasgasometro.com.br`, exceto Paulo Silva
  (`paulosilva@`, sem ponto, confirmado como correto).

### Fora de escopo nesta fase

- Ligar "Destaques da base" e "Meus chamados recentes" a queries reais no
  Supabase — os dados de exemplo continuam fixos no HTML até a Base de
  Soluções (Fase 2) e o Portal do TI (Fase 4) existirem de fato.
- Páginas linkadas pelo menu de perfil e pelas portas (`perfil.html`,
  `base.html`, `portal.html`, `triagem.html`) — ainda são esqueletos
  vazios ou não existem.

---

## Fase 2 — Base de soluções

**Status: não iniciada.**

A definir quando a Fase 1 estiver concluída. Ver visão geral em
[central-unica-ti-plano.md](central-unica-ti-plano.md#fase-1--base-de-soluções)
(numeração de fases do documento de proposta não bate 1:1 com este
arquivo — lá a base de soluções é "Fase 1"; aqui, por já existir schema e
cadastro prontos, ela vem depois).

## Fase 3 — Triagem e abertura de chamado

**Status: não iniciada.**

## Fase 4 — Portal do TI

**Status: em andamento** (começada em 2026-09-11). Primeiro corte do
quadro entregue: exibe filas e chamados reais do Supabase e permite
mover chamado entre filas por arrastar e soltar.

**Stack:** HTML/CSS/JS puro, como o resto do projeto — não Next.js, ao
contrário do que o plano de proposta previa. A decisão foi adiar o
framework até o estado da tela justificar o custo de introduzir build
step no projeto.

### O que existe (1º corte)

`public/portal.html` + `public/css/portal.css` +
`public/js/pages/portal.js`. O topo (barra, menu de perfil, avatar,
sair) vem de `index.css` + `main.js`, reaproveitados sem duplicar.

- **Quadro kanban**: uma coluna por fila de `filas` (ativa, na ordem de
  `ordem`), rolando na horizontal; cada coluna rola na vertical por
  dentro e ocupa a altura da tela. Contador de chamados no topo de cada
  coluna. Estrutura espelha o quadro do Trello que a equipe usa hoje.
- **Card do chamado**: etiqueta de prioridade (Urgente / Prioridade
  conforme as flags, ou Normal quando nenhuma está marcada — todo card
  sempre tem uma, como no Trello), título no formato `Categoria |
  Ticket-N`, status, e iniciais dos membros de `chamado_membros`. Visual
  no mesmo vocabulário dos cards da Home (borda fina, radius, sombra que
  aprofunda no hover), em escala reduzida para caber mais coluna na tela.
- **Fundo**: o mesmo degradê animado da faixa da Home
  (`destaque-fundo-respira`, reaproveitado de `index.css`), em vez de
  fundo neutro.
- **Status derivado**: não existe coluna de status em `chamados` — o card
  deriva de quem falou por último. Tem `fechamento_em` → Fechado; nenhum
  comentário humano público → Aberto; último é do solicitante → Usuário
  respondeu; último é da equipe → Aguardando retorno. Nota interna
  (`visibilidade = 'interno'`) e mensagem automática (`tipo = 'sistema'`,
  a que o trigger de cadastro gera) não mudam o status.
  As cores dizem de quem é a vez: **Aberto azul** (chegou, ninguém pegou),
  **Aguardando retorno verde** (a bola está com o usuário), **Usuário
  respondeu amarelo** (voltou para a equipe, é o que pede ação) e
  **Fechado cinza** (saiu do fluxo). Os quatro são tokens
  (`--status-*`), com versão própria no tema escuro.
- **Arrastar e soltar**: API nativa do navegador, sem lib. O card se move
  na hora, o `update` em `chamados.fila_id` vai em seguida gravando
  também `fila_anterior_id`; se o banco recusar, o card volta para a
  coluna de origem e aparece um aviso de erro. Arrastar perto da borda
  esquerda ou direita puxa o quadro automaticamente (mais rápido quanto
  mais perto da borda), senão não dá para levar um card até uma fila que
  está fora da tela.
- **Puxar o quadro pelo fundo**: segurar o botão do mouse no vazio do
  quadro e arrastar rola na horizontal, como no Trello. Em cima de um
  card não pega — ali quem manda é o arrastar-e-soltar.
- **Barra de rolagem própria**: a nativa fica onde a área de rolagem
  termina — no meio da tela, já que as colunas têm a altura do conteúdo.
  A nativa foi escondida e uma barra discreta e translúcida foi desenhada
  colada no rodapé, de fora a fora, com alça arrastável e clique no
  trilho para pular.
- **Busca**: campo no cabeçalho, ao lado do título. Filtra por número do
  ticket, categoria, solicitante, unidade e texto da descrição, e mostra
  os resultados num dropdown abaixo do campo (título `Categoria |
  Ticket-N` e, em cinza, fila • solicitante • unidade). Clicar leva até o
  card no quadro e o destaca por um instante. Busca em memória, sobre os
  chamados já carregados — sem ida extra ao banco.
- **Acesso**: `portal.js` verifica o perfil do usuário e manda quem é
  `solicitante` de volta para a home. É proteção de UX — quem protege os
  dados de verdade continua sendo o RLS.
- **Detalhe do chamado**: clicar num card abre um `<dialog>` nativo (que
  já traz fundo esmaecido, Esc e foco preso). À esquerda: título, a ficha
  de dados, prioridade e membros lado a lado, descrição e a
  correspondência logo abaixo; à direita, a lista de anexos. Dá para
  editar título e descrição (texto livre, salva ao sair do campo),
  ligar/desligar as etiquetas de prioridade e adicionar/remover membros
  da equipe. Cada alteração grava no banco na hora e atualiza o card no
  quadro.
- **Ficha de dados**: logo abaixo do título, uma grade de duas colunas
  com solicitante, abertura, e-mail, unidade, categoria, cliente na loja,
  sistema lento ou fora do ar e acesso remoto — o que o Trello escondia
  dentro do texto da descrição. **Todos os campos aparecem sempre**: os
  que ainda não têm valor mostram "Não informado" em cinza claro, porque
  para o analista "ninguém preencheu" é informação, não motivo para
  sumir com a linha. Os dois sim/não viram selo, laranja quando "Sim",
  já que são eles que mudam a urgência do atendimento. A grade é de duas
  colunas fixas: com `auto-fit` a última linha sobrava uma célula vazia,
  que aparecia como um buraco cinza no meio da ficha. Prioridade e
  membros passaram a dividir uma linha para a ficha inteira caber acima
  da dobra, sem empurrar a conversa para baixo.
  Os campos `cliente_na_loja`, `sistema_lento_ou_fora` e `acesso_remoto`
  já existem em `chamados`, mas hoje chegam vazios — quem vai preenchê-los
  é o formulário de abertura/triagem da Fase 3.
- **Correspondência**: é o canal de atendimento — o analista escreve ali
  e a mensagem vai para o solicitante. Tudo que se escreve é público
  (`visibilidade: 'publico'`, `tipo: 'humano'`); nota interna não existe
  nesta tela, por decisão de produto. Responder muda o status derivado do
  card de "Aberto" para "Aguardando retorno" na hora, sem recarregar.
- **Anexos**: lista na coluna direita, ordenada do mais recente. Clicar
  abre o arquivo (imagem ou PDF) numa aba nova. Dá para anexar junto com
  a mensagem, pelo clipe ao lado do campo de escrita.

### Textos rápidos (2026-09-11)

Migration `20260911201500_textos_rapidos.sql`. Respostas prontas que o
analista insere no campo de resposta — substitui a funcionalidade de mesmo
nome do Hipporello.

Tabela `textos_rapidos`: `titulo`, `corpo`, `ativo`, `criado_por`,
`criado_em`, `atualizado_em` (mantido por trigger — sozinho ele ficaria
com a data da criação para sempre).

- **Compartilhados**, não pessoais: a lista é uma só para a equipe, porque
  o ponto é padronizar o que o usuário recebe.
- **RLS mais fechada que `filas`/`categorias`**: nelas qualquer autenticado
  lê; aqui a leitura também exige `is_equipe_ti()`, porque texto rápido é
  ferramenta interna de atendimento e não interessa ao solicitante.
- **Excluir desativa** (`ativo = false`) em vez de apagar: some da lista
  sem quebrar histórico.
- **Inserir não envia**: o texto entra no campo e o cursor fica no fim,
  para o analista ajustar antes de responder. Se já havia algo escrito, o
  conteúdo é preservado e o texto entra depois de uma linha em branco.
- A lista vai ao banco uma vez por sessão do painel; busca e filtro são em
  memória. Criar/editar/excluir acontece no próprio painel, sem sair do
  chamado.
- Esc fecha só o painel (`stopPropagation`), senão o `<dialog>` fecharia o
  chamado inteiro.

Dois textos entraram na migration (Resposta Inicial e Falta de
informações), tirados dos que a equipe já usava, para a lista não nascer
vazia.

### Menu do perfil por papel (2026-09-11)

O atalho do **Portal de Chamados** no menu do perfil aparece só para quem é
`perfil = 'admin'`. O item nasce com `hidden` no HTML e o `main.js` o revela
— que já lia a linha do usuário para montar o topo, então não custou uma
consulta a mais.

- **Esconder link não é controle de acesso**: o `portal.js` passou a exigir
  `admin` também (antes aceitava qualquer um que não fosse `solicitante`),
  senão um analista continuaria entrando pela URL. Quem não é admin vai
  para a home; quem não está logado, para o login (`auth-guard.js`).
- Os quatro papéis possíveis são `solicitante`, `analista`, `admin` e
  `parceiro`. Hoje os três da equipe são `admin`, então ninguém perdeu
  acesso — mas vale saber ao criar um analista no futuro.
- **"Solicitações" passou a apontar para `solicitacoes.html`**, e não mais
  para o Portal. Os dois itens levavam ao mesmo lugar, o que confundia: o
  Portal é a tela de quem atende, Solicitações é a de quem abriu o chamado.
  A página existe por enquanto como **estrutura crua** — topo e guarda de
  sessão prontos, falta a lista (buscar `chamados` por `solicitante_id`,
  mostrar número, título, status derivado e data).

### Nome e sobrenome separados (2026-09-11)

Migration `20260911193000_usuarios_nome_sobrenome.sql`. `usuarios.nome`
passa a guardar **só o primeiro nome** e entra a coluna `sobrenome`.

- **Por que separar**: a saudação da home e os cards do Portal mostram só o
  primeiro nome. Cortar na primeira palavra em JavaScript não serve —
  "João Paulo" e "João Gabriel" virariam dois "João" iguais no quadro. Quem
  decide onde corta é a pessoa, no cadastro.
- **Os três cadastros existentes** foram divididos na mão (João Paulo /
  Cardoso Antunes, João Gabriel / Arantes, Enzo / Xavier), porque são poucos
  e ambos os Joãos têm nome composto. A migration ainda traz um fallback
  (1ª palavra / resto) para qualquer cadastro feito entre o deploy e ela.
- **`handle_new_user()`** lê `nome` e `sobrenome` do metadata do signUp; a
  descrição do chamado de acesso continua com o nome completo.

Onde cada forma aparece:

| Lugar | Mostra | Por quê |
|---|---|---|
| Saudação da home, topo | `nome` | Tratamento direto |
| Card do Portal, balão do chat | `nome` | É conversa, não documento |
| Lista de escolher membro | completo | É onde se confunde um João com outro |
| Ficha do chamado (Solicitante) | completo | Identifica a pessoa |
| Busca | completo | Procurar por sobrenome tem de achar |
| `title` dos avatares | completo | O balão já mostra o primeiro nome |

Também **`main.js` passou a ler da tabela `usuarios`** em vez do
`user_metadata`: o metadata é uma foto do momento do cadastro e não
acompanhava quem editava o nome em "Dados pessoais" — o topo ficava com o
nome antigo até a sessão ser renovada.

### Tema escuro do Portal (2026-09-11)

O modo escuro tinha sido tirado de todas as telas; voltou **só no Portal**,
que é onde a equipe passa o dia. O botão fica no topo, ao lado do perfil, e
alterna sol/lua — um botão só, e o ícone mostra para onde vai, não onde está.

- **Cores pedidas**: `#101204` no lugar do branco (fundo das filas) e
  `#242529` nos cards. O degradê laranja do quadro **fica como está** nos
  dois temas — é a identidade da tela.
- **Tokens em vez de seletores repetidos**: `portal.css` tinha ~80 cores
  fixas. Em vez de duplicar cada seletor sob `[data-tema="escuro"]` (como
  era antes no index, e que dá manutenção dobrada), as cores viraram
  variáveis no `body.portal-pagina` e o tema escuro redefine ~30 tokens.
  Cor nova daqui em diante: usar token, e os dois temas já saem de graça.
- **`color-scheme: dark`**: sem isso a barra de rolagem do modal ficava
  branca e brilhava no meio do escuro.
- **O que *não* segue o tema**: os balões do chat continuam claros nos dois
  temas (`#facfc0` equipe, `#e4e4e5` solicitante — é a cor de SMS que foi
  pedida), então o texto dentro deles é escuro **sempre**. Se usasse
  `var(--texto)` viraria branco no escuro e sumiria dentro do balão. Mesma
  regra para o título e a busca, que ficam sobre o degradê laranja.
- **Escopo**: a chave do localStorage é `tema-portal` e os ajustes do topo
  estão presos a `.portal-pagina`. As outras telas continuam só no claro,
  mesmo com o escuro salvo — conferido no navegador.
- Um `<script>` no `<head>` aplica o tema antes da primeira pintura, senão
  a tela pisca em claro ao recarregar.

### Coluna `titulo` em chamados (2026-09-11)

Migration `20260911171523_chamados_titulo.sql` adiciona `chamados.titulo`.
Um chamado novo nasce com `Categoria | Ticket-N` (trigger
`chamados_preencher_titulo`, `AFTER INSERT` porque `numero` é
`GENERATED ALWAYS AS IDENTITY` e só existe depois da inserção), e daí em
diante o título é texto livre, editável pelo detalhe — como no Trello,
onde títulos viram coisas como "SJC SR VALTER - Equipamentos |
Ticket-14572". Mudar a categoria depois **não** reescreve o título, para
não apagar uma edição manual sem aviso. Chamados que já existiam foram
preenchidos com o formato padrão.

### Bootstrap de aprovação (2026-09-11)

Ao testar, o quadro apareceu vazio mesmo com chamados no banco: as
policies de `chamados` dependem de `is_equipe_ti()`, que exige perfil de
TI **e** `status_aprovacao = 'aprovado'`. Os três usuários da equipe
eram `admin` mas estavam todos `pendente` — ninguém enxergava chamado
nenhum, e ninguém podia aprovar ninguém, porque o próprio Portal que
faria a aprovação estava bloqueado. A trigger
`usuarios_bloquear_autoaprovacao` recusava até o update vindo da CLI
(sem usuário autenticado, `is_equipe_ti()` também é falso).

Resolvido com um bootstrap pontual: numa transação só, a trigger foi
desabilitada, os três usuários da equipe marcados como `aprovado`, e a
trigger reabilitada. Daqui em diante a aprovação dos demais acontece
pelo fluxo normal, com a equipe já aprovada podendo aprovar.

### Fila "Aprovações de Acesso" removida (2026-09-11)

A fila dedicada a pedidos de acesso saiu do quadro: esses chamados
passam a cair em "Internet, Conexão e Telefonia", junto com o resto do
atendimento. Migration `20260911164601_remove_fila_aprovacoes_acesso.sql`
move os chamados que estavam nela, limpa as referências em
`fila_anterior_id` e `chamado_retorno_pendente`, reescreve
`handle_new_user()` para apontar para a fila nova, e só então apaga a
linha em `filas`. O quadro passou de 9 para 8 colunas.

### Bucket de anexos (2026-09-11)

Migration `20260911172858_bucket_anexos.sql` cria o bucket `anexos`,
**privado**: o arquivo só é alcançável por URL assinada, gerada na hora do
clique e válida por 60s — nunca fica exposto numa URL solta. O caminho do
arquivo começa pelo id do chamado (`<chamado_id>/<timestamp>-<nome>`), e é
isso que permite às policies do Storage amarrarem a permissão do arquivo à
permissão do chamado: a equipe de TI vê e envia em qualquer um, o
solicitante só nos próprios.

### Foto de perfil e tela "Dados pessoais" (2026-09-11)

A conversa mostra a foto de quem escreveu, e essa foto é a que a própria
pessoa envia — não um arquivo fixo no repositório. Isso exigiu criar a
peça inteira, que não existia:

- Migration `20260911175012_foto_perfil.sql`: coluna `usuarios.foto_path`
  e bucket `avatares`. Este é **público**, ao contrário do de anexos: um
  avatar aparece na conversa de todo mundo que participa do chamado, e
  URL assinada de validade curta não serve para uma `<img>` que fica na
  tela. Não há dado sensível numa foto de perfil. O arquivo é nomeado
  pelo id do usuário, e é isso que garante nas policies que ninguém
  troca a foto de outra pessoa.
- `public/perfil.html` + `css/perfil.css` + `js/pages/perfil.js`: a tela
  "Dados pessoais" do menu, que até então apontava para uma página
  inexistente. Permite enviar/remover a foto, editar o nome e trocar a
  senha (reaproveitando o fluxo de recuperação por código que já existe,
  em vez de duplicar validação de senha). E-mail e setor aparecem em
  leitura — setor só a equipe de TI muda, por causa da trigger
  `usuarios_bloquear_autoaprovacao`. Estilo copiado das telas de cadastro
  e login.
- No Portal, o avatar da conversa usa `usuarios.foto_path` e cai nas
  iniciais quando a pessoa não tem foto.

### Próximos cortes (não feitos ainda)

- Fechar chamado, controle de SLA e alerta de vencimento.
- Aprovar cadastro pela própria tela, em vez de tratar o chamado de
  "Aprovação de Acesso" à mão.
- Tempo real (Supabase Realtime): hoje o quadro só atualiza ao recarregar
  — dois analistas com o Portal aberto não veem as ações um do outro.
- O solicitante ainda não tem por onde responder: a correspondência é
  gravada como pública, mas não existe tela do lado dele nem envio de
  e-mail avisando da resposta.

## Fase 5 — Dashboard operacional

**Status: não iniciada.**

## Fase 6 — Automação e integrações

**Status: não iniciada.**
