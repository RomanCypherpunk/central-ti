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

- Páginas linkadas pelo menu de perfil e pelas portas (`perfil.html`,
  `base.html`, `portal.html`, `triagem.html`) — ainda são esqueletos
  vazios ou não existem.

### "Soluções em destaque" e "Suas últimas solicitações" com dados reais (2026-09-14)

As duas seções eram HTML fixo (3 soluções e 4 chamados de exemplo,
hardcoded). `public/js/pages/index.js`, novo — antes a home não tinha
JS próprio, só reaproveitava `main.js`.

**Soluções em destaque**: `select("*")` simples em `artigos`, sem
filtro de setor no cliente — a RLS de `artigos_leitura` (a mesma da
Fase 2, `is_equipe_ti() OR autor_id = auth.uid() OR meu_setor_id() =
any(setores)`) já resolve sozinha quem vê o quê. Testei isso de forma
rigorosa: simulei sessão de um solicitante do setor Vendas direto no
Postgres (`set_config('request.jwt.claims', ...)`) com dois artigos de
setores diferentes cadastrados — ele só recebeu o do próprio setor.
Quem é equipe de TI (`is_equipe_ti()`) vê de todos os setores, sem
precisar de nenhuma lógica extra na página: é a mesma regra de sempre,
só herdada.

**Suas últimas solicitações**: os chamados do próprio usuário
(`solicitante_id = auth.uid()`), com o status derivado do mesmo jeito
que o Portal (`derivarStatus`, olhando quem foi o último a comentar
publicamente) — mas em **vocabulário de solicitante**, não de
analista. É a mesma informação, lida de dois lados:

| Portal (visão do analista) | Home (visão do solicitante) | Cor |
|---|---|---|
| Aberto | Aberto | azul `#2c5c96` |
| Usuário respondeu (a bola virou da equipe) | Em andamento | amarelo `#a37a0a` |
| Aguardando retorno (equipe já respondeu, espera o usuário) | Aguardando você | vermelho `#d64545` |
| Fechado | Fechado | cinza `#8a8a8a` |

O resumo do cabeçalho ("N em andamento · N aguardando você") conta
sobre *todos* os chamados abertos da pessoa, não só os 4 que aparecem
na tabela — por isso é uma segunda consulta, mais enxuta (só as colunas
que decidem o status). Chamado fechado não entra no resumo.

Testado no navegador, os 4 estados um por um (fechando o chamado e
inserindo comentários de teste direto no banco, depois revertido):
cada selo apareceu com o texto e a cor certos, a barra colorida à
esquerda da linha bateu, e o resumo atualizou. Zero erro no console.

---

## Fase 2 — Base de soluções

**Status: funcionando** (front-end feito pelo João Gabriel, banco
consertado em 2026-09-14 — ver "Conserto do banco" abaixo). Portado do
projeto GASO, com ajustes para o schema daqui. Quem mexe no front desta
parte é o João Gabriel; antes de mudar o design ou os campos do
formulário, alinhar com ele.

### O que existe (front-end)

`public/base.html` (listagem) + `public/nova-solucao.html` (cadastro/
edição), cada um com seu CSS e JS próprios
(`css/base.css` + `js/pages/base.js`,
`css/nova-solucao.css` + `js/pages/nova-solucao.js`). Design system
próprio — sidebar colapsável laranja à esquerda, cards brancos — **não
reaproveita os tokens do Portal** (`var(--superficie)` etc.) nem tem
tema escuro; é visualmente uma sub-área separada do resto do site.

**Listagem (`base.html`)**: busca com ranking (título pesa mais que
descrição, que pesa mais que setor/sintomas/código; título idêntico ao
termo digitado dispara para o topo), 4 filtros (tipo, setor, autor,
período) combináveis com chips removíveis, alternância grade/lista
(salva a escolha em `localStorage`), ordenar por mais recente/antiga.
Card mostra tipo (selo colorido), título, descrição, até 2 tags
(setor/sintoma) e autor. Clicar abre um painel lateral com o registro
inteiro: passo a passo com galeria de imagens (clicável, abre em
lightbox), anexos, soluções relacionadas (clicáveis, trocam o painel
para a outra solução), editar (vai para `nova-solucao.html?id=`) e
excluir (confirmação com 5s de espera obrigatória antes do botão
habilitar — decisão deliberada contra clique por impulso).

**Cadastro (`nova-solucao.html`)**: escolher um de dois tipos —
**Erro/Correção** ou **Procedimento** — abre um formulário que muda de
cara conforme o tipo (código de erro só aparece em "Erro"). Título,
descrição, sintomas/palavras-chave como tags, passo a passo
reordenável por arrastar (cada passo aceita até 3 imagens, inclusive
colar com Ctrl+V), anexos por arrastar-e-soltar ou seleção de arquivo,
busca de soluções relacionadas para vincular, "Nº da página" + "Caminho"
do ERP (concatenados em um campo só na hora de salvar), setores que
enxergam a solução (multi-select com "Marcar todos") e autor (texto
livre — quem resolveu pode não ser quem cadastra). Mesma tela serve
para editar: com `?id=` na URL, carrega o registro e troca "Salvar" por
"Confirmar edição".

### Conserto do banco (2026-09-14)

**Estava quebrado**: salvar dava `PGRST204: Could not find the
'anexos' column of 'artigos' in the schema cache`. A causa era a
migration `20260911_artigos_solucoes.sql` (que adiciona `tipo`,
`codigo_erro`, `sintomas`, `passos`, `anexos`, `modulo`, `relacionadas`,
`autor` e a coluna gerada `busca`) nunca ter aplicado — erro `42P17:
generation expression is not immutable`. Isolei o motivo exato: não é
o `to_tsvector('portuguese', ...)` em si (isso funciona — é como a
coluna `busca_vetor`, com titulo+conteudo, tinha sido criada à mão
antes); o problema é **`array_to_string()` sobre uma coluna `text[]`
dentro de uma expressão `GENERATED ALWAYS AS ... STORED`** — nesse
banco isso não é aceito como immutable. Como a migration roda numa
transação só, o erro nessa coluna desfazia o `alter table` inteiro, e
nenhuma das colunas chegava a existir.

**Conserto**: migration `20260914150000_conserta_artigos_solucoes.sql`.

- Cria as 8 colunas que `nova-solucao.js` usa de fato: `tipo`,
  `codigo_erro`, `sintomas`, `passos`, `anexos`, `modulo`,
  `relacionadas`, `autor`. Ficaram de fora `tabelas_campos`,
  `criticidade` e `acessos` — previstas na migration antiga, sem uso no
  formulário atual.
- **Busca por trigger, não por coluna gerada.** `busca_vetor` deixou de
  ser `GENERATED` (`alter column ... drop expression`) e passou a ser
  preenchida por um trigger `BEFORE INSERT OR UPDATE`
  (`artigos_atualizar_busca()`) — roda em PL/pgSQL, fora da checagem de
  immutabilidade que travava a coluna gerada. Agora inclui
  `sintomas` e `codigo_erro` na busca, que a `busca_vetor` antiga (só
  titulo+conteudo) não cobria.
- **Policy de leitura duplicada, resolvida**: existia uma policy sem
  arquivo de migration correspondente (`artigos: leitura autenticada`,
  criada direto no dashboard em algum momento, `ativo OR
  is_equipe_ti()`) que, combinada por `OR` com a nova regra de setor,
  deixava qualquer autenticado ver qualquer artigo ativo — a
  segmentação por setor não tinha efeito. Essa policy foi derrubada; só
  `artigos_leitura` (por setor) continua valendo.
- **Quem escreve**: mantida a regra que já existia —
  `artigos: escrita equipe TI`, só quem é `is_equipe_ti()` cadastra,
  edita ou apaga solução, mesmo que qualquer usuário logado veja o
  formulário e a base.
- **Bucket `artigos`** criado (público, mesmo padrão do `avatares` —
  precisa ser público porque as imagens do passo a passo e os anexos
  aparecem numa `<img>`/link direto), com policies próprias: qualquer
  autenticado lê, só equipe de TI envia/troca/apaga.

**Testado de ponta a ponta no navegador** (2026-09-14): cadastrar com
todos os campos (tipo, título, descrição, sintoma, código de erro,
passo com imagem colada, anexo, setor, autor) → salva e aparece na
listagem com os filtros já refletindo o registro → abrir o painel
mostra tudo, imagem carregada do bucket → editar título → confirma e
`atualizado_em`/`busca_vetor` mudam → excluir (com a espera de 5s) →
volta a 0 registros. `busca_vetor` verificado direto no banco depois
de cada passo, contém as palavras certas.

`supabase migration list` mostra `20260914150000` como não-registrada
no remoto (apliquei via `db query --file`, mesma situação de
`20260914090000` e `20260914120000`, documentadas nas seções acima) —
efeito real no banco confirmado, só o bookkeeping do CLI está
desatualizado. Não rodar `supabase db push --include-all`: ele tentaria
reaplicar `20260911_artigos_solucoes.sql` do zero (a migration
original, ainda quebrada) e falharia de novo.

### Confirmado: leitura por setor, escrita só TI (2026-09-14)

