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

**Status: não iniciada.** É aqui que a aprovação manual de cadastro
(`status_aprovacao`) ganha uma tela de verdade — até lá, fica só
registrada no banco.

## Fase 5 — Dashboard operacional

**Status: não iniciada.**

## Fase 6 — Automação e integrações

**Status: não iniciada.**