A regra pedida ("quem não é admin só vê solução do próprio setor; TI vê
e edita tudo") **já estava no banco** desde o conserto acima — a policy
`artigos_leitura` (`is_equipe_ti() OR auth.uid() = autor_id OR
meu_setor_id() = any(setores)`) e `artigos: escrita equipe TI`
(`is_equipe_ti()` para tudo) já cobriam exatamente isso. Testei direto
no Postgres, simulando sessão de cada perfil com
`set_config('request.jwt.claims', ...)` (sem precisar da senha de
ninguém): um `solicitante` do setor Vendas só via o artigo marcado para
Vendas, nunca o de Logística; o `admin` via os dois; um `UPDATE` do
solicitante num artigo de Vendas (o próprio setor dele) não alterou
nada — RLS recusa silenciosamente, sem erro, é assim que Postgres
trata `USING` que não casa; o admin editou um artigo de Logística
mesmo não sendo desse setor.

**O que faltava era a tela**, não o banco: nada verificava perfil antes
de mostrar "Nova Solução" no menu ou os botões Editar/Excluir do
painel — um solicitante via os três, clicava, e a RLS barrava sem
avisar por quê ("Não foi possível salvar", sem contexto).

- **`main.js`** ganhou a mesma lógica que já existia para
  `[data-menu-portal]` (o atalho do Portal, também condicional):
  calcula `ehEquipeTi` com a *mesma regra do RLS*
  (`is_equipe_ti()` no banco — `admin`/`analista`/`parceiro`,
  `status_aprovacao = 'aprovado'`, `ativo`) e revela todo elemento
  `[data-equipe-ti] hidden` na página. Um atributo genérico, não
  específico da Base de Soluções — qualquer tela nova pode usá-lo.
- **`base.html`**: `data-equipe-ti hidden` no link "Nova Solução" do
  sidebar e nos botões Editar/Excluir do painel de detalhe.
- **`nova-solucao.js`** ganhou um guard próprio (`garantirEquipeTi()`,
  primeira coisa que roda no arquivo) que manda de volta para
  `base.html` quem não é equipe de TI — cobre quem digita a URL
  direto, já que esconder link no menu não impede isso (mesmo
  raciocínio já documentado para o Portal). O link "Nova Solução"
  *dentro* de `nova-solucao.html` (o item "ativo" do próprio sidebar)
  ficou sem `data-equipe-ti` de propósito — quem não pode estar ali já
  é redirecionado pelo guard antes de qualquer coisa renderizar.

**Testado no navegador**: com sessão de admin, os três elementos
aparecem. Simulando perfil `solicitante` (interceptando a resposta da
API na própria sessão de teste, sem precisar de uma segunda conta),
"Nova Solução" ficou escondido, e navegar direto para
`nova-solucao.html?...` redirecionou de volta para `base.html` antes
da tela montar.

Achado à parte, não um bug: durante o teste, o Chromium do Playwright
cacheou uma versão velha de `main.js` entre navegações
(`<script type="module">` sem `Cache-Control`, cache HTTP padrão do
navegador) e por um tempo pareceu que a lógica não rodava — só
reproduzia fora do cache (`fetch(..., { cache: 'no-store' })` ou
interceptando a rota para forçar `Cache-Control: no-cache`). Vale
lembrar disso se algo parecer não atualizar depois de editar JS: pode
ser cache do navegador, não o código.

### Baixar PDF (2026-09-14)

Portado do projeto GASO (`C:\Users\gasometro\Desktop\base-solucoes\GASO`
— a base de soluções antiga, mesma origem do resto do front desta
fase). Botão "Baixar PDF" no rodapé do painel de detalhe: monta um PDF
no navegador com [jsPDF](https://github.com/parallax/jsPDF) (CDN,
`2.5.1`), sem servidor nem função extra no banco — usa só o que já está
em memória no artigo aberto.

- **O que entra no PDF**: título, autor e data, código de erro (se
  houver) e o passo a passo completo, com as imagens de cada passo
  desenhadas ao lado do texto. Baixadas de novo do bucket (`fetch` +
  `FileReader` para base64) porque `jsPDF.addImage` não aceita URL
  direta.
- **Adaptação do original**: o GASO tinha um terceiro tipo de registro
  ("Script", com bloco de código e o campo `solucao.codigo`) que não
  existe neste projeto — a função usa direto `artigo.codigo_erro`
  (título da seção também fixo em "Código ou mensagem de erro"), sem a
  ramificação por tipo. `formatarData` já existia em `base.js`; não
  duplicado.
- **Nome do arquivo**: o título da solução, sem acento e em minúsculas
  (`ora-01722-...pdf`); cai para `solucao.pdf` se o título vier vazio.
- **Visível para todo mundo que vê a solução**, sem `data-equipe-ti` —
  é leitura, não edição; a RLS de `artigos_leitura` já decide quem
  enxerga o quê, o botão só monta o PDF do que a tela já mostra.

Testado no navegador: cadastrar solução com passo + imagem colada →
abrir o painel → Baixar PDF → arquivo baixa com o nome esperado,
conteúdo lido de volta (texto e imagem) bate com o que estava na tela.
Zero erro no console.

## Fase 3 — Triagem e abertura de chamado

**Status: em andamento** (começada em 2026-09-14). A abertura de
chamado em si ainda não foi feita; o que existe é a tela onde o
solicitante acompanha e responde o que já abriu.

### Tela "Solicitações" do solicitante (2026-09-14)

`public/solicitacoes.html` + `public/css/solicitacoes.css` +
`public/js/pages/solicitacoes.js`. O topo (barra, menu de perfil,
avatar, sair) vem de `index.css` + `main.js`, como no Portal — sem
duplicar.

É a contraparte do Portal: o Portal é a mesa do analista (filas,
arrastar e soltar, textos rápidos), esta é a caixa de entrada de quem
pediu. Mesma informação, vocabulário do solicitante.

**Layout.** A referência que o usuário mandou era tabela densa + filtros
numa coluna lateral. Não segui: o solicitante tem poucos chamados (não
dezenas), e o que ele quer saber ao abrir a tela é uma coisa só — *tem
algo esperando por mim?*. Então virou pilha de cartões com uma **barra
colorida de 5px** na borda esquerda como único elemento forte da tela;
todo o resto (tipografia, fundo, chips) fica quieto. Os filtros viraram
chips horizontais acima da lista, que ocupam menos espaço que uma
coluna lateral e cabem no mobile sem virar gaveta.

**Status.** Derivado, não tem coluna no banco — a mesma regra do Portal
e da home (`derivarStatus`): fechado se tem `fechamento_em`; senão olha
o último comentário **público e humano** (mensagem `tipo = 'sistema'`
de abertura não conta, senão todo chamado nasceria "em andamento"). Se
não tem nenhum, "Aberto"; se o último é do próprio usuário, "Em
andamento"; se é de outra pessoa, "Aguardando você".

| Status | Quando | Cor |
|---|---|---|
| Aberto | nenhuma resposta ainda | azul `#2c5c96` |
| Em andamento | o solicitante falou por último | amarelo `#a37a0a` |
| Aguardando você | a equipe falou por último | vermelho `#d64545` |
| Fechado | tem `fechamento_em` | cinza `#8a8a8a` |

Só "Aguardando você" ganha o selo **Responda** ao lado do status — é o
único estado que pede ação de quem está lendo.

**Título.** No banco o título nasce `"Categoria | Ticket-N"` (convenção
do Portal, onde o analista quer o número no título). Aqui o número já
aparece sozinho na linha de apoio, então o sufixo é cortado — repetido,
vira ruído. O corte é do `|` em diante (`/\s*\|\s*Ticket-\d+\b.*$/i`),
não só do fim: um título tinha sido editado para `"... | Ticket-103 d"`
e uma regex ancorada no fim deixava passar.

**Conversa.** O detalhe é um `<dialog>` nativo (backdrop, Esc e prisão
de foco de graça) com a conversa e a caixa de resposta. A resposta
entra em `comentarios` com `visibilidade: 'publico'`, `tipo: 'humano'`
— aproveitando a policy de INSERT que já existia, sem precisar de RLS
nova. Depois de gravar, o cartão se move de estado na hora (de
"Aguardando você" para "Em andamento") e o resumo do topo acompanha,
sem recarregar. Chamado fechado não mostra a caixa de resposta: mostra
uma linha explicando que para reabrir é pelo botão do ticket.

**Consulta.** Um `select` só, com os comentários aninhados
(PostgREST), filtrando `solicitante_id = auth.uid()` — a RLS já
limitaria, o filtro explícito só deixa a intenção visível na query. O
resumo do topo ("N em aberto · N esperando você") conta sobre todos os
chamados, não só os visíveis pelo filtro ativo.

**Estado vazio.** Mantém todo o cromo da página (cabeçalho, busca,
chips) e troca só as linhas por uma frase — decisão do usuário, para a
tela não parecer quebrada quando não há nada.

Testado no navegador: os 4 estados derivam certo; o selo "Responda" só
aparece em "Aguardando você"; a resposta passou pela RLS e o cartão
mudou de estado ao vivo com o resumo junto; chamado fechado esconde a
caixa e mostra a explicação; filtros, busca e o estado "nenhum
resultado" funcionam; no mobile (390px) não há rolagem horizontal.
Zero erro no console.

### Fotos na conversa (2026-09-14)

A conversa mostrava só o nome de quem falou. Agora mostra a **mesma
foto** do Portal e de "Dados pessoais" — a que a pessoa enviou para o
bucket `avatares`. `montarAvatar` é a mesma lógica do Portal: foto se
houver `foto_path`, iniciais se não houver, nome completo no `title`.

A consulta passou a trazer `usuarios(nome, sobrenome, foto_path)` no
lugar de só `nome` — nos dois lugares, na carga da página e no `select`
que volta depois de gravar a resposta (por isso a mensagem recém-enviada
já aparece com a foto, sem recarregar).

A mensagem automática **não** leva foto: não é de uma pessoa. Ela ganha
um recuo do tamanho do avatar, para alinhar com os balões da equipe.

**Bug corrigido de passagem** (existe igual no Portal, em
`portal.js:236`): no `load` da foto o código limpa o `textContent` para
a imagem não ficar por cima das letras. Se a imagem falhasse *depois*
disso — arquivo apagado do bucket, link expirado —, o `error` removia a
`img` e o círculo ficava **vazio**, sem iniciais. Aqui as iniciais ficam
guardadas numa variável e voltam no `error`. Confirmado no navegador
disparando o evento na mão: o círculo volta a mostrar "JA".

### Ainda não feito nesta fase

- Abertura de chamado pelo solicitante (formulário + categoria + anexo).
- Triagem: distribuir o chamado que chega para fila/responsável.
- Anexos na resposta do solicitante (hoje só texto).

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

### Menu do quadro: fechar chamado, tickets finalizados, fundo (2026-09-14)

Botão de 3 pontinhos ao lado da busca, como no Trello. Abre um dropdown
(`.quadro-menu__painel`) com três opções.

**Fechar / reabrir chamado.** Botão no topo do modal do card, ao lado do
X. Fechar grava `fechamento_em = now()`, some com o card do quadro na hora
e joga o chamado para "Tickets finalizados"; reabrir limpa a coluna e o
card volta para a mesma fila de onde saiu (`fila_id` nunca muda ao
fechar). A query do quadro passou a filtrar `fechamento_em is null` na
hora de montar as colunas — o array `chamados` em memória continua com
todos, é só o desenho do quadro que filtra, para não precisar de uma
segunda ida ao banco quando abre a lista de finalizados.
Nenhuma policy nova foi necessária: `chamados: equipe TI atualiza` já
cobria esse update.

Descobri, ao testar, que **já existe um trigger** (`chamados_notificar_
fechamento`, chamando `notificar_fechamento_chamado()`) que não é meu —
ele insere um comentário automático avisando o solicitante do
fechamento sempre que `fechamento_em` passa de nulo para preenchido.
Não mexi nele; ele já fazia o que faria sentido pedir a seguir.

**Tickets finalizados.** Lista (`<dialog data-finalizados>`) dos chamados
com `fechamento_em` preenchido: título, fila original, data de
fechamento, e os botões **Ver** (abre o modal normal do card) e
**Reabrir**.

**Plano de fundo.** Migration `20260914090000_fundo_portal.sql`:
`usuarios.fundo_path` + bucket **privado** `fundos-portal` — diferente do
`avatares`, aqui não faz sentido leitura pública, é fundo pessoal. Mesma
regra do avatar (arquivo nomeado pelo id do usuário), mas como o bucket é
privado a leitura usa `createSignedUrl` em vez de `getPublicUrl`. Sem
fundo salvo, o quadro mantém o degradê laranja padrão — a troca é opt-in,
por usuário, e o padrão nunca muda para quem não mexeu. O tamanho/
animação do degradê (`background-size: 250% 500%` + a respiração) são
para o gradiente, não para uma foto; uma classe `.portal--fundo-proprio`
desliga os dois quando há imagem, senão a foto do usuário ficaria
zunindo e distorcida.

**Exportar** só mostra "em breve" por decisão de escopo — formato
(JSON/CSV/Excel) fica para quando o menu em si estiver validado em uso.

**Descoberta à parte, não relacionada a este trabalho:** ao aplicar a
migration, `supabase db push` recusou por causa de uma migration antiga
alheia (`20260911_artigos_solucoes.sql`, da Base de Soluções) que nunca
aplicou de verdade no banco — o schema real de `artigos` já diverge do
que o arquivo descreve. Não mexi nela porque é a parte que o João
Gabriel está cuidando; apliquei só a minha migration direto, fora do
fluxo de `db push`.

### Correções do menu do quadro (2026-09-14)

- **Busca e menu de 3 pontinhos encostados, no canto direito.** O layout
  tinha 3 filhos com `justify-content: space-between`
  (identificação / busca / menu), o que empurrava o menu para a ponta e
  deixava a busca solta no meio. Busca e menu agora vivem dentro de um
  wrapper só (`.portal__ferramentas`, `display: flex; gap: 0.5rem`), e é
  esse par que fica encostado na borda direita do cabeçalho.
- **Respiração do fundo, de 7s para 20s** — `destaque-fundo-respira`,
  tanto em `portal.css` quanto em `index.css` (é a mesma animação,
  compartilhada com a faixa da home).
- **Busca acha chamado finalizado.** Já achava (a busca roda sobre o
  array `chamados` inteiro, sem filtrar fechado) — o que faltava era o
  clique funcionar: `irAteOCard` rola até um card no quadro, e um
  chamado fechado não tem card lá. Agora o resultado mostra "Finalizado"
  no lugar do nome da fila, e o clique abre o modal direto
  (`detalhe.abrir`) em vez de tentar rolar até um elemento que não
  existe.
- **Foto de perfil no avatar do membro do card** — o card usava um
  `<span>` com só as iniciais, nunca chamava `montarAvatar` (a função que
  já existia e busca a foto no bucket `avatares`). Editado nos 3 lugares
  que desenham membro: o card (`montarCard`), o card depois de editar
  (`atualizarCard`) e o chip "Membros" dentro do modal. `montarAvatar`
  ganhou um terceiro parâmetro (`classe`) para servir tanto o círculo do
  card quanto o balão do chat, que têm tamanhos diferentes. A query
  precisou trazer `foto_path` em três pontos: `chamado_membros(...
  usuarios(...))`, a lista de "quem pode ser adicionado" e o objeto que
  entra em `chamado_membros` na hora de adicionar (otimista, antes de
  recarregar).
- **Plano de fundo já carregava por conta, não por navegador** — o
  código sempre leu `usuarios.fundo_path` do banco (nunca gravou nada em
  `localStorage`), então a foto já deveria aparecer em qualquer login
  com a mesma conta, igual a foto de perfil. O texto do modal dizia
  "Vale só para você, neste navegador", o que sugeria o contrário do que
  o código fazia — trocado para "Fica salvo na sua conta e aparece em
  qualquer computador que você usar para entrar". Vale conferir: há dois
  logins de Enzo no banco (`enzo.xs@hotmail.com` e
  `enzo.xavier@madeirasgasometro.com.br`) — são duas contas diferentes,
  cada uma com seu próprio fundo.

### Cache do plano de fundo (2026-09-14)

O quadro ficava branco por um instante antes da foto aparecer. Medi
antes de mexer: a foto só começava a baixar **1,6s** depois da página
abrir, e ficava pronta aos **5,4s**. O gargalo não era o download — era
a fila de três idas ao servidor antes de existir uma URL para baixar:

```
getUser() -> select fundo_path -> createSignedUrl() -> aí sim baixa
  50ms          87ms                 162ms                 637ms
```

A URL assinada agora fica no **localStorage por 1 dia**
(`portal:fundo`). Com cache, a foto é pintada no primeiro quadro, sem
esperar rede; a conferência com o banco acontece depois, em segundo
plano, e só repinta se a foto mudou (repintar igual faria piscar).

**Resultado medido** (mesma máquina, mesma rede): fundo visível em
**484ms** com cache contra **5433ms** sem — 11x mais rápido.

A validade da URL assinada subiu de 1h para 7 dias. Ela precisa durar
mais que o cache: se expirasse antes, o cache devolveria um link morto
e o fundo sumiria até a revalidação.

**Invalidação** — o cache é limpo em três situações:

1. **Trocar a foto**: `limparCache()` explícito no upload. Necessário
   porque trocar mantendo a extensão devolve o mesmo caminho
   (`<id>.jpg`), então comparar caminho não veria a troca.
2. **Restaurar o fundo padrão**: limpa e despinta.
3. **Fundo removido em outro navegador**: a revalidação não acha
   `fundo_path`, então descarta o cache e despinta sozinha.

`localStorage` bloqueado (aba anônima), cota estourada ou JSON
corrompido caem em `try/catch` e seguem pelo caminho normal — o cache
é um atalho, não um requisito.

Testado no navegador: 1ª visita grava; 2ª visita pinta imediato; cache
de 25h é descartado e revalidado; cache corrompido não quebra a página;
fundo removido por fora limpa o cache e despinta.

**Não feito:** a imagem tem 1,2 MB e continua assim. Comprimir no
upload (~300 KB) ajudaria a 1ª visita e quem tem internet fraca — fica
para quando incomodar.

### Painel: configuração do Portal (2026-09-15)

Tela nova (`painel.html`), **só para admin**, inspirada no que o Hipporello
oferece hoje, adaptada ao padrão do projeto. Entra pelo menu de 3 pontinhos
do Portal.

Três abas numa página só (troca sem recarregar; o `?aba=` fica na URL):

- **Todos os tickets** — tabela de tudo que já entrou, inclusive fechado,
  com busca por número/solicitante/unidade/categoria/descrição e filtros
  (Todos, Abertos, Fechados, Urgentes, Prioridade). Clicar numa linha abre
  o chamado.
- **Contatos** — lista de `usuarios`; clicar abre o editor de nome,
  sobrenome, e-mail, setor, unidade, perfil, status do cadastro e ativo.
- **Configurações** — CRUD de filas, unidades, setores, categorias e textos
  rápidos, cada um num cartão.

**Formulários ficou de fora de propósito:** hoje não existe formulário
configurável no banco (o chamado nasce de um form fixo). Modelar isso é a
maior peça das quatro e vai ser desenhada em conversa separada.

**Prioridade não virou tela:** não é tabela, são dois booleanos no chamado
(`eh_prioridade`, `eh_urgente`). Entrou como filtro na aba de tickets — não
há o que cadastrar.

**O modal de detalhe não foi duplicado.** O `ligarDetalhe` do `portal.js`
(~1.650 linhas: conversa, anexos, membros, textos rápidos, aprovação de
acesso) passou a atender as duas telas:

- Ganhou um 5º parâmetro opcional, `quadroApi`, com o que fazer quando algo
  muda (`acharCard`, `aoMudarCard`, `aoMudarFechamento`, `aoContarChamados`).
  O Portal passa as funções do quadro; o Painel, o redesenho da tabela.
- O arranque do `portal.js` (tema, zoom, `montarQuadro`) foi para dentro de
  um `if (quadro)`, e o arquivo passou a exportar `ligarDetalhe`. Numa página
  sem `[data-quadro]` ele entra como biblioteca, sem levantar kanban.
- Os helpers que as duas telas usam (`derivarStatus`, `montarAvatar`,
  `tituloDoChamado`, `formatarData`, `CAMPOS_CHAMADO`…) saíram para
  `public/js/componentes/chamado-comum.js`. Uma fonte da verdade: corrigir
  o status numa tela corrige na outra.

**Nenhuma migração nova.** As policies de escrita de `filas`, `unidades`,
`setores`, `categorias` e `textos_rapidos` já eram `ALL` para equipe de TI,
e `usuarios` já tinha UPDATE para equipe de TI — o Painel é 100% frontend
sobre o que já existia.

**Remover é desativar (`ativo = false`), não apagar**: um chamado antigo
aponta para a categoria/unidade dele. O Portal já fazia assim com os textos
rápidos; o Painel seguiu a mesma regra, e todas as listas leem só `ativo`.

**Permissão em três camadas**, porque esconder link não é controle de acesso:
item do menu escondido (`data-menu-painel`, revelado pelo `main.js`),
`painel-guard.js` barrando na entrada, e a RLS no banco.

**Bug achado e corrigido no caminho:** faltava `[hidden] { display: none
!important; }` no `portal.css`. Sem ela, `.quadro-menu__item { display:
flex }` vencia o atributo nativo na mesma especificidade e o item "Painel"
apareceria para **todo mundo**, não só admin. É exatamente a armadilha já
anotada em `docs/preferencias.md` — dessa vez com consequência de permissão.

Testado no navegador (Playwright, dados de mentira — nada gravado no banco):
as três abas desenham; o modal abre pela linha da tabela com título, fila e
campos certos; o Portal continua montando quadro, cards e modal sem erro no
console (sem regressão); tema escuro acompanha; a 390px o menu vira faixa de
abas e não há rolagem horizontal; e o item do menu aparece para `admin` e
fica escondido para `analista`/`solicitante`.

**Ainda não feito:** a aba de tickets não tem tempo real (recarregar para ver
o que mudou) nem paginação — com milhares de chamados a tabela vai pesar.

### Painel: filtros e exportar em "Todos os tickets" (2026-09-15)

Inspirado no Hipporello (print enviado pelo usuário): barra reorganizada como
**busca -------- exportar -------- filtrar**, os dois últimos como botão de
ícone que abre um painel — mesmo padrão do "Filtrar" do quadro no Portal,
mas em classes próprias do Painel (`.painel-icone-botao`,
`.painel-dropdown__painel`), porque o botão do Portal é estilizado para o
degrade laranja do topo e aqui a barra está sobre uma superfície normal.

**Filtrar** — seis grupos, todos combináveis (E entre grupos, OU dentro do
grupo), nada disso reescreve a consulta ao banco: filtra em memória sobre os
chamados já carregados, igual à busca:

- **Status** — chip, mesmo `derivarStatus` do Portal (Aberto, Aguardando
  retorno, Usuário respondeu, Fechado).
- **Lista** — chip, uma por fila do quadro.
- **Prioridade** — chip (Urgente, Prioridade, Normal); um chamado urgente E
  prioridade entra nas duas.
- **Solicitante** — checkbox com busca, todo mundo que já abriu chamado (não
  só quem tem perfil "solicitante" — um admin também abre).
- **Atendente** — checkbox com busca, a equipe de TI mais a opção "Sem
  atendente" (chamado sem ninguém no `chamado_membros`).
- **Data de abertura** — dois campos de data (De/Até), intervalo fechado.

O botão de ícone fica laranja cheio com um contador quando algum filtro
está ligado — mesmo comportamento do filtro do quadro no Portal.

**Exportar** — três formatos, todos client-side (sem chamada ao banco além
da que já carregou a tabela), do que está **filtrado na hora**, não de todo
o banco:

- **CSV** — mesmas colunas e regras de escape do exportador do Portal
  (`;` como separador, BOM UTF-8, apóstrofo na frente de célula começando
  com `=+-@` para não virar fórmula no Excel).
- **Excel** — tabela HTML salva com extensão `.xls`; o Excel abre formatado
  como planilha sem precisar de biblioteca.
- **JSON** — um array de objetos, mesmas colunas como chaves.

**Um cuidado que apareceu no caminho:** `atualizarLinha` (chamada quando o
modal de detalhe edita um chamado aberto) trocava só a linha da tabela — com
filtro ativo, isso podia deixar visível um chamado que acabou de sair do
filtro (ex.: mudou de fila) ou esconder um que acabou de entrar. Com algum
filtro ou busca ligados, a atualização agora refaz a tabela inteira em vez
de trocar uma linha; sem filtro, continua trocando só a linha (mais rápido,
e sem esse risco).

Testado no navegador (Playwright, dados de mentira): os 6 grupos desenham;
marcar "Aberto" filtra de 4 para 2 linhas e o contador mostra 1; limpar volta
para 4; o intervalo de data filtra corretamente; abrir Exportar mostra os
3 formatos; baixar CSV, Excel e JSON funciona (Playwright captura o
download) — o CSV testado com descrição contendo `;` e aspas escapou certo
(`"Fica ""travada""; direto"`); tema escuro acompanha; sem erro no console;
sem regressão no Portal (que tem seu próprio exportar/filtrar, em
`data-*` diferentes, sem colisão).

### Painel: criar conta e gerenciar foto em Contatos (2026-09-15)

Botão **Novo** no canto superior direito da aba Contatos (mesmo lugar do
print de referência do Hipporello enviado pelo usuário), e no editor de
pessoa, dois botões novos ao lado do avatar (**Trocar foto** / **Remover**).

**Criar conta com senha esbarrou num limite real do Supabase**, discutido
com o usuário antes de implementar: só a `service_role` key cria um usuário
de login (`auth.users`) com senha definida na hora, e essa chave nunca pode
chegar ao navegador — ela ignora toda RLS, então quem a tiver lê/edita
qualquer dado de qualquer pessoa. Chamar `auth.signUp()` no mesmo client que
o admin usa para estar logado também trocaria a sessão dele pela da conta
nova. A solução, escolhida entre três opções apresentadas: **Edge Function**
— primeira peça de infraestrutura server-side do projeto.

`supabase/functions/criar-usuario/index.ts`:

1. Recebe o token do admin (`Authorization`), confere com um client comum
   (chave anon) que é uma sessão válida e que `perfil = 'admin'` — essa é a
   ÚNICA linha de defesa aqui dentro, porque o resto do código roda com
   `service_role` e não passa por RLS nenhuma.
2. Cria o usuário via `auth.admin.createUser()` (client `service_role`),
   o que dispara `handle_new_user()` — o mesmo trigger do autocadastro por
   `cadastro.html`: insere a linha em `usuarios` e abre um chamado de
   "Aprovação de Acesso".
3. Atualiza `usuarios` com os campos que o admin escolheu no formulário
   (setor, unidade, perfil, `status_aprovacao`).

**O que fazer com o chamado de aprovação automático** também foi perguntado
antes: como o admin já está decidindo perfil/status na hora de criar, não
há nada para aprovar depois. Resolvido **sem código novo**: quando o passo 3
grava `status_aprovacao = 'aprovado'`, o trigger `notificar_aprovacao_cadastro`
que já existe (reage a UPDATE em `usuarios`) posta a nota de aprovação e
fecha o chamado sozinho — mesmo caminho que qualquer aprovação manual pelo
card usa. Confirmado numa transação com rollback: o chamado nasce, ganha 3
mensagens de sistema (abertura, aprovação com o nome de quem criou, e
fechamento) e termina fechado, com o admin como membro.

**Troca/remoção de foto esbarrou noutro limite**: o bucket `avatares` só
deixava cada pessoa mexer na própria foto (`split_part(name, '.', 1) =
auth.uid()`), então o admin editando a foto de outra pessoa pelo Painel
seria barrado pela RLS do Storage. Migração
`20260915100000_avatares_admin_gerencia.sql` soma 3 policies (INSERT/UPDATE/
DELETE) que liberam para quem é admin, aprovado e ativo — **somam**, não
substituem: o dono continua podendo mexer na própria foto por "Dados
pessoais" como sempre. Escopo deliberadamente estreito (só `admin`, não
"equipe de TI" inteira) e checagem inline em vez de uma function
`is_admin()` nova, por ser regra específica demais para virar peça reutilizável.
Testado com `set_config`/rollback: admin passa no `with check`, solicitante
não passa.

Upload/remoção no Painel seguem o mesmo padrão de `perfil.js` (nome do
arquivo = id da pessoa, limite de 2 MB) — só que operando sobre a pessoa que
está sendo editada, não sobre "quem está logado".

**Modo único do dialog:** o mesmo `<dialog data-pessoa>` atende os dois
casos (criar/editar) — `editando` é `null` na criação. `aplicarModo()`
decide o que aparece: campo de senha só na criação, botões de foto só na
edição (sem id ainda não há onde subir o arquivo), texto do botão principal
("Criar conta" / "Salvar"), e a dica do campo e-mail muda de tom.

Testado no navegador (Playwright, dados de mentira, `supabase.functions.invoke`
também mockado só para o teste de UI — a lógica real da function foi
validada à parte, direto no banco, como descrito acima): botão Novo abre o
dialog vazio com senha visível e foto escondida; criar fecha o dialog e
soma uma linha na tabela; abrir para editar depois mostra o oposto (foto
visível, sem campo de senha); zero erro no console.

### Painel: paginação em "Todos os tickets" (2026-09-15)

15 por página, igual ao print do Hipporello enviado pelo usuário —
`‹ 1 2 … 16 ›`, sempre primeira, última, atual e uma vizinha de cada lado;
o resto vira reticências (senão 227 chamados virariam 16 botões na tela).
Paginação client-side: fatia (`slice`) a lista já filtrada/buscada em
memória, não pagina a consulta ao banco — os chamados já vêm todos de uma
vez no carregamento do Painel.

Volta para a página 1 sempre que busca, filtro ou "Limpar filtros" mudam o
resultado (senão a pessoa pode ficar numa página 4 que só tem 2 chamados
depois de filtrar). **Não** volta quando o modal de detalhe atualiza um
chamado em segundo plano (`atualizarLinha`) — ali a pessoa está olhando uma
página específica e não deve ser puxada de volta.

Some da tela sozinha quando cabe tudo numa página só (`totalPaginas <= 1`).

Testado no navegador (Playwright, 37 e 227 chamados de mentira): página 1
mostra os primeiros 15 com a seta "anterior" desabilitada; página 2 mostra
os 15 seguintes; a última página (37 chamados = 3 páginas) mostra os 7
restantes com "próxima" desabilitada; filtrar por Urgente reduz para 8
resultados e a paginação some; com 227 chamados (16 páginas) as reticências
aparecem corretas (`1 2 … 16`); tema escuro acompanha; sem rolagem
horizontal a 390px; zero erro no console.

### Painel: raiz do bug visual no dialog "Nova pessoa" + auditoria (2026-09-15)

Usuário reportou com print: o dialog de criar/editar pessoa em Contatos
tinha uma barra de rolagem horizontal cortando o formulário ao meio.
Investigado com `superpowers:systematic-debugging` (medir antes de
mexer, não chutar): script Playwright comparou `scrollWidth` vs
`clientWidth` de cada elemento dentro do dialog até achar exatamente qual
transbordava.

**Causa raiz:** `.pessoa__entrada { width: 100%; padding: 0.55rem 0.7rem; }`
sem `box-sizing: border-box`. No `content-box` padrão do navegador,
`width: 100%` define a largura do *conteúdo*, e o padding some por cima —
cada campo ficava ~24px mais largo que o container. **Não era um caso
isolado**: o mesmo padrão (`width: 100%` + `padding`, sem `box-sizing`)
também vazava em `.painel-busca__campo` (busca das 3 abas) e
`.painel-item__corpo` (textarea de texto rápido) — achados pelo mesmo
script rodado em cada seletor do arquivo.

**Por que aconteceu:** nenhum arquivo CSS deste projeto tem um reset
global — `portal.css`/`index.css` declaram `box-sizing: border-box` seletor
por seletor (confirmado por busca: só ocorrências manuais, nenhuma regra
`*`). Fácil de esquecer numa tela nova. Corrigido na raiz, só em
`painel.css` (`* { box-sizing: border-box; }`, logo depois da regra de
`[hidden]`) — como só `painel.html` carrega este arquivo, o Portal e as
outras telas continuam exatamente como estavam, sem risco de regressão
fora do Painel. Confirmado com o mesmo script: zero elementos
transbordando em nenhuma das 3 abas, em 1400px e 390px.

**Skills nomeadas pelo usuário:** `/frontend-design:frontend-design` foi
invocada, mas é voltada para desenho visual do zero (paleta/tipografia/
layout partindo de um brief) — não para auditar uma tela shadcn já
construída. `/ui-ux-pro-max:ui-ux-pro-max` foi invocada e trouxe uma
checklist realmente útil, mas o skill é para app nativo (iOS HIG, React
Native, pt/dp) — algumas regras não se aplicam a um site vanilla-JS. Uma
skill "apple design" pedida pelo usuário **não existe** em
`~/.claude/skills` nem em nenhum plugin instalado — avisado direto em vez
de inventar substituto. O que rendeu resultado de verdade foi medir no
navegador de verdade (Playwright), não os textos das skills.

**Duas melhorias a mais, achadas na mesma varredura:**

- Remover item de lista (Configurações) e remover texto rápido usavam
  `window.confirm()` — o alerta feio e nativo do navegador, quebrando o
  visual shadcn do resto da tela. Trocado por `confirmarNoSite()`, que **já
  existe** em `portal.js` (construída lá exatamente para isso) e já estava
  exportada — só precisou importar em `painel.js`. Zero HTML novo: o
  dialog `[data-confirmacao]` já tinha sido copiado para `painel.html` na
  primeira leva.
- Botões de ícone (Exportar, Filtrar) mediam 42×43px — 1-2px abaixo do
  alvo de toque mínimo de 44×44 que a checklist do ui-ux-pro-max e o WCAG
  recomendam. Ajustado para 44×44 exatas (`min-width`/`height: 2.75rem`).

Testado no navegador (Playwright): as 3 abas sem vazamento horizontal em
1400px e 390px; clicar em remover (lista de configuração e texto rápido)
abre o dialog estilizado, não o `confirm()` nativo (confirmado escutando o
evento `dialog` do Chromium — nunca disparou); botão com classe de perigo
(vermelho) e texto "Remover"; cancelar fecha sem apagar; botões de ícone
medindo 44×44 depois do ajuste; zero erro no console.

### Painel: reestruturação do menu e das listas de configuração (2026-09-15)

Usuário não gostou do layout anterior (5 cartões espremidos numa aba só
"Configurações", print de referência do Hipporello anexado). Pedido:
desmembrar cada lista numa aba própria, copiando a estrutura de Contatos
(busca, botão "Novo", tabela, clique edita, lixeira remove), e reorganizar
o menu lateral em dois grupos com uma linha separando — "Portal" e
"Configurações".

**Menu lateral**, agora com dois grupos:

```
---- PORTAL ----
Todos os tickets · Contatos · Administradores

---- CONFIGURAÇÕES ----
Unidades · Setores · Categorias · Textos rápidos
```

Decisões tomadas com o usuário antes de mexer (perguntadas porque mudavam
a arquitetura, não só o visual): **Filas saiu do Painel** — não estava na
lista pedida, volta a ser só do Portal, como antes do Painel existir (a
tabela de tickets continua buscando/filtrando por fila, só não virou aba).
**Administradores é Contatos pré-filtrado** — mesma tabela `usuarios`,
mesmo editor, só que a lista já chega só com quem atende chamado
(`perfil != 'solicitante'`).

**Cada lista de configuração virou uma aba própria** (Unidades, Setores,
Categorias, Textos rápidos), na mesma estrutura de Contatos: título +
contagem, botão "Novo" no canto superior direito, busca, tabela, clicar na
linha abre o editor, ícone de lixeira remove (com a mesma regra de sempre:
desativa — `ativo = false` — nunca apaga de verdade, por causa da chave
estrangeira com chamados antigos).

**Um bug de arquitetura achado e corrigido no meio do caminho:** o dialog
de editar pessoa (`data-pessoa`) e o de editar item simples
(`data-item-simples`) são únicos na página — só existe um de cada no HTML.
A primeira versão do código ligava os listeners de cada aba (Contatos E
Administradores; Unidades E Setores E Categorias) direto no dialog
compartilhado, o que significava que salvar um formulário disparava o
`submit` de **todas** as abas que já tinham passado por ali — cada uma
tentando gravar na sua própria tabela com o `editando` de quem chamou por
último. Corrigido reestruturando em "dialog compartilhado, ligado uma vez"
+ "lista, ligada por aba, que registra uma função de callback no dialog"
(`ligarPessoaDialog`/`ligarListaDePessoas` e
`ligarItemSimplesDialog`/`ligarListaSimples`) — o dialog nunca sabe qual
aba o chamou, só devolve o resultado pra quem pediu.

**Achado só depois de testar de verdade, não só de ler o código:** o teste
inicial reportou "Rio das Pedras" aparecendo duas vezes na tabela após
criar uma unidade — parecia confirmar o bug acima. Investigação mais funda
(contagem de `.insert()` disparado, rastreamento de `appendChild`) mostrou
que só **um** insert e **um** submit aconteciam; o duplicado vinha do mock
de teste, cujo `.then()` não seguia o contrato de uma Promise real (era
chamado várias vezes pelo mecanismo de `await`, e cada chamada relia a
mesma referência de array já mutada por `push`). Corrigido o mock (devolver
uma cópia do array a cada leitura), reconfirmado que a app estava correta
o tempo todo — registrado aqui porque é exatamente o tipo de "parecia
certo, não estava" (ou, neste caso, "parecia errado, não estava") que vale
a pena não esquecer.

**Dois bugs de CSS achados testando a 390px, sem relação com o pedido
original mas que apareceriam na hora H:**

- O item do menu ativo ("Todos os tickets") virava um retângulo alto e
  torto na faixa de abas mobile. Causa: `.painel` é um CSS Grid de uma
  coluna só nessa largura, e sem `grid-template-rows` explícito os dois
  filhos (nav e conteúdo) disputavam a mesma linha implícita — o Grid
  esticava os dois até a altura do mais alto. Corrigido com
  `grid-template-rows: auto 1fr` (a faixa de abas do tamanho do próprio
  conteúdo, o resto pro conteúdo).
- O mesmo problema, ao ser corrigido da forma errada na primeira tentativa
  (`align-items: start` no lugar do fix acima), quebrou a rolagem: o
  `.painel__conteudo` parou de ficar preso à altura da viewport e a
  **página inteira** passou a rolar em vez de só a área de conteúdo — 40
  linhas de teste bastaram para expor isso. A correção certa
  (`grid-template-rows`) resolve os dois ao mesmo tempo sem esse efeito
  colateral.

Testado no navegador (Playwright): menu com os dois grupos e a linha
divisória; Administradores mostra só quem não é solicitante; criar/editar/
excluir funciona em Unidades, Setores, Categorias e Textos rápidos; **o
dialog compartilhado não vaza entre abas** (criar "Financeiro" em
Categorias não aparece em Unidades); confirmação de remoção usa
`confirmarNoSite`, não `confirm()` nativo; tema escuro acompanha; 390px sem
rolagem horizontal nem vertical indevida, mesmo com 40 linhas na tabela;
zero erro no console.

### Painel: exportar e filtrar em Contatos e Administradores (2026-09-15)

Mesmos dois botões de ícone da aba "Todos os tickets" (Exportar, Filtrar),
agora também em Contatos e Administradores — pedido para poder filtrar por
unidade, setor, perfil e situação, e exportar a lista.

Como as duas abas já eram desenhadas pela mesma função genérica
(`ligarListaDePessoas`, criada na reestruturação anterior para servir
Contatos e Administradores ao mesmo tempo), o filtro e o exportar entraram
ali dentro — as duas abas ganharam os dois recursos de uma vez, com o mesmo
tanto de código que levaria fazer só uma.

**Filtrar** — quatro grupos, todos chip (poucas opções cada, cabem como
botãozinho, diferente do "Solicitante"/"Atendente" de tickets que têm busca
por serem listas longas):

- **Unidade** e **Setor** — toda unidade/setor cadastrado, não só os em uso
  agora (mesma régua do filtro de tickets).
- **Perfil** — Solicitante, Parceiro, Analista, Admin.
- **Situação** — Inativo, Aprovado, Rejeitado, Pendente — deriva da mesma
  regra que já decide o selo colorido da tabela (`ativo` vence
  `status_aprovacao`: uma conta desativada aparece como "Inativo" mesmo que
  o cadastro tivesse sido aprovado), repetida de propósito para o filtro
  bater exatamente com o que a coluna Situação mostra.

**Exportar** — CSV, Excel (.xls) e JSON, mesmas regras de escape do export
de tickets (apóstrofo contra fórmula, aspas dobradas, BOM UTF-8). Colunas:
Nome, E-mail, Setor, Unidade, Perfil, Situação, Cadastro em — a última
exigiu buscar `created_at` de `usuarios`, que a consulta do Painel ainda
não pedia (confirmado que a coluna existe antes de somar ao `select`).

Testado no navegador (Playwright): os 4 grupos de filtro aparecem nas duas
abas; filtro combinado (Unidade + Situação) restringe a interseção certa;
"Limpar filtros" volta ao total; exportar CSV baixa com as colunas e dados
certos; **filtro de uma aba não vaza para a outra** (filtrar Setor em
Administradores não muda o que Contatos mostra sem filtro — mesmo teste de
isolamento já feito para os dialogs compartilhados); tema escuro acompanha;
sem rolagem horizontal a 390px; zero erro no console.

### Portal: gerenciar listas do quadro — arrastar, criar, ordenar, arquivar (2026-09-15)

Pedido com referência visual do Trello: arrastar lista pra trocar de posição,
botão "+ Adicionar outra lista" no fim do quadro, menu de 3 pontinhos em
cada lista com ordenação de cartões (inclusão/prioridade/número) e
"Arquivar esta lista". **Sem migração nova**: `filas.ativo` já existia desde
antes do Painel — a única coisa que faltava era o Portal e o Painel usarem
esse campo pra isso.

**Arrastar lista** (`ligarArrastarLista`) — HTML5 drag nativo no `<header
class="fila__topo">` de cada coluna (não a coluna inteira, pra não competir
com o arrastar-o-fundo-pra-rolar que já existia). Mesmo desenho do arrastar
de card já em produção: move na tela a cada passagem por cima de outra
coluna (não só ao soltar — o Trello também faz assim), grava `ordem` de
todas as colunas no soltar (de 10 em 10, deixando folga pra inserir entre
duas sem renumerar tudo depois).

**"+ Adicionar outra lista"** — vira formulário inline ao clicar, cria em
`filas` com `ordem` = maior atual + 10, monta a coluna na tela sempre antes
do próprio botão (que é fixo no HTML, nunca se move).

**Menu de 3 pontinhos por lista** — mesmo vocabulário visual do menu de 3
pontinhos do quadro (`quadro-menu__*`), em classes próprias (`fila__menu__*`)
por ficar em contexto menor. Um único listener delegado no `quadro` cobre
todas as listas (nascem e somem — um por coluna teria que ser desligado e
religado toda hora):

- **Ordenar cartões por** — Data de inclusão (o padrão, ordem que já vem do
  banco), Prioridade (urgente > urgente+prioridade > prioridade > normal),
  Número do ticket. **Salvo por lista, só neste navegador**
  (`localStorage`, chave `ordem-listas-portal`) — pedido explícito do
  usuário, não mexe no banco. Trocar o critério redesenha só aquela coluna
  na hora, sem recarregar.
- **Arquivar esta lista** — `ativo = false`. **Bloqueia se tiver chamado
  dentro** (decisão tomada com o usuário antes de implementar): mostra aviso
  "mova os chamados antes de arquivar" em vez de arquivar com chamado preso
  lá dentro. Lista vazia pede confirmação (`confirmarNoSite`) e some do
  quadro na hora.

**Um bug achado testando de verdade, não por leitura de código:** o clique
no botão "+ Adicionar outra lista" não abria o formulário — o clique real
do Playwright falhava, mas `elemento.click()` via JavaScript funcionava,
o que apontava pra alguma coisa acontecendo no `pointerdown` antes do
`click` completar. Causa: `ligarArrastoDoFundo` (o "segurar o fundo vazio e
arrastar rola o quadro", já existente) tinha uma lista de exclusões
(`.card`, depois `.fila__topo` — essa adicionada nesta sessão) mas não
incluía `.fila-nova` — o pointerdown no botão chamava `setPointerCapture`
no quadro inteiro antes do clique terminar, e o evento de clique nunca
chegava no listener do botão. Corrigido somando `.fila-nova` à lista de
exclusões.

**Painel: aba "Listas" em Configurações** — leitura + reativar, nada de
criar ou excluir por lá (criar é pelo quadro; "excluir" uma lista sempre
foi arquivar, e isso já é o menu de 3 pontinhos). Mostra **ativas E
arquivadas** — é o único lugar de onde uma lista arquivada volta a existir.
Busca uma segunda vez de `filas` sem o filtro `.eq("ativo", true)` que as
outras abas usam (a aba de tickets continua só com as ativas, pra fila do
chamado e o filtro baterem com o que existe no quadro agora).

Testado no navegador com `DragEvent` disparado via `dispatchEvent`: drag de
lista reordena e persiste; ordenar por prioridade bate a hierarquia certa e
**persiste depois de recarregar a página** (localStorage); adicionar lista
aparece sempre antes do botão; arquivar bloqueia com chamado dentro e
mostra o aviso; arquivar lista vazia pede confirmação e remove a coluna;
aba Listas do Painel mostra ativa/inativa corretas e reativar funciona;
regressão completa do Portal sem quebra.

**Esse teste deu falso positivo no arrastar de lista — corrigido na sessão
seguinte, quando o usuário reportou que não conseguia arrastar de verdade.**
O `dispatchEvent(new DragEvent(...))` deixa escolher o `target` do evento à
mão; um arrasto real do navegador não preserva esse nível de detalhe — veja
a seção seguinte.

### Portal: correção — arrastar lista não funcionava de verdade (2026-09-15)

Usuário reportou: não conseguia arrastar "Em atendimento" pra antes de
"Inbox". O teste da sessão anterior (`DragEvent` sintético) tinha validado
a feature, mas escondia o bug de verdade — retestado com
`locator.dragTo()` do Playwright (que simula o gesto de arrastar de
verdade: mousedown, sequência de mousemove, mouseup, deixando o próprio
Chromium decidir quando é um "drag" HTML5), e o arrasto não movia nada,
zero grav ação no banco.

**Root cause** (isolado por instrumentação: contando quais eventos
disparavam, depois logando o `event.target` de cada um): o `dragstart` de
um arrasto real do navegador **sempre reporta `event.target` como o
elemento que tem `draggable="true"`** — no caso, a `<section class="fila">`
inteira — **nunca um descendente**, não importa em qual pixel dentro dela o
usuário pressionou o mouse. O código verificava
`evento.target.closest(".fila__topo")` dentro do `dragstart` pra confirmar
que o arrasto começou pelo cabeçalho (não por um card dentro da lista) —
essa checagem sempre falhava, porque `target` nunca era um `.fila__topo`,
sempre a `.fila` toda. `colunaArrastada` nunca era definida, e o resto do
fluxo (`dragover`, `drop`) ficava sem efeito silenciosamente.

O teste anterior não pegou isso porque despachava o `DragEvent` manualmente
com `.fila__topo` como alvo explícito — um artefato do teste, não do
comportamento real do navegador.

**Correção:** não depender de `evento.target` no `dragstart`. Um listener
de `mousedown` (que reporta o elemento exato pressionado, sem essa
limitação) guarda se o clique começou dentro de `.fila__topo`; o
`dragstart` só consulta essa flag.

Testado com `locator.dragTo()` de verdade (não `DragEvent` sintético desta
vez): os 4 eventos disparam em sequência completa
(`dragstart → dragover → drop → dragend`); arrastar "Em atendimento" para
antes de "Inbox" move de verdade (`['Em atendimento', 'Inbox',
'Finalizado']`) e grava a `ordem` das 3 colunas no banco; testado duas
vezes em sequência (arrastar a última lista pro início, depois arrastar a
mesma pro meio) sem quebrar; **regressão do arrastar de card** (também
retestado com `dragTo()` de verdade, não só o `DragEvent` sintético de
antes) continua funcionando — os quatro eventos disparam, o card muda de
fila; zero erro no console.

**Lição levada para `docs/preferencias.md`:** testar arrastar-e-soltar
HTML5 com `DragEvent` sintético via `dispatchEvent` pode mascarar bugs reais
de detecção de alvo — o `target` de um evento disparado à mão é escolhido
por quem escreve o teste, não pelo navegador. `locator.dragTo()` do
Playwright (mousedown → mousemove → mouseup, deixando o Chromium decidir)
é o que de fato exercita o mesmo caminho que um usuário real percorre.

### Portal: setor na ficha do chamado + link "Painel" com underline (2026-09-15)

Duas correções pontuais pedidas com print:

**Grade de dados do chamado** — ganhou o campo Setor, pareado com E-mail
(antes ele era o único campo "largo" da grade, ocupando a linha inteira
sozinho). Nova ordem: Solicitante/Aberto em, E-mail/Setor, Unidade/
Categoria, Cliente na loja/Sistema lento ou fora, Acesso remoto. Sem
consulta nova ao banco — `usuarios.setores(nome)` já vinha em
`CAMPOS_CHAMADO` desde o card de Aprovação de Acesso.

**Item "Painel" "vazando" no menu de 3 pontinhos** — o item é um `<a>`
(os outros cinco do menu são `<button>`), e `.quadro-menu__item` nunca
tinha `text-decoration: none` declarado — nenhum dos outros itens
precisava, só botão não sublinha por padrão. O resultado: só o "Painel"
aparecia sublinhado (e sujeito à cor azul/roxa de link visitado do
navegador em vez de `var(--texto)`), destoando visualmente do resto do
menu. Corrigido com `text-decoration: none` e `:visited { color:
var(--texto); }` em `.quadro-menu__item`.

Testado no navegador: grade mostra os 9 campos na ordem pedida; item
Painel sem sublinhado, cor igual aos outros itens do menu; zero erro no
console.

**O sublinhado não era o vazamento inteiro — usuário reportou "ainda
está".** Print de volta mostrava uma caixa escura vazando pela borda
direita, arredondada do menu. Medido com o navegador de verdade
(`getBoundingClientRect`): o link "Painel" tinha 282px de largura contra
276px do painel que o contém — 6px de vazamento, exatamente o padding
horizontal do item (`0.5625rem` de cada lado). **Mesma causa raiz já
corrigida em `painel.css` na sessão de "Nova pessoa" quebrando com barra de
rolagem**: `.quadro-menu__item` tem `width: 100%` + `padding`, sem
`box-sizing: border-box`. Um `<button>` já nasce `border-box` por padrão do
navegador — por isso os outros cinco itens do menu (todos `<button>`)
nunca vazaram; só o "Painel" (o único `<a>`) sofria, porque um link usa
`content-box` como qualquer elemento genérico. Corrigido com
`box-sizing: border-box` explícito em `.quadro-menu__item`.

Auditado `portal.css` inteiro atrás do mesmo padrão (`width: 100%` +
`padding` sem `box-sizing`) — achou mais 5 candidatos; checado o HTML/JS de
cada um pra ver se é `<button>` (seguro, já nasce border-box) ou outro tipo
de elemento (arriscado). Quatro eram `<button>`; `.detalhe__escolher` é uma
`<div>` (o painel de cor de destaque, dentro do detalhe do chamado) —
corrigido preventivamente antes de virar o próximo relato de "vazamento".

Testado de novo: largura do link caiu de 282px pra 264px, dentro dos 276px
do painel; visualmente encostado na borda arredondada, igual aos outros
itens.

### Painel: barra lateral laranja, cabeçalho branco e recolher menu (2026-09-15)

Pedido: só trocar cores do Painel (barra lateral no laranja da Base de
Soluções, cabeçalho branco no mesmo padrão visual do resto do site — sem
alterar nenhum elemento do cabeçalho), e acrescentar um botão no fim da
navegação lateral pra recolher/esconder a barra.

**Barra lateral**: `.painel-nav` ganhou o mesmo degrade radial laranja e a
animação de respiração da Base (`painel-sidebar-respira`), itens em branco
translúcido com destaque sólido no item ativo.

**Cabeçalho**: `.barra-portal` em `painel.css` sobrescreve só cor/sombra —
fundo branco, texto escuro, sem o vidro translúcido nem o blur que fazem
sentido no Portal (ali a barra fica sobre o degrade do quadro; aqui só a
barra lateral ficou laranja, o resto do fundo é cinza claro). Nenhum
elemento foi movido, criado ou removido do cabeçalho.

**Bug pego antes de reportar como pronto**: o primeiro teste automatizado
media a largura do texto do menu recolhido errado e passou "verde" com o
bug ainda presente. Dois problemas reais, achados ao checar o DOM de
verdade em vez de confiar no primeiro teste:

1. O texto de cada item do menu (`Todos os tickets`, `Contatos`, etc.) era
   texto solto dentro do `<button>`, não um `<span>` — a regra CSS que
   esconde o texto ao recolher (`.painel-nav__item span { display: none }`)
   nunca tinha o que esconder. Corrigido envolvendo o texto de cada item em
   `<span>` no HTML.
2. No tema escuro, `portal.css` tem `[data-tema="escuro"] .portal-pagina
   .topo { background-color: ... }`, mais específica (3 classes/atributos)
   que a regra nova `body.painel-pagina .barra-portal` (2) — o cabeçalho
   voltava a ficar escuro mesmo com a cor branca escrita depois no arquivo.
   Corrigido igualando a especificidade (seletor duplicado com
   `[data-tema="escuro"]` na frente). Um segundo problema junto: o texto do
   cabeçalho usava `var(--texto)`, que no tema escuro vira quase-branco
   (pensado pra fundo escuro) — ilegível sobre o branco fixo do cabeçalho.
   Trocado por cores literais (`#1a1a1a`, `#555`, `#e3e3e3`), já que este
   cabeçalho é sempre branco, claro ou escuro.

**Recolher menu**: botão novo no fim de `.painel-nav`, estado em
`html[data-painel-sidebar]` (`expandida`/`colapsada`) espelhado em
`localStorage["painelSidebarColapsada"]` — chave própria do Painel, não a
mesma `sidebarColapsada` da Base de Soluções, por decisão explícita (são
duas telas com colapso independente). Script no `<head>` aplica o estado
antes da primeira pintura, mesmo padrão já usado pra tema e zoom. Recolhido:
sidebar cai pra 72px, ícones centralizados, texto/títulos de grupo
escondidos, grid do `.painel` ajustado em conjunto (senão sobra vão cinza
do lado da faixa laranja). Escondido em telas ≤860px (a navegação vira
abas horizontais roláveis, não faz sentido recolher).

Testado no navegador: gradiente e animação da barra lateral, cabeçalho
branco com texto escuro em tema claro E escuro, logo correto
(`logo-claro.svg`), recolher/expandir com persistência após reload, texto
some de verdade ao recolher (checado via `getComputedStyle`, não só a
largura da barra), sem erro no console, layout mobile (390px) com a faixa
horizontal e sem o botão de recolher.

- Controle de SLA e alerta de vencimento.
- Aprovar cadastro pela própria tela, em vez de tratar o chamado de
  "Aprovação de Acesso" à mão.
- Tempo real (Supabase Realtime): hoje o quadro só atualiza ao recarregar
  — dois analistas com o Portal aberto não veem as ações um do outro.
- O solicitante ainda não tem por onde responder: a correspondência é
  gravada como pública, mas não existe tela do lado dele nem envio de
  e-mail avisando da resposta.

### Animações de arrastar-e-soltar (Portal) e de entrada/saída (Painel) (2026-09-15)

Pedido: dar mais dinamismo com animações JS, citando arrastar-e-soltar como
exemplo. Escopo combinado com o usuário antes de mexer: drag-and-drop de
cards/listas no Portal, e entradas/saídas no Painel (troca de aba, abrir/
fechar modal).

**FLIP no drag-and-drop (`comAnimacaoFlip`, portal.js)** — técnica First,
Last, Invert, Play: mede a posição do elemento ANTES de mover no DOM, deixa
o `appendChild`/`insertAdjacentElement` acontecer (a lógica de dados não
muda em nada), mede a posição DEPOIS, e anima só a diferença via
`transform` — o navegador só faz layout uma vez, o "deslizar até o lugar"
é uma ilusão de transform recuando até zero. Usada nos dois `drop` que já
existiam (`ligarArrastar` pros cards, `ligarArrastarLista` pras listas),
sem tocar a parte que fala com o Supabase. Anima também os cards/listas
vizinhos que são empurrados, não só o que foi solto. Verifica
`prefers-reduced-motion` uma vez (`RESPEITA_MOVIMENTO_REDUZIDO`) e pula a
animação inteira se estiver ligado — o reposicionamento continua
acontecendo, só sem o recuo animado.

`.fila` ganhou `transition` em `transform` (só tinha em `border-color`/
`background-color` antes) para o recuo do FLIP ter o que animar; `.card`
já tinha.

**Entradas/saídas no Painel (painel.css)**:
- `.painel-aba` ganhou `animation: painel-aba-entra` (fade + leve slide,
  0.18s) — dispara sozinha a cada troca de aba porque `ligarAbas`
  (painel.js) já alterna `[hidden]`, e `display: none → flex` reinicia a
  `animation` automaticamente, sem precisar de JS novo pra "rearmar" nada.
- `.pessoa` e `.item-simples` (os dois dialogs do Painel — editor de
  pessoa e o de item simples/unidade/setor/categoria/texto rápido)
  ganharam o mesmo padrão `allow-discrete` + `@starting-style` que o
  `.detalhe` do chamado já usava em portal.css: entra com leve escala em
  vez de aparecer seco, e a saída também anima (allow-discrete dá tempo da
  transição rodar antes do `display: none` sumir o dialog).
- `prefers-reduced-motion` não existia em painel.css — adicionado nos três
  blocos novos.

Testado no navegador (Playwright, gestos reais com `dragTo`, nunca
`DragEvent` sintético): card migrando de fila com `transform` real no meio
da transição e revertendo pra `none` no fim; lista reordenando; ambos sem
quebrar com `prefers-reduced-motion: reduce` (o reposicionamento acontece,
só sem o recuo); fade de aba com opacity medido no meio (0) e no fim (1);
dialog "Nova unidade" e "Nova pessoa" abrindo com opacity intermediário
real (não só 0 ou 1) e fechando; tema escuro testado no dialog de pessoa
(fundo escuro correto, sem flash branco); mobile 390px com a troca de aba
funcionando; zero erro no console em todos os cenários.

### Correções: scrollbar piscando no drag + botão de recolher da Base igual ao Painel (2026-09-15)

Dois relatos do usuário depois de ver as animações e a Base de Soluções:
"quando eu arrasto aparece uma barra de rolagem e logo depois some... parece
bug visual", e uma inconsistência visual — o botão de recolher a barra
lateral estava em formatos diferentes na Base (pílula laranja ao lado do
logo) e no Painel (linha com texto no rodapé). Confirmado com o usuário:
o padrão a seguir é o do Painel, não o da Base.

**Scrollbar piscando (portal.css)** — `.fila__cards` (a lista de cards
dentro de uma coluna) tem `overflow-y: auto` mas nunca escondia a barra
nativa do navegador, ao contrário de `.portal__quadro` (que já escondia a
sua e desenha uma própria, `.portal__barra`). O FLIP recém-adicionado
(`comAnimacaoFlip`) aplica um `transform` temporário no card solto que o
desloca da posição final até a posição onde estava sendo arrastado —
esse deslocamento pode ultrapassar momentaneamente os limites de
`.fila__cards` (que tem `max-height` herdado de `.fila`), disparando a
scrollbar nativa por ~0.2s até o `requestAnimationFrame` remover o
transform. Corrigido escondendo a barra nativa de `.fila__cards`
(`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`,
mesmo padrão do quadro) — a rolagem continua funcionando normalmente,
só a barra visual que não pisca mais.

**Botão de recolher da Base/Nova Solução igual ao do Painel** — a Base
(`public/base.html` + `base.css`) e a tela de Nova Solução
(`public/nova-solucao.html` + `nova-solucao.css`, que duplica boa parte
do CSS da Base) tinham o botão de recolher como uma pílula quadrada
28×28px, borda+fundo laranja translúcido, posicionada dentro de
`.sidebar__topo` ao lado do logo. Refeito para o mesmo padrão do Painel
(`.painel-nav__colapsar`): uma linha full-width com ícone + texto
"Recolher menu", empurrada pro rodapé da sidebar via um `.sidebar__espaco`
(`flex: 1`) antes dela, com `border-top` sutil separando do menu acima.
O atributo de estado (`data-sidebar`) e a chave de localStorage
(`sidebarColapsada`, em `public/js/main.js`) não mudaram — só a posição e
a forma do botão. Aproveitado pra também adicionar `aria-expanded` no
`main.js` (o Painel já tinha, a Base não).

As duas telas tinham um segundo bloco de CSS mais abaixo no arquivo
(seção "SIDEBAR: TOPO BRANCO, CORPO NO DEGRADE") que dava ao botão um
hover extra "estilo botão Entrar do login" — fazia sentido quando o botão
ficava sobre o topo branco da sidebar, mas não faz mais sentido agora que
ele está sobre o degradê laranja do rodapé. Neutralizado (removido, com
comentário explicando por quê) nos dois arquivos, deixando só o estilo
novo do bloco principal.

Testado no navegador: card arrastado pra uma coluna com vários itens
(forçando overflow real) sem nenhum espaço de scrollbar aparecendo antes,
durante ou depois da animação FLIP; botão "Recolher menu" na Base e na
Nova Solução no rodapé, largura recolhendo pra 96px, seta girando,
`aria-expanded` trocando, estado persistindo após reload; zero erro no
console nos dois fluxos.

## Fase 5 — Dashboard operacional

**Status: em andamento — primeira aba ("Resumo geral") pronta.**

### Painel: aba "Análise" — Resumo geral, substituindo o Power BI (2026-09-15)

Início da substituição do relatório em Power BI por um dashboard nativo:
mesmos gráficos, mas os dados vêm direto do Supabase em vez de uma
extração/tratamento manual. O usuário vai mandando as demais abas do BI
aos poucos — esta é a primeira, implementada e testada de ponta a ponta
antes de seguir para as próximas.

**Nova aba "Análise" no Painel** (`painel.html`, `painel.css`,
`painel.js`): item de navegação novo, seção própria
`[data-painel-aba="analise"]`, filtro de período (De/até, `<input
type="date">`, padrão = do dia 1 do mês até hoje, mesmo recorte do
exemplo que o usuário mandou do Power BI), 5 cards de número (Total de
tickets, Total de urgentes, % de urgentes, Média de solução, Tempo até a
primeira resposta) e 2 gráficos (barra horizontal — tickets por unidade;
doughnut — tickets por categoria).

O quinto card nasceu como "Mediana de solução" (é o que o print do Power
BI mostrava) e foi trocado a pedido do usuário para "Tempo até a primeira
resposta" (média): tempo entre `abertura_em` e o primeiro comentário de
alguém que NÃO é o solicitante — mesmo critério de "quem falou" que
`derivarStatus` usa (`chamado-comum.js`), só comentário público e humano
conta, nota interna e mensagem automática de abertura não. Isso trouxe a
tabela `comentarios` pra dentro da consulta desta aba
(`autor_id, criado_em, visibilidade, tipo`), que antes só buscava campos
de `chamados`.

**Carregamento sob demanda** (`ligarAnalise`, chamada de `montarPainel`,
disparada via um novo parâmetro `aoMostrar` em `ligarAbas`): diferente das
outras abas do Painel — que carregam tudo de uma vez em `montarPainel()`
via `CAMPOS_CHAMADO` sem filtro de data —, a consulta desta aba só roda na
primeira vez que a aba é aberta (ou de cara, se a pessoa chegar direto por
`?aba=analise`), e é uma query própria e enxuta: só os campos que os
gráficos precisam (`eh_urgente, abertura_em, fechamento_em,
unidades(nome), categorias(nome)`), sempre com o período aplicado no
banco (`gte`/`lte` em `abertura_em`). A base tem ~15 mil chamados; a regra
combinada com o usuário foi nunca trazer tudo de uma vez, o filtro de data
é quem limita a busca.

**Cálculos em JS** (client-side, não uma function/view nova no banco —
decisão do usuário dado que cada consulta já vem filtrada por período, não
pela base inteira): total e urgentes são contagem direta; % de urgentes é
`urgentes / total`; média/mediana de solução usam só os chamados com
`fechamento_em` preenchido (`fechamento_em - abertura_em` em horas); as
duas listas de contagem (por unidade, por categoria) são um `Map` que
agrupa e ordena do maior pro menor, alimentando os dois gráficos.

**Formato do tempo de solução** — combinado com o usuário: abaixo de 24h
mostra em horas ("7,2 horas"), 24h ou mais mostra em dias ("3,5 dias"),
nunca uma unidade fixa só (o print original do Power BI mostrava números
crus tipo "2.79" sem dizer a unidade).

**Chart.js 4.5.1 via CDN** (`cdnjs.cloudflare.com`, versão travada) — mesmo
padrão já usado pelo jsPDF na Base de Soluções (nenhuma dependência nova
instalada, sem passo de build). Cores do gráfico usam os tokens de cor do
projeto (`--texto-2`, `--borda`) pra texto/grade dos eixos, então o gráfico
já nasce certo em tema claro e escuro sem código duplicado; a paleta da
pizza é uma lista fixa de 10 cores (não um gerador aleatório), pensada pra
nunca repetir tom entre fatias vizinhas.

**Bug pego no teste, não no código em si**: o eixo X do gráfico de barras
às vezes mostrava passo decimal (0,2 / 0,4 / ...) quando a maior barra
tinha um valor baixo — estranho pra uma contagem de tickets, que é sempre
inteira. Corrigido com `ticks: { precision: 0 }` no eixo X.

Testado no navegador: cards e gráficos com números batendo com os dados
mockados (total, urgentes, %, média/mediana calculados à mão pra
conferir); mensagem de "nenhum chamado no período" aparecendo e escondendo
os cards quando o filtro não bate com nada; consulta rodando só uma vez
mesmo trocando de aba e voltando (cache do "já abriu"); chegada direta via
`?aba=analise` carregando sem precisar clicar; tema escuro com cores dos
gráficos corretas; mobile 390px com os cards em duas colunas e os
gráficos empilhados (mais um ajuste de quebra de linha no cabeçalho da
aba, `.painel-aba__topo { flex-wrap: wrap }`, que beneficia qualquer aba
com esse padrão de título + ação à direita, não só esta); zero erro no
console em todos os cenários.

### Análise: seletor de período estilo shadcn/ui — atalhos + calendário (2026-09-15)

Substituídos os dois `<input type="date">` simples por um seletor
completo, a pedido do usuário (mandou print de referência de outro
sistema): um botão que abre um popover com atalhos prontos (Hoje, Esta
semana, Este mês, Mês passado, Este ano — clicar já aplica e fecha) e um
calendário navegável ao lado para escolher um intervalo customizado
(dois cliques: início e fim; precisa confirmar). Construído do zero em
CSS/JS puro, sem lib de calendário — visual no **padrão shadcn/ui** do
projeto (superfície clara, borda 1px discreta, radius generoso, ver
`docs/preferencias.md`).

**Semana começa na segunda-feira** (padrão BR), tanto no atalho "Esta
semana" quanto na primeira linha da grade do calendário.

**Bug real encontrado no teste, não no design**: clicar num dia do
calendário fechava o popover sozinho, sem deixar escolher o segundo dia
do intervalo. Causa raiz: o clique em cada dia chamava uma função que
recriava a grade inteira (`diasEl.replaceChildren()` + 42 `<button>`
novos) dentro do próprio handler de clique — isso removia da árvore o
botão que acabou de ser clicado ANTES do evento terminar de subir
(bubbling) até o listener de "fechar ao clicar fora" no `document`; nesse
listener, `evento.target.closest(...)` num nó já desconectado da árvore
retorna `null`, então o clique era interpretado como "clique fora do
popover" e fechava tudo. Corrigido separando as duas responsabilidades:
`desenharCalendario()` (recria a grade — só quando o MÊS visível muda,
navegação ou abrir o popover) de `atualizarSelecaoNaGrade()` (só troca
classes CSS nos botões que já existem — a cada clique num dia), que
nunca remove nenhum nó da árvore durante o clique.

**Bug de fuso horário evitado, não corrigido — pego antes de escrever o
código**: `Date.toISOString().slice(0, 10)` converte pra UTC antes de
cortar a string; perto da meia-noite isso pode voltar um dia (23h de um
dia no Brasil já é depois da meia-noite em UTC). Um novo helper
`paraTextoLocal(data)` monta a string `AAAA-MM-DD` direto de
`getFullYear/getMonth/getDate` (hora local, nunca UTC) — usado em todo
lugar que precisa da data de um `Date` como texto (o filtro em si, o
rótulo do botão, a comparação de qual dia é hoje/início/fim no
calendário).

Testado no navegador: abrir/fechar o popover (botão, clicar fora, Esc);
os 5 atalhos aplicando e fechando na hora; selecionar um range de dias
com "Confirmar" habilitando só depois do segundo clique; "Cancelar" não
aplicando nada; navegar entre meses; o rótulo do botão mostrando o nome
do atalho ou "DD/MM – DD/MM" pro range customizado; a consulta ao banco
disparando com o `gte`/`lte` correto em cada cenário (conferido
capturando os parâmetros reais enviados); tema escuro; mobile 390px com
o popover empilhando (atalhos em linha no topo, calendário embaixo) em
vez de espremer os dois lado a lado; zero erro no console.

### Análise: sub-abas (Resumo geral / Unidades) e segunda página do Power BI (2026-09-15)

Segunda página do relatório Power BI sendo substituída ("UNIDADES"),
mais uma barra de navegação para trocar entre as páginas do dashboard —
o usuário mandou print de referência da Power BI original pra calibrar os
dois graficos.

**Sub-abas dentro de "Análise"** (`analise-subabas`/`analise-subaba` em
painel.html/painel.css): navegação no **rodapé** da seção (pedido
explícito do usuário — não no topo), pílulas horizontais, "Resumo geral"
e "Unidades" por enquanto, mais entram conforme o usuário for mandando as
próximas páginas do Power BI. O filtro de período no topo é compartilhado
por todas as sub-abas — trocar de sub-aba não reconsulta o banco, só
reprocessa em cima do `ultimoResultado` (a mesma consulta de chamados do
período) já guardado em memória.

**Aba "Unidades"** — 3 cards de destaque (não os 5 números gerais do
Resumo, que já aparecem na outra sub-aba): Unidade com mais chamados,
Unidade com mais urgência (maior % de urgentes), Unidade com maior tempo
de solução. "SLA" aqui foi confirmado com o usuário como o tempo médio de
solução em si (não existe meta/prazo configurável no sistema hoje para
calcular uma taxa de cumprimento de verdade).

Dois gráficos, calculados a partir do mesmo `agruparPorUnidade`:
- **Total de tickets por unidade** — barra empilhada (`Chart.js` com
  `stack: "total"`), cinza para chamados normais e vermelho para
  urgentes na mesma barra, ordenada pelo total (as duas fatias somadas).
- **Tempo de solução por unidade (h)** — barra simples, cor laranja
  (mesma do gráfico "por unidade" do Resumo), ordenada do maior pro menor
  tempo médio; unidades sem nenhum chamado fechado no período ficam de
  fora (não tem tempo de solução formado, uma barra zerada só confundiria).

As cores cinza/vermelho do gráfico empilhado são literais fixos
(`#9a9aa2`/`#e5484d`), não tokens de tema: são cor de DADO (o significado
de "normal" e "urgente" tem que ser reconhecível igual em claro ou
escuro), diferente de `--texto-4` — que existe pra legibilidade de texto
e muda de tom entre os temas.

Testado no navegador: os números dos 3 cards conferidos à mão contra um
cenário com duas unidades (uma com mais volume, outra com mais urgência e
SLA pior); trocar de sub-aba sem refazer a consulta; trocar o período
mantém a sub-aba atual e recalcula os gráficos dela; tema escuro; mobile
390px com os cards em duas colunas e a barra de sub-abas no rodapé
empilhando; zero erro no console.

**Correção**: com um nome de unidade comprido, o valor do card
("Corporativo Tecsat (14%)") quebrava em duas linhas e parecia MAIOR que
os cards de número seco do Resumo — mesma fonte/tamanho nos dois, só que
um cabe numa linha e o outro não, dando a impressão de tamanhos
diferentes lado a lado. Reduzido o `font-size` só de
`.analise-cards--3 .analise-card__valor` (os 3 cards de destaque por
unidade), deixando o texto visualmente equivalente ao dos cards do
Resumo mesmo quando quebra.

**Correção**: espessura das barras (`maxBarThickness`) nos 3 gráficos de
barra da Análise (unidade no Resumo, empilhado e SLA em Unidades) era um
número fixo (22px) — com poucas unidades (3, no exemplo do usuário) as
barras ficavam finas e bem espaçadas dentro dos 352px de altura do
container, sobrando muito vazio; com muitas unidades a mesma espessura
fixa faria as barras se espremerem ou vazarem. Trocado por
`espessuraDaBarra(quantidade)`: divide a altura do container pela
quantidade de barras e usa 60% disso como espessura, sempre entre um
piso de 14px (continua clicável/legível com muitas unidades) e um teto
de 48px (não vira um bloco gigante com só 1 ou 2 barras). Testado com 2,
3 e 15 unidades — poucas barras ficam grossas e preenchem o espaço
vertical, muitas ficam finas e cabem todas; tema escuro; zero erro no
console.

### Correção: fonte e arredondamento dos gráficos, padrão shadcn (2026-09-15)

Usuário reportou que os gráficos da Análise pareciam "fora do padrão" —
fonte diferente do resto do site e cantos sem arredondar em alguns
lugares. Causa: o Chart.js não herda fonte nenhuma do CSS da página,
cai na fonte genérica do navegador (Helvetica/Arial) se ninguém
configurar — nenhum gráfico até então tinha configuração de fonte.

**Fonte Poppins em tudo** — `Chart.defaults.font.family` e
`Chart.defaults.plugins.tooltip.*Font` setados uma vez só (`Chart` é
global do CDN, os defaults valem pra todo gráfico criado depois), em vez
de repetir a mesma opção em cada um dos 4 gráficos.

**Tooltip no padrão shadcn do projeto**: cantos arredondados
(`cornerRadius: 8`), fundo `#1a1a1a` fixo (não muda com o tema — um
tooltip escuro sobre qualquer fundo é o padrão usual de biblioteca de
gráfico, não precisa seguir --superficie), padding maior, texto em
Poppins. Também via `Chart.defaults`, então vale pros 4 gráficos.

**Arredondamento**: os dois gráficos de barra simples (unidade no
Resumo, SLA em Unidades) tinham `borderRadius: 4` — pouco visível,
aumentado pra 6 com `borderSkipped: false` (arredonda os 4 cantos, não só
os "de fora"). O gráfico **empilhado** (Total de tickets por unidade)
não tinha NENHUM arredondamento — era o que mais chamava atenção no
print que o usuário mandou, a barra cinza+vermelha parecia um bloco
reto. Corrigido com `borderRadius` por canto em cada dataset: o dataset
"Normal" arredonda só os cantos ESQUERDOS (início da barra), o "Urgente"
só os DIREITOS (fim) — arredondar os dois lados dos dois deixaria um vão
estranho onde as fatias se encontram no meio. Resultado: a barra inteira
parece uma única pílula com duas cores, não dois blocos colados.

O gráfico de pizza (categorias) ganhou um respiro entre fatias
(`borderColor` na cor do card, `borderWidth: 2` — usa `--superficie`, não
branco fixo, senão sobraria uma linha branca cortando o gráfico no tema
escuro) e `borderRadius` nas pontas das fatias.

Testado no navegador: os 4 gráficos com Poppins visível nos eixos/
legendas; a barra empilhada com as duas pontas arredondadas e sem quina
no meio (conferido com um recorte ampliado da imagem); tema escuro com
as mesmas cores/arredondamentos; `Chart.defaults` confirmado com os
valores certos via `page.evaluate`; zero erro no console.

### Correção: bug real de raiz na borda preta da pizza, arredondamento incompleto no empilhado, caixa das sub-abas (2026-09-15)

Usuário reportou três problemas depois de ver o ajuste anterior: a pizza
ganhou uma borda preta feia (era pra ser um respiro sutil), a barra
empilhada ficava reta numa ponta quando a unidade não tinha chamado
urgente, e a separação entre os gráficos e a barra de sub-abas embaixo
estava fraca demais.

**Causa raiz da borda preta — não era só a cor errada, era um bug de
verdade em `corDoTexto`**: a função lia
`getComputedStyle(document.documentElement)...` (a tag `<html>`), mas os
tokens de cor (`--texto-2`, `--borda`, `--superficie`) são declarados em
`body.portal-pagina` (`portal.css`), nunca em `:root`/`<html>`. Isso
sempre retornou string vazia — só que passou despercebido nos eixos e na
grade porque o **próprio Chart.js** já tem um cinza padrão parecido
quando a cor chega vazia; ficou óbvio só quando a borda da pizza caiu no
**preto** padrão do Chart.js em vez do branco/escuro pretendido. Corrigido
lendo de `document.body` em vez de `document.documentElement` — conserta
os 4 gráficos de uma vez, não só a pizza (os outros três já estavam
"certos por sorte", mas a mesma correção evita o mesmo bug se algum dia o
cinza padrão do Chart.js e o token do projeto divergirem visualmente).

**Arredondamento incompleto no empilhado**: só o dataset "Urgente" cobria
a ponta direita da barra — quando esse valor é 0 (unidade sem chamado
urgente, ex: Diadema, São José dos Campos), o Chart.js não desenha nada
nesse dataset, então a ponta direita nunca era arredondada e a barra
ficava com um lado reto. Corrigido calculando o `borderRadius` **por
linha** (array, não um objeto fixo pro dataset inteiro): o dataset
"Normal" arredonda só a esquerda quando a linha TEM urgente (o "Urgente"
cobre a direita), ou os 4 cantos quando a linha NÃO tem urgente (vira a
pílula inteira sozinho).

**Caixa das sub-abas**: tinha só uma borda fina em cima
(`border-top: 1px`), que sumia visualmente colada nos cards de gráfico
logo acima (que já tem sua própria borda visível). Trocado por um
cartão próprio — borda nos 4 lados, `border-radius: 12px`, fundo
`--superficie-2` (mesmo tom de apoio usado em fila/selo/campo no resto
do projeto, contrasta com as pílulas que usam `--superficie`) — fica
claramente uma seção separada, não uma continuação dos gráficos.

Testado no navegador: cor da borda da pizza confirmada via
`chart.data.datasets[0].borderColor` (branco no tema claro, escuro no
tema escuro — nunca preto); `borderRadius` por linha do dataset "Normal"
conferido via API do Chart.js (canto único quando tem urgente, 4 cantos
quando não tem); recorte ampliado da barra "Diadema" mostrando os dois
lados arredondados; caixa das sub-abas visível com fundo e borda
próprios em claro, escuro e mobile; zero erro no console.

### Correção: linhas de grade vertical removidas dos gráficos de barra (2026-09-15)

A correção anterior (`corDoTexto` lendo de `document.body`) fez as linhas
de grade verticais dos 3 gráficos de barra (unidade no Resumo, empilhado
e SLA em Unidades) aparecerem de verdade pela primeira vez — antes elas
existiam na configuração mas nunca renderizavam, por causa do mesmo bug
do `document.documentElement`. Usuário achou poluído. Trocado
`grid: { color: grade }` por `grid: { display: false }` no eixo X dos
três; a variável `grade` (`corDoTexto("--borda")`) ficou sem uso nas três
funções e foi removida. Os gráficos ficam só com os números do eixo,
sem linhas de fundo — confirmado pelo usuário que testou direto.

### Análise: terceira sub-aba — Categorias (2026-09-15)

Terceira página do relatório Power BI ("CATEGORIAS"), estrutura idêntica
à sub-aba Unidades, só trocando a dimensão de agrupamento (categoria em
vez de unidade). Nova pílula "Categorias" na barra de sub-abas no
rodapé; mesmo filtro de período do topo, mesma consulta já feita
(`categorias(nome)` já vinha selecionado desde a Fase 5 original, não
precisou de nenhuma mudança na query).

**3 cards**: Categoria com mais chamados, Categoria com mais urgência
(maior % de urgentes), Categoria com maior tempo de solução — mesmo
critério e formatação dos cards de Unidades.

**2 gráficos**: barra empilhada (Total de tickets por categoria, cinza/
vermelho normal/urgente) e barra simples laranja (Tempo de solução por
categoria, em horas) — mesma lógica de arredondamento por linha
(`borderRadius` como array, ponta cheia quando não há segmento urgente)
já corrigida na sub-aba Unidades.

**Decisão de implementação**: em vez de generalizar
`agruparPorUnidade`/`desenharCardsDeUnidades`/etc. num único conjunto de
funções parametrizadas, as quatro funções de Categorias
(`agruparPorCategoria`, `desenharCardsDeCategorias`,
`desenharGraficoCategoriasEmpilhado`, `desenharGraficoCategoriasSla`)
espelham as de Unidades quase linha por linha, só trocando a chave de
agrupamento. Prioriza manter o código já testado e funcionando intacto
(mudança cirúrgica) em vez de arriscar um refactor mais amplo — o
padrão shadcn/código do projeto favorece ajuste pontual quando o custo
de generalizar não compensa o risco.

Testado no navegador: os 3 cards conferidos à mão contra um cenário com
três categorias (uma com mais volume, outra 100% urgente, outra com pior
tempo de solução); trocar entre Resumo/Unidades/Categorias sem refazer a
consulta e sem quebrar nenhuma das outras; tema escuro; mobile 390px;
zero erro no console.

### Análise: quarta sub-aba — Setores (2026-09-15)

Quarta página do relatório Power BI, pedida pelo usuário como "exatamente
igual" às de Unidades e Categorias — mesma estrutura, 3 cards + 2
gráficos, só trocando a dimensão de agrupamento pra setor.

**Diferença de schema que exigiu ajuste na consulta**: ao contrário de
unidade/categoria (colunas diretas em `chamados`), setor é um dado do
**solicitante** do chamado (`chamado.usuarios.setores.nome`), não do
chamado em si — mesmo relacionamento já usado em `CAMPOS_CHAMADO`
(`chamado-comum.js`). A consulta de `carregar()` ganhou
`usuarios!chamados_solicitante_id_fkey(setores(nome))` a mais do que já
buscava.

Fora essa diferença de onde o dado vem, a implementação é idêntica às
duas sub-abas anteriores: `agruparPorSetor`, `desenharCardsDeSetores`,
`desenharGraficoSetoresEmpilhado`, `desenharGraficoSetoresSla` espelham
as funções de Unidades/Categorias linha por linha, incluindo a mesma
lógica de arredondamento por linha na barra empilhada.

Testado no navegador: os 3 cards conferidos à mão contra um cenário com
dois setores (um com mais volume normal, outro 100% urgente e com pior
tempo de solução); confirmado que o setor vem certo através do
relacionamento solicitante → setor (não uma coluna direta); trocar entre
todas as quatro sub-abas sem quebrar nenhuma; tema escuro; mobile 390px;
zero erro no console.

### Análise: quinta sub-aba — Solicitantes (2026-09-15)

Quinta página do relatório Power BI ("SOLICITANTES"). O print original
tinha, ao lado da barra, uma segunda área com uma lista de textos soltos
(parecia conteúdo de descrição/comentário dos chamados, meio bagunçado
no BI original) — o usuário pediu pra não replicar isso e dar "mais uma
ideia de gráfico baseado nos solicitantes" no lugar. Combinado com o
usuário: mesmo segundo gráfico que Unidades/Categorias/Setores já têm
(barra de tempo de solução), mantendo o padrão já estabelecido em vez de
inventar um formato novo.

**Limite de 10 nos gráficos** (pedido explícito do usuário, diferente
das sub-abas anteriores): solicitante pode ser dezenas de pessoas
diferentes, não um punhado de opções fixas como unidade/categoria/setor
— sem limite os dois gráficos de barra ficariam ilegíveis. `.slice(0,
10)` depois de ordenar em `desenharGraficoSolicitantesEmpilhado` e
`desenharGraficoSolicitantesSla`; os títulos dos gráficos dizem "(top
10)" pra deixar claro que é um recorte. Os 3 CARDS de destaque continuam
olhando todos os solicitantes do período, não só os 10 do gráfico.

**Consulta**: solicitante não tinha nome/sobrenome selecionados ainda —
a consulta só trazia `usuarios!chamados_solicitante_id_fkey(setores(nome))`
pra sub-aba Setores. Acrescentado `nome, sobrenome` no mesmo join.
Nome formatado com `nomeCompleto` (já importado de `chamado-comum.js`,
mesma função que o Portal usa pro mesmo dado).

Testado no navegador: os 3 cards conferidos à mão contra um cenário com
solicitantes diferentes (um com mais volume, outro 100% urgente, outro
com pior tempo de solução); confirmado que o gráfico corta em exatamente
10 barras mesmo com 15 solicitantes no conjunto de dados (contado via
`chart.data.labels.length`); trocar entre todas as cinco sub-abas sem
quebrar nenhuma; tema escuro; mobile 390px; zero erro no console.

### Análise: SLA em horas úteis, filtro global e sexta sub-aba — Atendentes (2026-09-15)

Última página do relatório Power BI da Fase 5 pedida até agora, mas veio
com duas mudanças que afetam TODA a seção Análise, não só esta sub-aba:
uma regra de SLA em horas úteis (confirmada pelo usuário como valendo
retroativamente pras 5 sub-abas já feitas) e um filtro global por
unidade/categoria/setor/atendente.

**SLA em horas úteis, não horas corridas** (`horasUteisEntre`, nova
função) — regra do expediente do TI: segunda a sexta 8h–17h48, sábado
8h–12h, domingo sem expediente. Um chamado aberto fora do expediente só
começa a "contar" na próxima abertura (confirmado com o usuário: sexta
17h47 não conta os minutos até a meia-noite, e sábado 8h–12h conta
normalmente como expediente — o exemplo original do usuário era só
ilustrativo, não um cálculo exato). Feriados não são considerados por
enquanto (decisão do usuário — só dia da semana + horário).

Algoritmo: para cada dia entre abertura e fechamento, soma a sobreposição
entre o intervalo do chamado e a janela de expediente daquele dia
(`Math.max` dos inícios, `Math.min` dos fins). Sem tabela de feriados,
sem hora extra — direto dia-a-dia, no máximo algumas centenas de
iterações mesmo pra um chamado aberto há anos.

Substituiu `(fechamento - abertura) / 3_600_000` em **9 lugares**: Média
de solução e Tempo até a primeira resposta (Resumo), e o SLA por grupo em
Unidades/Categorias/Setores/Solicitantes — busca e substituição em bloco,
já que o padrão de código era idêntico nos 9 pontos.

**Validado com o próprio exemplo do usuário antes de espalhar pelo
código**: escrito um teste isolado da função com o cenário "sexta 17h47 →
segunda 8h" — bateu exatamente 4h01min (1 minuto de sexta + as 4h de
expediente do sábado de manhã, que o usuário confirmou que TAMBÉM conta
— o "quase 0" do exemplo original era só a ideia geral de não contar o
fim de semana fechado, não um valor exato a reproduzir). Só depois de
validar a função isolada ela foi espalhada pelos 9 pontos do código.

**Filtro global** (`data-analise-filtro-*`, ao lado do seletor de
período): unidade/categoria/setor em chips, atendente com busca e
checkbox (pode ter muita gente) — mesmo componente visual do filtro de
"Todos os tickets" (`ligarFiltroDeTickets`), reimplementado com funções
próprias (`grupoChipsAnalise`/`grupoPessoasAnalise`) porque o filtro de
tickets é de uma tabela paginada e este é sobre o conjunto agregado
compartilhado por todas as sub-abas. Client-side, sobre o que a consulta
já trouxe do período — nunca uma segunda consulta ao banco. As opções de
cada grupo são derivadas de quem realmente aparece no período carregado
(`ultimoResultado`), não uma lista fixa — nunca mostra uma opção sem
nenhum chamado correspondente.

A consulta de `carregar()` ganhou `unidade_id`, `categoria_id`, `setor_id`
(do solicitante) e `chamado_membros(usuario_id, usuarios(nome,
sobrenome))` — precisos pro filtro cruzar id, não só nome.

**Aba "Atendentes"**: 4 cards (mais chamados, mais urgência, maior SLA,
melhor tempo de primeira resposta — único card da página onde o número
MENOR é o destaque, não o maior) e 2 **gráficos de coluna em pé**
(`indexAxis` padrão do Chart.js, diferente das barras deitadas das outras
sub-abas — pedido explícito do usuário). Como um chamado pode ter VÁRIOS
atendentes ao mesmo tempo (`chamado_membros` é N:N, diferente de unidade/
categoria/setor/solicitante que são 1:1), `agruparPorAtendente` soma o
mesmo chamado no grupo de CADA atendente nele, sem dividir/ratear — dois
atendentes no mesmo chamado "ganham" ele inteiro cada um na contagem.

Testado no navegador: `horasUteisEntre` isolada contra 5 cenários (mesmo
dia, atravessando sábado, domingo inteiro, atravessando fim de semana
completo) antes de integrar; o cenário do Resumo mostrando "4 horas" em
vez das ~62h corridas que seria sem a regra; o filtro reduzindo o total
de tickets corretamente ao marcar uma unidade, voltando ao total ao
limpar, e filtrando corretamente por "Sem atendente"; os 4 cards e os 2
gráficos de coluna da aba Atendentes com números conferidos à mão contra
um cenário de dois atendentes (um com mais volume, outro com mais
urgência e pior SLA); as 6 sub-abas testadas em sequência sem quebrar
nenhuma; tema escuro; mobile 390px; zero erro no console.

### Correção: rótulo do eixo nos gráficos de Atendentes — só primeiro nome (2026-09-15)

Usuário mandou print do Power BI de referência mostrando os rótulos do
eixo em duas linhas ("ENZO XAVIER" empilhado); pedido inicial foi
replicar esse empilhamento, mas na conversa ficou confirmado que o
usuário queria só o **primeiro nome**, sem sobrenome nenhum — mais curto
que o exemplo do BI, não uma cópia exata dele.

**Bug pego durante o teste, corrigido antes de declarar pronto**: a
primeira implementação cortava o nome completo com `nome.split(" ")[0]`
— funciona pra "Enzo Xavier" (vira "Enzo"), mas quebra pra alguém como
"João Gabriel Arantes", cujo PRIMEIRO NOME de verdade no banco (coluna
`nome`) já é "João Gabriel" (duas palavras) — o split cortava no meio do
primeiro nome e mostrava só "João". Corrigido usando `primeiroNome()` (de
`chamado-comum.js`, que só retorna `pessoa.nome` sem tentar adivinhar
onde o nome "termina") em vez de reimplementar a lógica errada na mão.
Isso exigiu adaptar `agruparPorAtendente` pra guardar `{ pessoa,
chamados }` por grupo (não só a lista de chamados), já que o rótulo
precisa do objeto usuário original, não só do nome completo já
concatenado usado como chave do mapa. `primeiroNome` também precisou ser
importado — não estava na lista de imports de `chamado-comum.js` neste
arquivo até agora.

Os CARDS de destaque continuam com nome completo (`nomeCompleto`, ex.
"Enzo Xavier (7)") — só o rótulo dos dois gráficos ficou curto. Sem
rotação diagonal (`maxRotation: 0, minRotation: 0`): com nome curto o
rótulo cabe na horizontal, então nunca precisa do giro automático que o
Chart.js aplicava antes quando os nomes completos não cabiam.

Testado no navegador: rótulo "Enzo" e "João Gabriel" lado a lado sem
cortar nem girar (confirmado via API do Chart.js, não só visualmente);
card de destaque continuando com nome completo; cenário com dois
atendentes de primeiro nome igual mas sobrenomes diferentes ("João
Gabriel Arantes" e "João Paulo Cardoso Antunes") sem colidir na contagem
nem no rótulo; tema escuro; mobile 390px; zero erro no console.

### Análise: sétima sub-aba — Acompanhamento (2026-09-15)

Última página do relatório Power BI da Fase 5. Estruturalmente diferente
das outras 6: agrupa por **MÊS**, não por dimensão (unidade/categoria/
setor/solicitante/atendente), e usa uma **consulta própria** — sempre os
**últimos 12 meses fixos**, independente do filtro de período no topo da
Análise (esse período só vale pras outras 6 sub-abas; confirmado com o
usuário). O filtro global de unidade/categoria/setor/atendente continua
valendo aqui, aplicado sobre os 12 meses da mesma forma que já aplica
sobre o período das outras abas.

**Carregamento próprio e preguiçoso**: `carregarAcompanhamento()` só
dispara na primeira vez que a sub-aba abre (`jaAbriuAcompanhamento`,
espelhando o mesmo padrão da seção inteira), guardando o resultado em
`dadosAcompanhamento` — trocar de sub-aba ou mexer no filtro depois não
refaz essa consulta, só reprocessa o que já está em memória.

**4 cards de variação** (mês atual vs. mês anterior, sempre os dois
últimos dos 12 meses fixos, mesmo que um deles não tenha chamado
nenhum): variação de chamados em número, em percentual, variação do SLA
médio dos chamados normais, e dos urgentes — os quatro comparando só o
mês corrente contra o anterior, não uma tendência ao longo dos 12. Cor
semântica nova (`.analise-card__valor--alta` vermelho / `--baixa` verde)
indica só a DIREÇÃO da variação (subiu/desceu), não se é bom ou ruim —
mais chamados subir é neutro/ruim, SLA subir é ruim, mas a cor em si é
sempre "vermelho = número maior que o mês anterior", quem interpreta o
significado é o rótulo do card.

**2 gráficos de linha** (`type: "line"`, sempre 12 pontos — meses sem
nenhum chamado aparecem como 0, nunca somem do eixo): "Total de tickets
por mês" (uma linha laranja) e "Tempo de solução por mês" (duas linhas,
cinza para normal e vermelho para urgente — mesma paleta de dado fixa já
usada nos gráficos empilhados das outras sub-abas). Layout empilhado
verticalmente (`.analise-graficos--linha`), não lado a lado como as
outras 6 — mesmo layout do print de referência do Power BI.

**Valor anotado em cima de cada ponto**: o Chart.js core não tem isso
pronto (só via `chartjs-plugin-datalabels`, uma lib externa) — em vez de
carregar mais um script CDN só pra desenhar um número por ponto, foi
escrito um plugin inline (`desenharValoresDaLinha`, um objeto com
`afterDatasetsDraw` que usa a Canvas API direto) e passado via `plugins:
[...]` só nesses dois gráficos — mantém o padrão do projeto de não
adicionar dependência nova quando dá pra resolver com poucas linhas.

Testado no navegador: os 4 cards de variação conferidos à mão contra um
cenário com 10 chamados no mês atual e 5 no anterior (esperado +5, +100%)
e tempos de SLA normal/urgente diferentes entre os dois meses
(recalculado à mão em horas úteis pra bater com os dois casos, incluindo
um chamado aberto sábado que só conta as horas de expediente do
sábado); os 12 pontos aparecendo na ordem certa com zero nos meses sem
chamado; o filtro global (testado com unidade) reduzindo o total do
gráfico corretamente; trocar de sub-aba sem refazer a consulta; as 7
sub-abas testadas em sequência com troca rápida entre todas, sem
acumular erro; tema escuro; mobile 390px; zero erro no console.

### Correção do botão de filtro + exportar Análise em PDF (2026-09-15)

Dois pedidos depois de ver a Análise pronta.

**Botão de filtro desalinhado**: `.periodo-seletor__botao` não tinha
altura fixa (crescia com o padding + linha de texto, ~35px), enquanto
`.painel-icone-botao` (usado pelo filtro) tem `height: 2.75rem` (44px)
fixo — os dois lado a lado no topo da seção ficavam com alturas
diferentes, dando a impressão de "desconfigurado". Corrigido com a mesma
altura fixa nos dois.

**Exportar em PDF**: novo botão de ícone ao lado do filtro, dropdown com
"Esta página" (só a sub-aba aberta) e "Tudo" (as 7 sub-abas, uma por
página, no mesmo arquivo). Pedido era "o resultado exato do dashboard"
— cores, gráficos, layout — não um relatório de texto, então o padrão de
PDF já existente na Base de Soluções (`baixarPdfSolucao` em `base.js`,
que desenha tudo à mão com jsPDF puro) não servia aqui. Solução:
**html2canvas** (nova dependência via CDN, mesmo padrão sem-build do
projeto) tira uma "foto" da sub-aba renderizada — inclusive os canvas do
Chart.js — e o **jsPDF** (já usado no projeto) cola essa imagem numa
página A4 retrato, escalada pra caber na largura útil mantendo a
proporção (nunca distorce).

Cada página ganha uma faixa de contexto no topo ("Análise — Resumo
geral", "Período: Este mês") inserida no DOM só durante a captura e
removida logo depois — nunca aparece na tela normal do usuário, só existe
o tempo de tirar a "foto".

**"Exportar tudo" precisa mostrar cada sub-aba de verdade antes de
capturar**, não só tirar o `[hidden]`: um canvas do Chart.js que nunca
ficou visível neste carregamento da página nasce com largura 0 (mesmo
problema já resolvido antes pra troca normal de sub-aba). A função usa
`mostrarSubaba(chave)` de verdade a cada iteração do loop, espera dois
`requestAnimationFrame` pro Chart.js terminar de desenhar, só então
captura — e restaura a sub-aba que o usuário estava vendo antes de
começar, ao final.

Testado no navegador: os dois botões (período e filtro) com a mesma
altura (44px) medida via `getBoundingClientRect`; "Esta página" baixando
um PDF de ~125KB com o conteúdo exato da sub-aba (conferido lendo o PDF
gerado — cards, gráficos, cores batendo com a tela); "Tudo" baixando um
PDF de ~890KB (7 páginas); a sub-aba original (Resumo) continuando
visível depois que "Exportar tudo" termina; tema escuro; mobile 390px;
zero erro no console.

### Correção: cabeçalho e barra lateral do Painel também escurecem no tema escuro (2026-09-15)

Reverte parte da decisão de [Painel: barra lateral laranja, cabeçalho
branco e recolher menu](#painel-barra-lateral-laranja-cabecalho-branco-e-recolher-menu-2026-09-15)
(mais acima, mesma data): lá o pedido era cabeçalho e sidebar **sempre**
brancos/laranja, ignorando o tema. Agora o pedido inverteu — "no modo
escuro tem que ficar tudo escuro, a barra lateral e o cabeçalho" — e o
usuário confirmou que os dois (não só o cabeçalho) devem escurecer.
Tema claro continua idêntico a antes (branco + laranja).

**Cabeçalho** (`.barra-portal` dentro de `body.painel-pagina`): a regra
antiga tinha `[data-tema="escuro"] body.painel-pagina .barra-portal`
junto com a versão sem tema, forçando branco nos dois casos — bastou
tirar esse seletor extra da regra clara e escrever um bloco novo só
para `[data-tema="escuro"]`, usando `var(--superficie)` / `var(--texto)`
/ `var(--borda)` (os mesmos tokens que o resto da tela já usa no
escuro) em vez dos hexadecimais fixos.

**Barra lateral** (`.painel-nav`): trocado o degrade laranja fixo por
`var(--superficie-2)` sólido no tema escuro, com a animação de
respiração desligada (ela anima `background-position`, que não faz
sentido sem gradiente). Itens do menu passam a usar `var(--texto-2)` /
`var(--texto)` em vez de branco translúcido; o item ativo usa
`var(--laranja-forte)` (o único dos dois tokens de laranja que o tema
escuro já redefine para um tom mais vivo) em vez do `#c77240` fixo.
Estados de hover/active/colapsado seguem o mesmo padrão de tokens.

Testado no navegador (servidor local + mocks de auth/Supabase): tema
claro em desktop e mobile (390px) idêntico a antes; tema escuro em
desktop com cabeçalho e sidebar escuros e o item ativo em laranja
vivo; sidebar recolhida (`data-painel-sidebar="colapsada"`) no escuro
também correta; mobile 390px no escuro com o cabeçalho escuro e as
abas horizontais mantendo o item ativo em laranja; zero erro no
console em todos os casos.

**Segunda rodada, mesmo dia**: a logo "GASÔMETRO madeiras" no cabeçalho
ficou ilegível (texto escuro sobre o novo fundo escuro) — faltava trocar
a imagem, não só a cor de fundo. `portal.css` já tinha as regras prontas
pra isso (`.topo__logo--claro` / `.topo__logo--escuro`, alternando via
`display` conforme `[data-tema="escuro"]`), só nunca tinham sido usadas
em nenhuma página — o `<img class="topo__logo">` do Painel era único, com
`logo-claro.svg` fixo. Adicionado um segundo `<img>` com
`logo-branco.svg` e as duas classes modificadoras; `.topo__logo-link`
já é `display: flex`, então as regras de `display: none` cuidam de
mostrar sempre exatamente uma das duas. Testado em claro, escuro e
mobile 390px: logo escura no tema claro, logo branca legível no tema
escuro, sem as duas aparecendo ao mesmo tempo; zero erro no console.

### Urgência automática, título padronizado e limites de texto (2026-09-16)

Três mudanças pedidas juntas, todas no banco (migration
`20260916090000_urgencia_automatica_e_limites_texto.sql`, já aplicada).

**Bug da prioridade (relatado pelo usuário)**: um chamado aberto com
"cliente na loja" e "sistema fora do ar" marcados veio como normal. Causa
raiz: **nada no sistema escrevia em `eh_urgente`** — a coluna tinha
default `false`, o formulário só mandava `cliente_na_loja` /
`sistema_lento_ou_fora`, e nenhum dos 5 triggers de `chamados` olhava
essas flags. Não era um cálculo errado, era um cálculo que nunca existiu:
nenhum chamado no banco tinha urgência automática. Corrigido com o trigger
`chamados_definir_urgencia` (BEFORE INSERT OR UPDATE das duas colunas):
qualquer uma das duas marcadas ⇒ urgente. Ficou no banco, e não no JS,
porque vale para qualquer origem — inclusive a migração dos ~14 mil
chamados. O histórico foi corrigido retroativamente (o #49 do usuário e o
#42). O #7, que estava urgente manualmente sem nenhuma das flags, foi
preservado: o `update` só marca, nunca desmarca. Efeito colateral a
lembrar: editar as flags do #7 recalcula a urgência dele para `false`.

**Título padronizado com o número do ticket**. Formato definido pelo
usuário:

| Caso | Título |
|---|---|
| Assunto digitado | `#46 - Impressora com erro` |
| Categoria comum, sem assunto | `#46 - Pedidos` |
| Cadastro / Desligamento / Aprovação de Acesso | `#46 - Cadastro: Enzo` |

Só essas três categorias levam nome (são os chamados sobre uma *pessoa*);
as outras nove ficam só número + categoria. O rótulo é sempre o nome da
categoria, venha o chamado do formulário ou não — foi o pedido explícito
de padronização, depois de uma primeira versão que usava "Cadastro de
Colaborador" pelo formulário e "Cadastro" pela categoria.

Isso mora no banco por uma razão dura: `numero` é `GENERATED ALWAYS AS
IDENTITY`, ou seja, **só existe depois do insert** — o formulário não tem
como montar "#46" antes de gravar. O JS passou a mandar `titulo: null` e
quem monta é o trigger `chamados_montar_titulo` (BEFORE INSERT, onde
`new.numero` já está disponível). Substitui `preencher_titulo_chamado`
(formato antigo `Categoria | Ticket-N`), que ainda por cima fazia um
`UPDATE` extra na tabela depois do insert; a função antiga foi removida.

De onde vem o nome depende da origem, e isso importa: pelo formulário é o
**colaborador** digitado num campo único ("Enzo Xavier Santos"), então
corta no primeiro espaço; fora dele é quem abriu, e aí `usuarios.nome` já
guarda só o primeiro nome (sobrenome é coluna separada) e vai inteiro —
cortar no espaço quebraria "João Gabriel" para "João", o mesmo bug de nome
composto que já tinha aparecido nos gráficos de Atendentes.

**Limites de texto**: título e descrição eram `text` sem teto — dava para
colar páginas inteiras no assunto. Agora `CHECK` de 120 e 1200. O limite
real mora no banco porque `maxlength` é só conforto de digitação e não vale
nada contra inserção pela API. No formulário o assunto ficou em 110 (não
120) porque o banco prefixa `#46 - `, e o título montado é cortado em 120
em vez de o chamado ser recusado. A descrição gerada de Cadastro/
Desligamento (~12 campos concatenados) também é truncada no JS: no pior
caso ela dá ~1104 e cabe, mas afrouxar um `maxlength` sem refazer a conta
faria o insert falhar.

O assunto do Suporte virou **opcional** (pedido do usuário) — sem ele o
título cai no formato com a categoria. Os campos de texto ganharam
contador (`47/60`, laranja ao encher), já que `maxlength` sozinho trava o
campo sem explicar por quê.

Testado: lógica dos títulos contra as 12 categorias reais e o usuário de
nome composto, em tabela temporária; CHECKs recusando 121/1201 e aceitando
120/1200; e um teste ponta a ponta com 4 chamados inseridos de verdade
(autorizado pelo usuário, gerando `#51 - Impressora com erro`,
`#52 - Pedidos`, `#53 - Cadastro: João Gabriel`, `#54 - Cadastro: Enzo`
com a urgência correta em cada um) e apagados em seguida — sem sobras nem
comentários órfãos.

### SLA: hora de almoço descontada nos dias de semana (2026-09-16)

O expediente de segunda a sexta virou **duas janelas** — 8h às 12h e 13h
às 17h48 — em vez de uma corrida das 8h às 17h48. A hora de almoço da
equipe não conta para o SLA, então chamado aberto e fechado dentro dela
tem 0 de SLA. Sábado continua 8h às 12h (sem almoço, o expediente já
termina no horário) e domingo segue fechado.

A mudança foi estrutural: `EXPEDIENTE_POR_DIA_DA_SEMANA` passou de *uma
janela por dia* (`{ inicio, fim }` ou `null`) para *uma lista de janelas*
(`[]` no domingo), e `horasUteisEntre` soma a sobreposição de cada janela
do dia em vez de uma só. O resto do algoritmo não mudou — continua
andando dia a dia e somando interseções, e os 16 pontos de chamada nas 7
sub-abas da Análise não precisaram de ajuste nenhum.

Efeito nos números: o dia útil caiu de 9h48 para **8h48**, então toda
média de solução e de primeira resposta que cruze um almoço diminui
retroativamente (o SLA é recalculado a cada carregamento do Painel, não
fica gravado).

Testado com 15 casos em script Node — 4 específicos do almoço (só almoço
= 0; 11h50→13h10 = 20min e não 1h20; aberto e fechado dentro do almoço =
0; 12h30→14h = 60min), mais bordas já cobertas antes (fora do expediente,
virada de dia, sex 17h47→seg 8h, sábado, domingo, fim antes do início).
Todos passaram. No navegador, a Análise carregou sem erro no console com
chamados que cruzam o almoço, mostrando média de solução 4,6h (0,33h +
8,8h) e primeira resposta 0,3h — os valores com o almoço descontado.

### Níveis de acesso: solicitante, contribuinte, analista, admin (2026-09-16)

Hierarquia definida pelo usuário, do menor para o maior:

| Perfil | Abre chamado | Lê a Base | Cadastra solução | Portal | Painel |
|---|---|---|---|---|---|
| solicitante | sim | sim | — | — | — |
| contribuinte | sim | sim | **sim** | — | — |
| analista | sim | sim | sim | **sim** | — |
| admin | sim | sim | sim | sim | **sim** |

Os quatro perfis já existiam no CHECK da tabela, mas `parceiro` (renomeado
para `contribuinte`, ninguém usava) tinha permissões erradas e duas das
telas não checavam nada. O que foi feito, em três camadas:

**Banco** (`20260916140000_niveis_de_acesso.sql`):
`is_equipe_ti()` deixou de incluir contribuinte — essa função guarda os
**chamados**, e contribuinte não vê chamado. Como a escrita de artigos
usava a mesma função, a Base ganhou a sua própria
(`pode_escrever_artigo()`), senão o contribuinte perderia justamente o que
define o perfil dele. São duas permissões distintas que por coincidência
tinham a mesma lista.

**Dois furos de segurança encontrados no caminho**, ambos fechados por um
trigger `usuarios_protege_perfil`:

1. A policy "edita o próprio perfil" permitia atualizar a **linha inteira**
   da própria pessoa, sem restringir colunas — na prática **um solicitante
   podia se promover a admin pela API**.
2. A policy de editar outros usava `is_equipe_ti()`, o que daria ao
   analista o poder de promover alguém. Pelo combinado, só admin promove.

O controle ficou em trigger, e não no `WITH CHECK` da policy, porque lá um
subselect na própria tabela lê a linha em estado ambíguo — num
`BEFORE UPDATE` o `OLD` e o `NEW` são explícitos, que é exatamente o que a
regra precisa comparar. A equipe também não aprova a si mesma.

**Perfil desamarrado do setor** (`20260916150000_perfil_independente_do_setor.sql`):
existia um `sincronizar_setor_perfil()` que reescrevia o perfil a cada
update — quem entrasse no setor "Administrador" virava admin, e um admin
que mudasse de setor era **rebaixado a solicitante silenciosamente**. Fazia
sentido quando só havia dois perfis; com quatro, atrapalha. Pior: rodava
*depois* de `protege_perfil_usuario` (ordem alfabética dos triggers), então
tinha a palavra final sobre quem tinha permissão para decidir. Removido —
os 5 admins estão todos no setor Administrador, então nenhum perfil mudou.
`bloquear_autoaprovacao()` foi reescrito para cuidar só do `setor_id`, sem
sobrepor a regra nova.

**Guards** (dois arquivos novos): `portal.html` e `nova-solucao.html` só
tinham o `auth-guard` — qualquer pessoa logada que digitasse a URL via a
interface. Criados `portal-guard.js` (analista + admin) e
`solucao-guard.js` (contribuinte + analista + admin), no mesmo padrão do
`painel-guard.js`. A checagem duplicada que vivia dentro do
`nova-solucao.js`, com a lista desatualizada, foi removida.

**Front alinhado**: o link do Portal no menu aparecia só para admin —
agora acompanha `equipeTi`. `main.js` passou a ter duas flags (`equipeTi` e
`escreveArtigo`) em vez de uma. E o `portal.js` tinha a regra real de
acesso ao Portal hardcoded em `admin` (`quemEstaAtendendo`), o que deixava
o Portal restrito a admin mesmo com o banco permitindo analista. Duas
consultas de "quem pode ser posto num chamado" usavam
`neq("perfil","solicitante")`, que passaria a incluir o contribuinte —
trocadas por lista explícita. Rótulos "Parceiro" → "Contribuinte" no
Painel, e a Edge Function `criar-usuario` (que valida o perfil no servidor)
teve a lista corrigida e **foi redeployada**.

Testado: 8 casos do trigger de perfil em tabela temporária (solicitante não
se promove nem se auto-aprova mas edita o próprio nome; analista aprova
outro cadastro mas não promove; admin promove e desativa; equipe não
aprova a si mesma) — todos passaram. No navegador, a matriz 4 perfis × 3
telas bateu exatamente com a tabela acima, sem erro de JS.

### Perfil de acesso na ficha de aprovação de cadastro (2026-09-16)

Continuação direta da mudança de níveis de acesso, a partir da pergunta do
usuário: "quem se cadastra escolhendo o setor Administrador entra com qual
perfil?". Resposta: **solicitante/pendente** — e isso era um efeito
colateral não anunciado da remoção do `sincronizar_setor_perfil` no mesmo
dia. Antes, o setor promovia a admin automaticamente, inclusive num
cadastro novo; ao remover o trigger, a promoção sumiu junto.

A decisão foi manter o cadastro manual (ninguém se auto-promove pelo
formulário) e levar a escolha para onde ela já acontece: a ficha de
aprovação que chega no Portal como chamado de "Aprovação de Acesso". O que
mudou nela:

- **Campo "Perfil de acesso"** abaixo do de Setor, com os quatro perfis. O
  padrão vem do setor escolhido no cadastro: setor "Administrador" sugere
  **Admin** (com a dica "Sugerido pelo setor Administrador — confirme antes
  de aprovar"), qualquer outro sugere **Solicitante**. Trocar o setor
  re-sugere o perfil, até quem aprova escolher um na mão — daí a sugestão
  para de sobrescrever.
- **"Setor informado"** entre os dados de conferência. O `<select>` de
  setor pode ser trocado por quem aprova, e sem isso a informação original
  (onde a pessoa disse que trabalha, que é o que justifica a sugestão de
  perfil) se perderia da tela.
- **Só admin decide.** Analista continua abrindo o chamado e vendo os
  dados, mas os dois selects ficam desabilitados, os botões
  Aprovar/Rejeitar somem e aparece o aviso. Não é só cosmético: trocar
  perfil passa pelo trigger `protege_perfil_usuario`, que só aceita admin —
  sem esconder, o analista clicaria em Aprovar e receberia um erro seco do
  banco.
- O perfil só é gravado ao **aprovar** (rejeitar não concede acesso) e
  apenas quando mudou de fato, para o analista continuar aprovando cadastro
  sem esbarrar na regra do trigger.

Dois ajustes de apoio: `CAMPOS_CHAMADO` passou a trazer o `perfil` do
solicitante (sem ele a comparação "mudou?" seria sempre verdadeira), e
`quemEstaAtendendo()` passou a devolver `{ id, perfil }` em vez de só o id
— o id continua sendo passado como antes para os 9 usos existentes, e o
perfil vai num parâmetro novo de `ligarDetalhe`.

Testado no navegador com a ficha real de um cadastro pendente com setor
Administrador: como admin, sugestão "Admin", campos livres e botões
visíveis; como analista, selects bloqueados, botões ocultos e o aviso; ao
trocar o setor para Vendas, a sugestão volta para "Solicitante" e a dica
some. Zero erro de JS nos dois perfis.

**Grade quebrada, corrigida em seguida**: o usuário apontou que a ficha
ficava "com a grade quebrada" em comparação à do Suporte TI. O CSS era o
mesmo (`.dados`, duas colunas) — o problema era a contagem de células. A
grade pinta o fundo pelo gap, então uma célula faltando vira um retângulo
cinza visível. A ficha tinha 6 campos com o **e-mail largo no meio**, o
que deixava 5 células simples e sobrava um buraco; o Suporte TI tem 9
campos, mas o largo é o **último**, fechando a linha. Reordenado para o
mesmo padrão: pares lado a lado e o campo longo encerrando. Como isso
deixava 5 simples, entrou "Cadastro" (pendente/aprovado/rejeitado), que é
informação útil ali e completa o par. Conferido em tema claro e escuro.

### Acesso remoto no formulário de Suporte, com memória do último informado (2026-09-16)

A coluna `chamados.acesso_remoto` existia desde o começo e já aparecia na
ficha do Portal, mas **nenhum formulário a preenchia** — `montarChamado()`
mandava `acesso_remoto: null` fixo nos três tipos. Por isso a ficha sempre
mostrava "Não informado": não havia como informar. Nenhum dos chamados do
banco tinha valor.

Agora o Suporte TI tem o campo (texto livre, opcional, 120 caracteres):
IP ou ID do VNC, TeamViewer ou AnyDesk, conforme definido pelo usuário.

**Memória do último informado**: o campo já vem preenchido com o último
acesso remoto que a pessoa informou em qualquer chamado anterior — é quase
sempre o mesmo computador, e redigitar o IP a cada chamado era trabalho
repetido. A consulta entra no mesmo `Promise.all` do carregamento (sem
round-trip extra) e pega o mais recente com `acesso_remoto is not null`,
ordenado por `abertura_em`. O `not null` é a regra combinada com o
usuário: abrir um chamado com o campo vazio **não** apaga a memória — o
valor anterior volta no próximo. Por isso o envio grava `null` (e não `""`)
quando o campo está vazio, senão uma string vazia entraria no histórico e
viraria a "última" resposta.

A consulta fica **fora** do check de erro do carregamento de propósito: é
conveniência, não dado necessário para abrir chamado. Se falhar, o campo só
fica vazio em vez de travar o formulário.

Duas sutilezas de interface: uma dica abaixo do campo explica de onde veio
o valor ("Repetido do seu último chamado"), senão a pessoa estranha um IP
que não digitou; e ela some assim que a pessoa edita, porque aí o valor
passa a ser dela. O valor também é guardado em `acessoRemotoSalvo` e
reaplicado depois do `formulario.reset()` do "Abrir outro chamado" — o
reset apagaria o campo, mesmo motivo pelo qual os dados de quem está
abrindo já eram repreenchidos ali.

Testado no navegador: com histórico (campo preenchido + dica), após editar
(valor novo, dica some), sem histórico (vazio, sem dica), e o envio real
confirmando `acesso_remoto: "192.168.0.99"` no insert. Zero erro de JS.

### Cadastro com confirmação de e-mail por código (2026-09-16)

Antes o cadastro criava a conta e entrava direto no portal — não havia
nenhuma prova de que a pessoa tinha acesso ao e-mail informado. Agora o
fluxo tem uma terceira etapa, com a mesma mecânica da recuperação de senha:
código de 6 dígitos, `verifyOtp`, reenvio com trava de 1 minuto.

A confirmação é a **nativa do Supabase** (`enable_confirmations`), que
estava desligada — era por isso que o `signUp` autenticava na hora. Ligada,
ele mesmo envia o código; o front só chama `verifyOtp` com
`type: "signup"` (o de recuperação usa `type: "recovery"`). O remetente é o
mesmo de todos os e-mails de auth, configurado uma vez em
`[auth.email.smtp]`: `helpdeskti@madeirasgasometro.com.br`.

Template próprio (`supabase/templates/confirmacao.html`, mesmo formato do
`recovery.html`) porque o padrão do Supabase vem em inglês e com
`{{ .ConfirmationURL }}` — um link, não o código que a tela espera.

**O chamado de "Aprovação de Acesso" saiu do `handle_new_user`**
(`20260916170000`): antes nascia junto com a conta, o que agora encheria a
fila do TI de cadastros começados e abandonados, de e-mails que ninguém
abriu. Passou para um trigger `on_auth_user_email_confirmed`, que dispara
quando `auth.users.email_confirmed_at` deixa de ser nulo. A linha em
`public.usuarios` continua nascendo na criação (o cadastro precisa dela
para guardar nome/setor/unidade). O trigger ignora qualquer outro update em
`auth.users` e não abre um segundo chamado numa reconfirmação.

Os 8 usuários existentes já constavam com `email_confirmed_at` preenchido
(o Supabase confirma sozinho quando a opção está desligada), então ninguém
foi afetado — não houve migração de dados.

Config do painel (feita pelo usuário, já que `config.toml` só vale para o
ambiente local): *Authentication > Sign In / Providers > Email >* **Confirm
email** ligado, e o template de *Confirm signup* trocado pelo nosso.

Testado no navegador com as chamadas de auth mockadas: etapa 1 de 3 →
criar conta → etapa 3 mostrando o e-mail certo; código errado mostra erro e
não sai da tela; código certo redireciona; `signUp`, `verifyOtp` e `resend`
recebendo os parâmetros corretos (`type: "signup"` nos dois últimos); botão
de reenviar travado por 1 minuto. Zero erro de JS.

### Limpeza do histórico do cron (2026-09-16)

O usuário notou `cron.job_run_details` com 2 MB no painel e perguntou se
era preocupante. Investigando: 11.366 execuções em 8 dias, **1.440 linhas
por dia** (o job `processar-retornos-pendentes` roda a cada minuto), 184
bytes cada — ~265 KB/dia, **~95 MB/ano**, e a tabela nunca apagava nada.

Não era urgente, mas é a única coisa no banco que cresce sozinha mesmo sem
ninguém usar o sistema: em um ano, o log de um job passaria a ocupar mais
espaço que os 14 mil chamados da migração planejada.

A frequência do job está certa e não foi mexida — ele devolve chamados para
a fila 10 minutos depois, então rodar a cada minuto é o que dá essa
precisão. O que faltava era limpar o log.

Novo job `limpar-historico-do-cron` (03:10 todo dia) apaga as execuções bem
sucedidas com mais de 24h, guardando todas as falhas (hoje: zero em 11 mil).
As 24h de sucessos ficam de propósito: com a tabela vazia não haveria como
distinguir "cron funcionando" de "cron parado".

Resultado imediato: 11.366 → 1.441 linhas, e de 2 MB para **272 kB** depois
do `vacuum full` (sem ele o Postgres marca o espaço como reutilizável mas
não devolve ao disco). Daqui pra frente fica estável nesse patamar.

### Portal carrega só os chamados abertos (2026-09-16)

Preparação para os ~14 mil chamados da migração, motivada pelo egress de
0,45 GB que o usuário viu no painel do Supabase. O Portal baixava **a lista
inteira de chamados** na carga da página e de novo a cada `ressincronizar()`
— que roda toda vez que a aba volta a ficar visível e a cada evento de
tempo real. Com 12 chamados são ~20 KB e ninguém nota; com 14 mil seriam
vários MB por recarga, e os 5 GB/mês de egress do plano ficariam apertados
com uso normal.

Agora a carga inicial e a ressincronização filtram `is("fechamento_em",
null)`. O quadro nunca mostrou chamado fechado (o filtro já existia em
`cardsDaFila`), então visualmente nada muda.

**Os fechados entram sob demanda** (`criarCarregadorDeFechados`): a primeira
abertura da janela "Tickets finalizados" ou da exportação dispara a consulta
e guarda o resultado no mesmo array; as vezes seguintes não repetem. O que é
guardado é a *promessa*, não um booleano — abrir finalizados e exportar quase
ao mesmo tempo espera a mesma consulta em vez de disparar duas. Uma falha de
rede zera o cache para permitir nova tentativa.

**A busca passou a consultar o banco** em vez de filtrar memória: procura os
abertos localmente (resposta instantânea, sem rede) e complementa com um
`ilike` em título/descrição — mais `numero.eq` quando o termo é só dígitos —
restrito aos fechados, com `limit(8)`. Um contador de sequência descarta
respostas que chegam fora de ordem, senão uma consulta lenta sobrescreveria
o resultado de uma digitação mais nova.

**Dois pontos sutis que o teste pegou:**

1. `ressincronizar()` remove da memória tudo que não veio na resposta. Com o
   filtro, "não veio" passou a significar *apagado* **ou** *fechado* — e um
   fechado já carregado sumiria da janela de finalizados. A remoção agora
   ignora quem tem `fechamento_em`.
2. Quando alguém fecha um chamado, o tempo real chama `recarregarChamado(id)`,
   que busca aquele chamado **sem filtro** — então a cópia em memória recebe
   o `fechamento_em` e o quadro o esconde pelo filtro que já existia. Não
   ficou desatualizado.

Testado no navegador com chamados abertos e fechados separados no mock:
carga inicial faz **uma** consulta, só de abertos, e o quadro mostra só eles;
abrir finalizados dispara a segunda consulta e lista os fechados; buscar um
aberto resolve em memória e buscar um fechado vai ao banco; a exportação
conta "2 em aberto, 2 finalizados" reaproveitando o cache, sem nova consulta;
e depois de um `visibilitychange` os finalizados continuam na lista. Zero
erro ou aviso no console.

### Porta da Base: ícone por setor e botão que explica a espera (2026-09-16)

Duas melhorias no cartão da Base de Soluções na home, para quem ainda não
foi aprovado pelo TI (esse usuário já pode abrir chamado, mas não entra na
Base).

**Botão**: continuava escrito "Acessar base" mesmo apagado e sem link — um
botão que não leva a lugar nenhum e não diz por quê. Agora vira **"Aguardando
aprovação"** e a seta some junto. Só o botão da porta muda: o rótulo ficou
dentro de `[data-porta-base-texto]`, então o "Ver tudo" mais abaixo na home
— que usa o mesmo `data-porta-base-link` — segue igual.

**Ícone do selo**: era um monitor fixo para todo mundo. Agora acompanha o
setor de quem está logado, com um mapa de palavra-chave → SVG. A busca é por
trecho, e não pelo nome exato, porque "Vendas" e "Líder de Vendas" são o
mesmo trabalho, e um setor novo ("Vendas Online") já nasce com o ícone certo
sem ninguém editar o mapa. Carrinho para vendas, cifrão para financeiro,
caminhão para logística, caixa para suprimentos, pessoas para RH, documento
para fiscal, gráfico para gestor; sem correspondência fica o monitor.

**Dois bugs que o teste em sequência pegou**, e que não apareceriam testando
um setor de cada vez:

1. "Líder de Logística" não batia com o termo `logistic` — o acento. Resolvido
   normalizando (NFD + remoção de diacríticos) antes de comparar, o que também
   faz um setor digitado sem acento no cadastro achar o mesmo ícone.
2. Como consequência do primeiro: sem correspondência, o código só *não
   trocava* o `innerHTML`, deixando o ícone do setor anterior. O desenho
   original do HTML passou a ser guardado em `dataset.iconePadrao` na primeira
   passada e é restaurado quando nada bate.

Também removido o `<b data-setor-artigos>` do HTML: existia desde o começo
mas nunca foi preenchido por ninguém.

Testado no navegador com 13 combinações (os 11 setores reais do banco, mais
um inventado e o caso pendente): cada setor com o ícone certo, "Setor
Inventado" e "Administrador" caindo no monitor padrão, e o botão trocando de
texto só no estado pendente. Zero erro de JS.

### Base de Soluções: autor pela conta, foto no card e alcance por unidade (2026-09-16)

Três ajustes pedidos durante a manutenção da Base.

**Autor duplicado.** A tabela tinha `autor_id` (uuid, obrigatório, gravado
sozinho no insert) **e** `autor` (texto que se redigitava a cada solução).
A tela usava só o texto — por isso o avatar era sempre genérico: sem o id
não havia como achar a foto, e as iniciais saíam do que fosse digitado.
Agora vale o `autor_id`: a consulta faz junção
(`usuarios!artigos_autor_id_fkey`) e o nome vem do perfil, acompanhando
quem edita os próprios dados. O campo de texto saiu do formulário (virou
leitura, só para conferir com que nome a solução vai sair) e foi zerado no
banco — só uma pessoa havia cadastrado até aqui, e o `autor_id` dela já
estava certo.

**Foto no card**: reaproveita `pintarFoto` de `componentes/avatar.js`, o
mesmo do Portal, que já trata o caso da foto sumida do Storage caindo para
as iniciais. Na edição, o autor mostrado é quem **cadastrou**, não quem está
editando.

**Alcance por unidade.** Antes o acesso era só por setor
(`meu_setor_id() = ANY(setores)`). Agora conta a unidade também, com a regra
**E**: precisa bater nos dois. A coluna nova é `unidades` (array), e não a
`unidade_id` (singular) que já existia sem nunca ter sido usada — um artigo
vale para várias unidades, como já acontecia com setores.

A primeira versão usava "lista vazia = todas as unidades". **Revertido no
mesmo dia** a pedido do usuário: a convenção escondia a regra — olhando a
linha no banco não dava para saber se o artigo valia para todo mundo ou se
alguém esqueceu de preencher. Ver a seção seguinte.

Criada `minha_unidade_id()`, espelhando a `meu_setor_id()` que a policy já
usava.

**O que o teste da policy pegou**: quem não tem unidade no cadastro produzia
`NULL` (de `null = any(...)`), não `false`. Numa policy o efeito prático até
seria o mesmo — NULL não libera —, mas depender disso numa regra de acesso é
frágil demais. Envolvido em `coalesce(..., false)` para dizer "não vê" com
todas as letras.

Testado: 9 casos da expressão de alcance no banco (setor/unidade batendo ou
não, listas vazias, pessoa sem unidade); no navegador, card com foto real
virando `<img>` e autor sem foto caindo nas iniciais, formulário nascendo com
"Todas as unidades", e o insert gravando `unidades: []` com todas marcadas,
`["un2"]` com só Guarulhos, sempre com `autor_id` e sem o campo de texto.

### Unidades explícitas nos artigos + unidade nova entra sozinha (2026-09-16)

Correção da seção anterior, no mesmo dia. O usuário perguntou como uma
unidade criada depois enxergaria as soluções já cadastradas e, ao ver a
resposta, apontou que **a regra estava errada**: "quando tiver todas as
unidades tem que estar selecionado todas as unidades, não uma regra para
vazio = todas".

Concordo com o argumento. A convenção do vazio funcionava, mas era uma
regra invisível: a mesma linha `unidades = '{}'` podia significar "vale para
todos" ou "ninguém preencheu", e só o código sabia a diferença.

Agora a lista guarda **os ids de verdade**, inclusive quando todas estão
marcadas. As 5 soluções existentes foram preenchidas com as 12 unidades, e a
policy perdeu o caso especial do `cardinality = 0`.

Isso reintroduzia exatamente o problema que o usuário havia levantado: uma
unidade cadastrada depois não está em lista nenhuma e nasceria sem enxergar
nada — e ninguém reabriria artigo por artigo para incluí-la. Resolvido com o
trigger `unidades_incluir_nos_artigos` (AFTER INSERT em `unidades`), que
adiciona a unidade nova a **todos** os artigos existentes, inclusive os
restritos. Loja nova nasce enxergando o acervo inteiro; tirar de um artigo
específico continua sendo decisão da tela de edição, que é onde a exceção
deve ser feita.

Testado: 7 casos em tabelas temporárias (artigo "para todas" e artigo
restrito antes e depois da unidade nova, presença do id em cada um, e o
guard contra duplicata). Depois, **em produção**: criada uma unidade de
teste, as 5 soluções passaram de 12 para 13 unidades com a nova incluída em
todas, e a unidade foi removida junto com as referências (12 unidades, 12
por artigo, zero sobras). No navegador, salvar com todas marcadas grava os
ids em vez de `[]`, e a edição de um artigo restrito a uma unidade mostra só
ela marcada. Zero erro de JS.

### Próximas abas (aguardando o usuário mandar o que cada uma mostra)

- O usuário vai enviar as demais abas do relatório Power BI aos poucos;
  cada uma vira uma seção nova dentro da mesma aba "Análise" ou uma aba
  própria, a definir conforme o conteúdo.

## Fase 6 — Automação e integrações

**Status: não iniciada.**
