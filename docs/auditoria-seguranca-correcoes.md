# Auditoria de segurança — plano de correção

> **Para o agente que vai aplicar:** este documento é uma lista de tarefas executáveis,
> ordenada por prioridade. Cada item tem o diagnóstico, o código exato e como verificar.
> Aplique na ordem. Não pule a verificação de cada item antes de passar ao próximo.
>
> **Contexto do projeto:** front-end estático (HTML/CSS/JS puro, sem build step) na Vercel,
> back-end 100% Supabase acessado direto do navegador com a chave `publishable`.
> Não existe camada de API própria: **toda autorização real vive nas policies de RLS**.
> Os guards em `public/js/*-guard.js` são UX, não segurança.
>
> **Estado da auditoria:** o RLS foi verificado contra o banco real (export de
> `pg_policies` + `pg_class.relrowsecurity` de 2026-09-16). As 13 tabelas do schema
> `public` têm RLS **habilitado** e políticas coerentes. A base do modelo de autorização
> está correta. O que resta são lacunas pontuais e governança.
>
> **Regra geral:** nunca "conserte" nada afrouxando uma policy. Se algo parar de
> funcionar depois de uma correção, o bug está na tela, não na policy.

---

## Índice

| # | Severidade | Item | Arquivos |
|---|---|---|---|
| 1 | **Crítica** | Schema não versionado — 12 das 13 tabelas só existem no banco | `supabase/migrations/` |
| 2 | **Crítica** | Cadastro aceita qualquer domínio de e-mail | nova migration + `cadastro.js` |
| 3 | **Alta** | Bucket `artigos` público expõe anexos sem login | nova migration + `nova-solucao.js`, `base.js` |
| 4 | **Alta** | Guards falham abertos quando `getUser()` não retorna usuário | novo `guard.js` + 4 HTMLs |
| 5 | **Alta** | Faltam CSP, HSTS e Permissions-Policy | `vercel.json` |
| 6 | **Alta** | CDNs externos sem Subresource Integrity | `base.html`, `painel.html` |
| 7 | **Média** | `href` de anexo aceita `javascript:` | `base.js` |
| 8 | **Média** | `SECURITY DEFINER` sem `revoke execute` | nova migration |
| 9 | **Média** | Nome de arquivo não sanitizado no path do Storage | `portal.js`, `nova-solucao.js` |
| 10 | **Média** | Tabelas sem policy de DELETE/UPDATE (decidir: intencional ou lacuna) | nova migration |
| 11 | **Baixa** | Migration órfã que nunca aplicou trava `db reset` | `supabase/migrations/` |
| 12 | **Baixa** | `main.js` acumula responsabilidades; lógica de perfil triplicada | `main.js`, `guard.js` |

---

## Correções do relatório anterior

Se você recebeu a versão anterior desta auditoria, dois achados estavam **errados** e
foram corrigidos pelos dados do banco. Não gaste tempo neles:

- ~~"RLS pode estar desabilitado em `chamados`/`usuarios`/`comentarios`"~~ — **falso**.
  Todas as 13 tabelas têm `relrowsecurity = true` e políticas coerentes com o que as
  migrations descrevem. O modelo de autorização está correto.
- ~~"`categorias` tem `with_check (true)` permitindo insert por qualquer autenticado"~~ —
  **já corrigido no banco**. A policy real hoje é
  `categorias: escrita equipe TI, ALL, is_equipe_ti()`. A policy frouxa
  `categorias_insercao` de `20260911_artigos_solucoes.sql` nunca chegou a existir em
  produção (aquela migration inteira falhou ao aplicar — ver item 11).

O que **permanece** verdadeiro do diagnóstico original é o item 1: as policies corretas
que estão no ar não estão versionadas, então nada impede que se percam.

---

## 1. [CRÍTICA] Versionar o schema que está em produção

### Diagnóstico

As migrations contêm **um único `create table`** (`textos_rapidos`). As outras 12 tabelas
(`chamados`, `usuarios`, `comentarios`, `anexos`, `chamado_membros`, `artigos`,
`artigo_feedback`, `chamado_retorno_pendente`, `filas`, `setores`, `unidades`,
`categorias`) foram criadas pelo Studio. As migrations existentes fazem `alter table` e
`drop policy if exists` sobre objetos que nunca foram declarados no repositório.

O RLS está correto **hoje**. O problema é que essa configuração correta não está no Git:

- `supabase db reset` produz um banco quebrado — as migrations falham em
  `alter table public.chamados`, que não existe num banco limpo.
- Não há como revisar mudança de policy em pull request.
- Não existe ambiente de staging reproduzível.
- Já houve um incidente por causa disso: a migration
  `20260914150000_conserta_artigos_solucoes.sql` documenta ter encontrado uma policy
  `"artigos: leitura autenticada"` criada no Studio sem arquivo correspondente que, por
  combinar com `OR`, **anulava silenciosamente toda a regra de visibilidade por setor**.
  O mesmo pode acontecer com `chamados` e ninguém perceberia.

Isto é crítico não por uma falha ativa, mas porque é **a condição que permite que
qualquer uma das outras falhas volte sem aviso**.

### Aplicar

```bash
# 1. Baseline do schema real. Gera uma migration com tudo que está no banco.
supabase db pull --schema public,storage

# 2. Confirme que o arquivo gerado contém os CREATE TABLE das 12 tabelas
#    e os ALTER TABLE ... ENABLE ROW LEVEL SECURITY correspondentes.
#    O arquivo nasce com timestamp atual; ele precisa ordenar ANTES das
#    migrations existentes que fazem alter table. Renomeie para um timestamp
#    anterior ao da migration mais antiga (20260910125000):
mv supabase/migrations/<timestamp_gerado>_remote_schema.sql \
   supabase/migrations/20260901000000_baseline_schema.sql
```

Depois do baseline, **resolva o item 11** (migration órfã) e valide a cadeia inteira:

```bash
supabase db reset   # deve completar sem erro, do zero até a última migration
```

### Verificar

```bash
# A cadeia aplica limpa?
supabase db reset

# O baseline cobre todas as tabelas?
grep -c "create table" supabase/migrations/20260901000000_baseline_schema.sql   # esperado: >= 13
grep -c "enable row level security" supabase/migrations/20260901000000_baseline_schema.sql
```

Depois disso, **toda** mudança de schema ou policy passa a ser feita por
`supabase migration new <nome>` + `supabase db push`. Nada mais pelo Studio.

### Guarda permanente

Rode esta query periodicamente (ou em CI). Qualquer linha retornada é uma tabela
desprotegida:

```sql
select c.relname as tabela_sem_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
```

**Referência:** CWE-1188; OWASP A05:2021

---

## 2. [CRÍTICA] Restringir cadastro ao domínio corporativo

### Diagnóstico

`public/js/pages/cadastro.js:156` valida apenas o formato do e-mail
(`/^\S+@\S+\.\S+$/`). Não há restrição de domínio em lugar nenhum: nem no front, nem em
`handle_new_user()`, nem em policy.

Qualquer pessoa na internet cria conta com um Gmail, recebe o código de 6 dígitos na
própria caixa, confirma, e vira usuário autenticado com `status_aprovacao = 'pendente'`.

A migration `20260914210000_acesso_sem_aprovacao_previa.sql` decidiu deliberadamente que
cadastro pendente **já pode abrir e ver chamados** ("é o próprio canal para pedir ajuda").
A decisão é defensável para um colaborador interno. Combinada com cadastro aberto, ela
significa que um estranho consegue inserir linhas em `chamados` e `comentarios` do sistema
interno e receber respostas da equipe de TI ali dentro.

A Base de Soluções está protegida — `artigos_leitura` exige `is_aprovado()` — então o dado
sensível não vaza. O risco é injeção de conteúdo no fluxo de trabalho da equipe, spam e
phishing dirigido ao TI.

Também confirmado pelo export: **não existe policy de INSERT em `usuarios`**. A linha só
é criada pelo trigger `handle_new_user()` (`security definer`), que é o desenho correto —
mas o trigger não filtra domínio.

### Aplicar

```bash
supabase migration new restringe_dominio_corporativo
```

```sql
-- supabase/migrations/<timestamp>_restringe_dominio_corporativo.sql
--
-- Cadastro passa a aceitar só e-mail corporativo. A trava fica em auth.users
-- (e não só no regex da tela) porque o signUp é chamado direto do navegador:
-- validação de front não vale nada contra uma chamada pela API.

create or replace function public.bloquear_dominio_externo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.email !~* '@madeirasgasometro\.com\.br$' then
    raise exception 'Cadastro permitido apenas com e-mail corporativo.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists auth_users_dominio_corporativo on auth.users;

create trigger auth_users_dominio_corporativo
before insert on auth.users
for each row execute function public.bloquear_dominio_externo();
```

> **Antes de aplicar:** confirme que nenhuma conta legítima usa outro domínio.
> ```sql
> select email from auth.users where email !~* '@madeirasgasometro\.com\.br$';
> ```
> Se houver contas de parceiro/terceirizado que devem continuar, troque a condição por
> uma allowlist (`new.email !~* '@(madeirasgasometro\.com\.br|outrodominio\.com)$'`)
> ou uma tabela `dominios_permitidos`.

Alinhe o front para o erro aparecer antes do envio — **isto é conforto de digitação, não
a trava**:

```js
// public/js/pages/cadastro.js — substituir a validação de e-mail em validarEtapa2()
const EMAIL_CORPORATIVO = /^[\w.+-]+@madeirasgasometro\.com\.br$/i;

if (!EMAIL_CORPORATIVO.test(campoEmail.value.trim())) {
  mostrarErro(erroEtapa2, "Use seu e-mail corporativo (@madeirasgasometro.com.br).");
  return false;
}
```

### Verificar

```sql
-- Deve falhar com 42501:
insert into auth.users (id, email) values (gen_random_uuid(), 'teste@gmail.com');
```

E pela tela: tentar cadastro com Gmail deve ser recusado.

**Referência:** CWE-284; OWASP A01:2021

---

## 3. [ALTA] Tornar o bucket `artigos` privado

### Diagnóstico

Este é o descompasso mais sério entre tabela e Storage no projeto.

A tabela `artigos` tem uma policy de leitura sofisticada, refinada ao longo de cinco
migrations. Confirmada no banco:

```
artigos_leitura, SELECT:
  ativo AND is_aprovado() AND (
    pode_escrever_artigo() OR auth.uid() = autor_id
    OR (meu_setor_id() = ANY(setores) AND COALESCE(minha_unidade_id() = ANY(unidades), false))
  )
```

Mas os **arquivos** desses artigos estão num bucket com `public = true`, e a policy de
leitura no banco é `artigos_arquivos_leitura, SELECT, (bucket_id = 'artigos')` —
**sem `to authenticated`, sem nenhuma condição**. `nova-solucao.js:739` serve as URLs por
`getPublicUrl()`.

Resultado: toda a regra de setor+unidade vale para o texto e é contornada pelas imagens.
Prints de ERP costumam conter exatamente o que a regra pretende proteger — nomes de
clientes, valores, estrutura de tabelas.

O `<artigo_id>` é UUID, então não há força bruta. Mas a URL vaza para qualquer autenticado
que leia o artigo e **continua funcionando para sempre**: em janela anônima, compartilhada
por WhatsApp, indexada se alguém a colar em qualquer lugar. Um contribuinte que sai da
empresa mantém acesso permanente a todo anexo cuja URL tenha guardado.

Compare com o bucket `anexos`, que está **correto**: privado, policies amarrando o arquivo
ao chamado via `split_part(name, '/', 1)`, URLs assinadas de 60s. É o padrão a seguir.

### Aplicar

```bash
supabase migration new artigos_bucket_privado
```

```sql
-- supabase/migrations/<timestamp>_artigos_bucket_privado.sql
--
-- O bucket dos anexos de artigo era publico: qualquer um com a URL abria o
-- arquivo sem login, furando a regra de setor+unidade da tabela. Passa a
-- privado, com URL assinada — mesmo desenho do bucket "anexos".

update storage.buckets set public = false where id = 'artigos';

-- Leitura amarrada a quem pode ler o artigo dono do arquivo. O caminho e
-- "<artigo_id>/<nome>", entao o primeiro segmento identifica o artigo.
-- O select em public.artigos passa pela policy artigos_leitura: se a pessoa
-- nao pode ver o artigo, o exists da falso e o arquivo nao abre.
drop policy if exists artigos_arquivos_leitura on storage.objects;

create policy artigos_arquivos_leitura on storage.objects
  for select to authenticated
  using (
    bucket_id = 'artigos'
    and exists (
      select 1 from public.artigos a
      where a.id::text = split_part(name, '/', 1)
    )
  );
```

> As policies de INSERT/UPDATE/DELETE do bucket já estão corretas
> (`bucket_id = 'artigos' AND is_equipe_ti()`) — não mexa nelas.

No front, trocar `getPublicUrl` por `createSignedUrl`:

```js
// public/js/pages/nova-solucao.js — em enviarArquivo(), substituir o getPublicUrl.
// Guarde o CAMINHO no JSONB, não a URL: URL assinada expira, caminho não.
async function enviarArquivo(artigoId, nomeArquivo, arquivo) {
  const caminho = `${artigoId}/${nomeSeguro(nomeArquivo)}`;   // nomeSeguro: ver item 9
  const { error } = await supabase.storage.from(BUCKET).upload(caminho, arquivo);

  if (error) throw error;

  return caminho;
}
```

Em `base.js`, resolver os caminhos para URLs assinadas antes de renderizar. Reaproveite o
padrão de cache que `portal.js:1930-1960` já usa:

```js
// public/js/pages/base.js
const VALIDADE_URL = 60 * 60; // 1h
const urlsAssinadas = new Map(); // caminho -> { url, expiraEm }

async function assinar(caminhos) {
  const agora = Date.now();
  const faltam = caminhos.filter((c) => {
    const cache = urlsAssinadas.get(c);
    return !cache || cache.expiraEm < agora;
  });

  if (faltam.length) {
    const { data, error } = await supabase.storage
      .from("artigos").createSignedUrls(faltam, VALIDADE_URL);

    if (error) console.warn("Não foi possível assinar anexos:", error);

    const expiraEm = agora + VALIDADE_URL * 1000;
    (data ?? []).forEach((item) => {
      if (item.signedUrl) urlsAssinadas.set(item.path, { url: item.signedUrl, expiraEm });
    });
  }

  return caminhos.map((c) => urlsAssinadas.get(c)?.url ?? "#");
}
```

`abrirPainel()` precisa virar `async` e assinar os caminhos de `artigo.anexos` e das
imagens de `artigo.passos` antes de montar o HTML.

> **Migração dos dados existentes:** os artigos já cadastrados têm URL pública completa
> gravada no JSONB `anexos`/`passos`, não o caminho. Ou você extrai o caminho no
> carregamento (`url.split('/artigos/')[1]`), ou roda um UPDATE convertendo o JSONB.
> Com 5 artigos cadastrados, o UPDATE é mais limpo.

### Verificar

```bash
# Em janela anônima, sem login — deve devolver 400/403, não o arquivo:
curl -I "https://pmwcfdxryjwsvwsmcufm.supabase.co/storage/v1/object/public/artigos/<id>/<arquivo>"
```

E pela tela: um artigo com imagem no passo a passo deve continuar renderizando para quem
tem permissão, logado.

**Referência:** CWE-668; [Supabase — Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control)

---

## 4. [ALTA] Guards com fail-closed e centralizados

### Diagnóstico

Os quatro guards (`acesso-guard.js:26`, `painel-guard.js:28`, `portal-guard.js:31`,
`solucao-guard.js:29`) têm a mesma estrutura:

```js
const { data: { user } } = await supabase.auth.getUser();

if (user) {
  // consulta perfil, decide, revela ou redireciona
}
// <- sem else: se user for null, NADA acontece
```

Se `getUser()` devolver `user` nulo — rede instável, token expirado no instante da carga,
500 do Supabase — nenhum ramo executa: não redireciona e não revela. A página fica num
limbo com `visibility: hidden`, e o script da página já carregou (é `type="module"`,
carrega em paralelo).

O impacto é limitado: `visibility: hidden` esconde visualmente e o RLS ainda barra os
dados. Mas é **controle de acesso dependendo de uma propriedade CSS**, replicado em quatro
arquivos. Um `document.body.style.visibility='visible'` no console revela a interface.

Há também triplicação da lógica de perfil: nos guards, em `main.js:352-360`
(`equipeTi`/`escreveArtigo`) e nas funções SQL (`is_equipe_ti`, `pode_escrever_artigo`,
`is_admin`). Três lugares para esquecer quando um perfil novo surgir.

### Aplicar

Criar `public/js/guard.js`:

```js
// GUARDA DE PAGINA — fonte unica das regras de perfil no front.
//
// Espelha as funcoes do banco (is_aprovado, pode_escrever_artigo, is_equipe_ti,
// is_admin). Isto e UX: a protecao real dos dados esta nas policies de RLS.
// Mudou uma regra aqui? A policy correspondente tem que mudar junto.
import { supabase } from "./config/supabase-config.js";

export const REGRAS = {
  // is_aprovado()
  aprovado: (p) => p.status_aprovacao === "aprovado" && p.ativo,
  // pode_escrever_artigo()
  artigo: (p) => ["contribuinte", "analista", "admin"].includes(p.perfil)
    && p.status_aprovacao === "aprovado" && p.ativo,
  // is_equipe_ti()
  atende: (p) => ["analista", "admin"].includes(p.perfil)
    && p.status_aprovacao === "aprovado" && p.ativo,
  // is_admin()
  admin: (p) => p.perfil === "admin"
    && p.status_aprovacao === "aprovado" && p.ativo,
};

export async function exigir(regra, destinoSeNegado = "index.html") {
  document.body.style.visibility = "hidden";

  const { data: { user }, error: erroUser } = await supabase.auth.getUser();

  // FAIL-CLOSED: sem usuario confirmado, ninguem entra. O caso `user == null`
  // sem erro (rede caida, token expirado na hora da carga) cai aqui tambem.
  if (erroUser || !user) {
    window.location.replace("login.html");
    return null;
  }

  const { data: perfil, error } = await supabase
    .from("usuarios")
    .select("perfil, ativo, status_aprovacao")
    .eq("id", user.id)
    .single();

  if (error || !perfil || !REGRAS[regra](perfil)) {
    window.location.replace(destinoSeNegado);
    return null;
  }

  document.body.style.visibility = "visible";

  return perfil;
}
```

Nos HTMLs, substituir o par de guards por um único script. Exemplo em `painel.html`:

```html
<!-- antes:
  <script type="module" src="js/auth-guard.js"></script>
  <script type="module" src="js/painel-guard.js"></script>
-->
<script type="module">
  import { exigir } from "./js/guard.js";
  await exigir("admin");
</script>
<script type="module" src="js/main.js"></script>
<script type="module" src="js/pages/painel.js"></script>
```

Mapeamento página → regra:

| Página | Regra | Destino se negado |
|---|---|---|
| `painel.html` | `admin` | `index.html` |
| `portal.html` | `atende` | `index.html` |
| `nova-solucao.html` | `artigo` | `base.html` |
| `base.html` | `aprovado` | `index.html` |
| `index.html`, `perfil.html`, `abrir-chamado.html`, `solicitacoes.html`, `dashboard.html`, `triagem.html` | apenas sessão | `login.html` |

Para as páginas que só precisam de sessão, mantenha `auth-guard.js` — mas corrija-o também:

```js
// public/js/auth-guard.js
import { supabase } from "./config/supabase-config.js";

const { data: { session }, error } = await supabase.auth.getSession();

// FAIL-CLOSED: erro ou ausencia de sessao levam ao login.
if (error || !session) {
  window.location.replace("login.html");
} else {
  document.body.style.visibility = "visible";
}

supabase.auth.onAuthStateChange((_evento, novaSessao) => {
  if (!novaSessao) window.location.replace("login.html");
});
```

Depois apagar `acesso-guard.js`, `painel-guard.js`, `portal-guard.js`, `solucao-guard.js`.

> `dashboard.html` e `triagem.html` hoje só têm `auth-guard` e seus scripts são stubs
> vazios (`// Lógica ... — Fase 2/4`). Quando forem implementados, decida a regra: o
> dashboard operacional provavelmente é `atende`.

Em `main.js`, importar `REGRAS` em vez de reimplementar:

```js
import { REGRAS } from "./guard.js";
// ...
const dados = {
  // ...
  aprovado: REGRAS.aprovado(perfil ?? {}),
  equipeTi: REGRAS.atende(perfil ?? {}),
  escreveArtigo: REGRAS.artigo(perfil ?? {}),
};
```

### Verificar

DevTools → Network → bloquear a rota `**/auth/v1/user` → abrir `painel.html`.
Deve redirecionar para `login.html`, não ficar em branco.

**Referência:** CWE-636; OWASP A01:2021

---

## 5. [ALTA] Headers de segurança no `vercel.json`

### Diagnóstico

O `vercel.json` já define três headers corretos: `X-Content-Type-Options: nosniff`,
`X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`.

Faltam:

- **`Content-Security-Policy`** — ausente. É a defesa que mais importa aqui, porque o
  supabase-js guarda o token de sessão em `localStorage`: um único XSS rouba a sessão
  inteira. O código está limpo hoje (o escaping em `base.js` e o `textContent` em
  `portal.js` são consistentes), mas CSP é o que protege contra o XSS de amanhã.
- **`Strict-Transport-Security`** — a Vercel força HTTPS por redirect, mas sem HSTS a
  primeira requisição de cada visitante ainda é interceptável.
- **`Permissions-Policy`** — nada usa câmera/microfone/geolocalização.

### Aplicar

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "SAMEORIGIN" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        { "key": "Content-Security-Policy-Report-Only", "value": "default-src 'self'; script-src 'self' https://esm.sh https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src 'self' data: blob: https://pmwcfdxryjwsvwsmcufm.supabase.co; connect-src 'self' https://pmwcfdxryjwsvwsmcufm.supabase.co wss://pmwcfdxryjwsvwsmcufm.supabase.co https://esm.sh; frame-ancestors 'self'; base-uri 'self'; object-src 'none'" }
      ]
    }
  ]
}
```

> **Comece com `-Report-Only`.** Abra todas as páginas, use o sistema normalmente e
> colete as violações no console. Só troque para `Content-Security-Policy` (sem
> `-Report-Only`) quando o console estiver limpo.

Duas coisas vão violar de imediato e precisam ser resolvidas antes de ativar:

1. **`<script>` inline** em `base.html:13`, `nova-solucao.html:11`, `portal.html:13`,
   `painel.html:24` (script de tema). Mova para um arquivo `js/tema.js`. O tema precisa
   rodar antes da pintura para não piscar — um arquivo externo com `<script src>` no
   `<head>` resolve, já que é síncrono.
2. **`onerror="this.hidden=true"`** em `index.html` (7 ocorrências, fotos da equipe).
   Troque por listener:
   ```js
   // em index.js
   document.querySelectorAll(".equipe img").forEach((img) => {
     img.addEventListener("error", () => { img.hidden = true; });
   });
   ```

`style-src` mantém `'unsafe-inline'` porque o código usa `element.style.setProperty` e
atributos `style=` — remover exigiria refatoração ampla e o ganho é pequeno comparado a
travar `script-src`.

### Verificar

```bash
curl -sI https://<seu-dominio>/painel | grep -i "content-security\|strict-transport\|permissions-policy"
```

**Referência:** CWE-693; OWASP A05:2021

---

## 6. [ALTA] Subresource Integrity nos CDNs

### Diagnóstico

Três bibliotecas são carregadas do cdnjs sem verificação de integridade, em páginas
autenticadas:

- `public/base.html:12` — jsPDF 2.5.1
- `public/painel.html:16` — Chart.js 4.5.1
- `public/painel.html:22` — html2canvas 1.4.1
- `public/painel.html:23` — jsPDF 2.5.1

Um comprometimento do cdnjs executa código arbitrário com acesso ao `localStorage`, onde
está o token de sessão do Supabase.

### Aplicar

Gere os hashes:

```bash
for url in \
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js" \
  "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.1/chart.umd.min.js" \
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"
do
  echo "$url"
  curl -s "$url" | openssl dgst -sha384 -binary | openssl base64 -A
  echo; echo
done
```

Aplique em cada tag:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
        integrity="sha384-<hash>"
        crossorigin="anonymous"
        referrerpolicy="no-referrer"></script>
```

> **Alternativa mais robusta:** baixe os três arquivos para `public/js/vendor/` e sirva
> do próprio domínio. Elimina a dependência do cdnjs, simplifica a CSP
> (`script-src 'self'` apenas) e o projeto não tem build step que dificulte isso.
> Recomendo esta opção.

O `esm.sh` (supabase-js) não aceita SRI por ser redirecionador com conteúdo versionado
dinamicamente. Pin ao menos a versão exata:
`https://esm.sh/@supabase/supabase-js@2.45.4` em vez de `@2`.

### Verificar

Altere um byte do hash e recarregue: o navegador deve recusar o script com erro de
integridade no console.

**Referência:** CWE-1104; OWASP A08:2021

---

## 7. [MÉDIA] Validar esquema de URL em `href` de anexo

### Diagnóstico

`public/js/pages/base.js:436`, em `renderizarAnexos()`:

```js
`<li><a href="${escapar(anexo.url)}" target="_blank" rel="noopener">${escapar(anexo.nome)}</a></li>`
```

`escapar()` neutraliza `<`, `>`, `&` e aspas — correto para conteúdo de texto, e o resto
do arquivo o usa bem. Mas num atributo `href`, escapar **não impede** o esquema
`javascript:`, que não contém nenhum caractere escapável.

`anexo.url` vem do JSONB `artigos.anexos`, gravável por quem tem
`pode_escrever_artigo()` (contribuinte, analista, admin). É MÉDIA porque exige usuário já
privilegiado e um clique da vítima — mas o alvo é quem lê a Base, potencialmente um admin.

### Aplicar

```js
// public/js/pages/base.js — junto de escapar()
//
// escapar() nao cobre href: "javascript:..." nao tem caractere escapavel.
// So http/https passam; qualquer outro esquema vira "#".
function urlSegura(url) {
  try {
    const u = new URL(url, window.location.origin);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "#";
  } catch {
    return "#";
  }
}
```

```js
// em renderizarAnexos()
.map((anexo) => `<li><a href="${escapar(urlSegura(anexo.url))}" target="_blank" rel="noopener noreferrer">${escapar(anexo.nome)}</a></li>`)
```

> Se você aplicou o item 3, `anexo.url` passa a ser caminho assinado gerado pelo próprio
> código — o risco some na origem. Mantenha `urlSegura()` mesmo assim, como defesa em
> profundidade para dados legados no JSONB.

Aproveite e acrescente `noreferrer` ao `rel` (hoje só tem `noopener`).

### Verificar

```sql
-- Num artigo de teste, gravar um anexo com esquema javascript:
update artigos set anexos = '[{"nome":"teste.pdf","url":"javascript:alert(1)"}]'::jsonb
where id = '<id-de-teste>';
```
Abrir o artigo e clicar: nada deve acontecer (href vira `#`).

**Referência:** CWE-79 (variante `javascript:` URI); OWASP A03:2021

---

## 8. [MÉDIA] `revoke execute` nas funções `SECURITY DEFINER`

### Diagnóstico

O uso de `SECURITY DEFINER` no projeto é, no geral, **correto e bem justificado**. As
funções helper (`is_equipe_ti`, `is_admin`, `meu_setor_id`, `minha_unidade_id`,
`pode_escrever_artigo`, `is_aprovado`) são `stable`, sem parâmetros, com `search_path`
fixo, e existem precisamente para quebrar recursão de RLS. Isso está certo e não deve
mudar.

Dois pontos merecem `revoke`:

1. **`reabrir_chamado(uuid)`** — faz a checagem de autorização internamente
   (`v_eh_dono or is_equipe_ti()`), e faz bem. Mas é `execute` para `public` por padrão e
   ignora o RLS de `chamados`/`comentarios` ao escrever. A defesa depende inteiramente
   daquele `if`. Está correto hoje; é um ponto único de falha sem rede de proteção.
2. **`limpar_historico_do_cron()`** — `security definer`, deleta de
   `cron.job_run_details`, executável por qualquer autenticado. Um usuário comum pode
   apagar trilha de auditoria do cron.

### Aplicar

```bash
supabase migration new restringe_execucao_funcoes
```

```sql
-- supabase/migrations/<timestamp>_restringe_execucao_funcoes.sql
--
-- Funcao security definer ignora RLS por definicao. Quem pode CHAMA-LA precisa
-- ser tao explicito quanto uma policy — o default do Postgres (execute para
-- public) e generoso demais para funcoes que escrevem.

-- Manutencao do cron: so o proprio job (postgres). Ninguem pela API.
revoke execute on function public.limpar_historico_do_cron() from public, anon, authenticated;

-- Reabrir chamado: so autenticado. A funcao ja confere dono/equipe por dentro;
-- isto e a segunda tranca.
revoke execute on function public.reabrir_chamado(uuid) from public, anon;
grant execute on function public.reabrir_chamado(uuid) to authenticated;

-- Helpers de policy: precisam ser chamaveis pelo avaliador de RLS, mas nao
-- ha razao para o cliente anonimo invoca-las direto.
revoke execute on function public.is_equipe_ti() from anon;
revoke execute on function public.is_admin() from anon;
revoke execute on function public.is_aprovado() from anon;
revoke execute on function public.pode_escrever_artigo() from anon;
revoke execute on function public.meu_setor_id() from anon;
revoke execute on function public.minha_unidade_id() from anon;
```

> **Cuidado:** as policies de `setores` e `unidades` incluem leitura anônima
> (`to anon, using (ativo = true)`) para a tela de cadastro. Essas policies **não** usam
> as funções helper, então o revoke acima não as quebra. Confirme depois de aplicar que
> `cadastro.html` ainda lista setores e unidades sem sessão.

Adote como convenção: toda nova função `security definer` nasce com `revoke execute ...
from public` e um `grant` explícito.

### Verificar

```js
// No console, logado como solicitante comum — deve falhar com permission denied:
await supabase.rpc('limpar_historico_do_cron')
```

E abrir `cadastro.html` sem sessão: os selects de setor e unidade devem continuar
preenchidos.

**Referência:** CWE-266; [Supabase — Function Security](https://supabase.com/docs/guides/database/functions)

---

## 9. [MÉDIA] Sanitizar nome de arquivo no path do Storage

### Diagnóstico

`public/js/pages/portal.js:2186`:
```js
const caminho = `${chamado.id}/${inicio}-${indice + 1}-${arquivo.name}`;
```
`public/js/pages/nova-solucao.js:734`:
```js
const caminho = `${artigoId}/${nomeArquivo}`;
```

`arquivo.name` entra no path sem normalização.

**O que NÃO é problema:** a policy do bucket `anexos` amarra a permissão via
`split_part(name, '/', 1)` — o primeiro segmento continua sendo o `chamado_id` mesmo se o
nome contiver `/`, então a policy **não é contornável**. E os paths não são sequenciais
(UUID + timestamp), então não há como adivinhar o anexo de outro chamado. Esse desenho
está bom.

**O que é problema:** nomes com caracteres de controle, Unicode exótico ou muito longos
quebram listagem, download e a geração de URL assinada. É robustez, não autorização.

### Aplicar

Adicione o helper em ambos os arquivos (ou num `js/util.js` compartilhado):

```js
// Nome de arquivo vai para o path do Storage: normaliza acento, troca o que
// nao for [A-Za-z0-9._-] por "_" e limita o tamanho. O nome original fica na
// coluna nome_arquivo, que e o que a tela mostra.
function nomeSeguro(nome) {
  return (nome || "arquivo")
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(-80) || "arquivo";
}
```

```js
// portal.js
const caminho = `${chamado.id}/${inicio}-${indice + 1}-${nomeSeguro(arquivo.name)}`;

// nova-solucao.js
const caminho = `${artigoId}/${nomeSeguro(nomeArquivo)}`;
```

O nome original já é preservado em `anexos.nome_arquivo` e renderizado com `textContent`
(`portal.js:2000`, `portal.js:2067`) — nada muda para o usuário.

### Verificar

Anexar um arquivo chamado `relatório final (v2)/../teste.pdf` e confirmar que o upload
funciona, o path fica normalizado e o nome exibido continua o original.

**Referência:** CWE-22 (variante limitada)

---

## 10. [MÉDIA] Decidir sobre as lacunas de DELETE e UPDATE

### Diagnóstico

Cruzando as policies reais com o que o front faz, estas operações estão **bloqueadas por
ausência de policy** (RLS é fail-closed: sem policy para um comando, ninguém executa):

| Tabela | Faltando | Consequência |
|---|---|---|
| `chamados` | DELETE | Ninguém apaga chamado. **Provavelmente intencional** — chamado é registro histórico, o fluxo usa `fechamento_em`. |
| `comentarios` | UPDATE, DELETE | Ninguém edita nem apaga mensagem. **Provavelmente intencional** — conversa de chamado é trilha de auditoria. |
| `anexos` | UPDATE, DELETE | Ninguém remove anexo da tabela, mesmo a equipe. ⚠️ **Inconsistente**: a policy do Storage `anexos: equipe TI apaga` permite apagar o *arquivo*, mas a linha em `anexos` fica órfã. |
| `artigo_feedback` | UPDATE, DELETE | Ninguém troca ou remove o próprio voto. Decidir se é desejado. |
| `chamado_retorno_pendente` | INSERT, UPDATE, DELETE | Só o cron (`security definer`) mexe. **Correto.** |
| `usuarios` | INSERT, DELETE | Criação é só pelo trigger `handle_new_user()`; exclusão não existe. **Correto** — o fluxo usa `ativo = false`. |

O único caso claramente inconsistente é **`anexos`**: a equipe de TI consegue apagar o
arquivo no Storage mas não a linha na tabela, o que deixa referência apontando para
arquivo inexistente.

### Aplicar

Se confirmar que a equipe de TI deve poder remover anexo:

```bash
supabase migration new anexos_equipe_ti_remove
```

```sql
-- supabase/migrations/<timestamp>_anexos_equipe_ti_remove.sql
--
-- A policy do bucket ja deixa a equipe apagar o ARQUIVO ("anexos: equipe TI
-- apaga"), mas nao havia policy para apagar a LINHA — o registro ficava
-- apontando para um arquivo que nao existe mais.

create policy "anexos: equipe TI remove"
  on public.anexos for delete
  to authenticated
  using (is_equipe_ti());
```

**Não crie** policies de DELETE/UPDATE para `chamados` e `comentarios` sem uma decisão
explícita de produto. A ausência delas é provavelmente uma escolha correta (trilha de
auditoria imutável) e afrouxar isso seria uma regressão de segurança.

Independente da decisão, **documente**. Acrescente ao topo do baseline do item 1:

```sql
-- LACUNAS INTENCIONAIS DE POLICY (RLS e fail-closed: sem policy, ninguem executa)
--
--   chamados      sem DELETE  -> chamado nao se apaga; fecha com fechamento_em
--   comentarios   sem UPDATE  -> mensagem enviada nao se edita (trilha de auditoria)
--   comentarios   sem DELETE  -> idem
--   usuarios      sem DELETE  -> conta nao se apaga; desativa com ativo = false
--   usuarios      sem INSERT  -> linha nasce so pelo trigger handle_new_user()
--
-- Se alguma tela precisar de uma dessas operacoes, a policy entra por migration
-- com a condicao mais estreita possivel — nunca afrouxando uma existente.
```

### Verificar

```js
// Logado como analista, no console — deve falhar:
await supabase.from('chamados').delete().eq('id', '<id>')
```

---

## 11. [BAIXA] Remover a migration órfã que trava `db reset`

### Diagnóstico

`supabase/migrations/20260911_artigos_solucoes.sql` tem três problemas:

1. **Nunca aplicou.** Falha com `42P17` ("generation expression is not immutable"),
   documentado em detalhe no cabeçalho de `20260914150000_conserta_artigos_solucoes.sql`.
2. **Nome fora do padrão** `YYYYMMDDHHMMSS` — só tem a data. O CLI ordena por string,
   então ela cai antes de `20260911164601`, o que pode não ser a ordem pretendida.
3. **Foi integralmente substituída** por `20260914150000`, que recria tudo de forma
   idempotente.

Enquanto ela estiver no diretório, `supabase db reset` falha nela e trava a cadeia — o
que bloqueia o item 1.

### Aplicar

```bash
git rm "supabase/migrations/20260911_artigos_solucoes.sql"
```

A migration `20260914150000_conserta_artigos_solucoes.sql` já contém tudo que ela tentava
fazer, com a correção do `42P17` (trigger em vez de coluna gerada). Nada se perde.

> Se preferir manter o histórico, renomeie para
> `20260911000000_artigos_solucoes.sql.skip` — o CLI ignora arquivos que não terminam
> em `.sql`. Mas remover é mais limpo, e o Git preserva o histórico de qualquer forma.

Adote `supabase migration new <nome>` daqui em diante, que gera o timestamp correto.

### Verificar

```bash
supabase db reset   # deve completar sem erro
ls supabase/migrations/ | grep -v "^[0-9]\{14\}_" | grep "\.sql$"   # deve sair vazio
```

---

## 12. [BAIXA] Modularizar `main.js`

### Diagnóstico

`public/js/main.js` tem 425 linhas misturando: animação de entrada, cache do topo em
`localStorage`, mapa de ícones por setor, menu de perfil, logout, botão de copiar e-mail e
colapso da sidebar.

Não é vulnerabilidade — os comentários deixam explícito e correto que "esconder link no
menu não é controle de acesso". É dívida de manutenção, e o item 4 já resolve a parte que
mais importa (a duplicação da lógica de perfil).

### Aplicar

Depois do item 4, extrair:

- **`js/topo.js`** — cache em `localStorage`, `aplicarTopo()`, `preencherUsuario()`,
  avatar do topo, ícones por setor (linhas ~60-240).
- **`js/ui.js`** — animação de entrada, menu de perfil, sidebar, copiar e-mail
  (linhas ~10-40 e ~280-425).
- **`js/main.js`** — passa a só importar os dois e o `guard.js`.

Baixa prioridade. Faça só depois que os itens 1 a 6 estiverem fechados.

---

## Itens verificados e corretos — não mexer

Confirmados no código e no export de policies do banco:

- **RLS habilitado nas 13 tabelas** do schema `public`, com políticas coerentes. ✅
- **`chamados`** — solicitante vê só os próprios (`solicitante_id = auth.uid()`), equipe
  de TI vê todos, insert amarrado ao próprio uid, update só da equipe. Correto. ✅
- **`comentarios`** — solicitante vê só os **públicos** dos próprios chamados; notas
  internas (`visibilidade <> 'publico'`) ficam invisíveis para ele. Correto e sutil. ✅
- **`usuarios`** — três policies de SELECT bem escopadas: próprio perfil, equipe de TI, e
  a de `20260915120000` que libera só quem respondeu um chamado seu. Sem vazamento de
  lista de usuários. ✅
- **`artigos`** — regra de setor+unidade com `COALESCE(..., false)` tratando o caso
  `null = ANY(...)`. Refinada ao longo de cinco migrations. Correta. ✅
- **Escalação de privilégio fechada** — trigger `protege_perfil_usuario()` compara
  `OLD`/`NEW` e impede tanto auto-promoção a admin quanto auto-aprovação de cadastro. ✅
- **`service_role`** — não aparece em nenhum arquivo sob `public/`. Isolada na Edge
  Function via `Deno.env.get`. ✅
- **Edge Function `criar-usuario`** — exemplar: valida JWT com client anon, confere
  `perfil === 'admin' && status_aprovacao === 'aprovado' && ativo` antes de tocar na
  `service_role`, valida entrada contra allowlists, trata o caso parcial com HTTP 207. ✅
- **XSS** — `base.js` tem `escapar()` aplicado consistentemente; `portal.js` usa
  `textContent` para todo texto de comentário, título e nome; `nova-solucao.js` usa
  `textContent` inclusive para nome de arquivo. Os `innerHTML` restantes recebem SVG
  estático de constantes do próprio código. ✅
- **XSS refletido** — `?id=`, `?tipo=`, `?chamado=`, `?aba=` são usados como filtro de
  `.eq()` ou comparação, nunca inseridos no DOM. ✅
- **Bucket `anexos`** — privado, policies amarrando arquivo ao chamado, URLs assinadas de
  60s a 1h. É o padrão de referência do projeto. ✅
- **Bucket `fundos-portal`** — privado, uma policy por operação, arquivo por `auth.uid()`. ✅
- **Bucket `avatares`** — público por decisão consciente e documentada (foto de perfil
  aparece em conversa de terceiros; sem dado sensível). ✅
- **Logout** — chama `supabase.auth.signOut()` de verdade, limpa cache do topo. ✅
- **Auth** — confirmação de e-mail por OTP de 6 dígitos, `max_frequency = 1m0s`, senha de
  8+ com maiúscula/número/símbolo no cadastro, MFA TOTP habilitado. ✅
- **`.gitignore`** — cobre `.vercel`, `supabase/.temp`, `*.pem`, `.claude/`. ✅
- **Qualidade dos comentários das migrations** — acima da média; explicam o porquê, o que
  foi testado e a decisão de produto. Preserve esse padrão nas migrations novas. ✅

---

## Verificação final — rodar depois de aplicar tudo

### No banco

```sql
-- 1. Nenhuma tabela sem RLS (deve retornar zero linhas)
select c.relname from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- 2. Nenhuma policy com condição frouxa em tabela de dado sensível
--    (setores/unidades/filas/categorias com `true` no SELECT são esperados:
--     são listas de apoio sem dado sensível)
select tablename, policyname, cmd, qual from pg_policies
where schemaname = 'public' and qual = 'true'
  and tablename in ('chamados','comentarios','anexos','usuarios','artigos');

-- 3. Bucket artigos privado
select id, public from storage.buckets;   -- artigos e anexos e fundos-portal: false
```

### Como usuário comum (console do navegador, logado como `solicitante`)

```js
// Deve retornar SÓ os chamados do próprio usuário
const { data } = await supabase.from('chamados').select('id, titulo, solicitante_id');
console.log(data.every(c => c.solicitante_id === (await supabase.auth.getUser()).data.user.id));
// esperado: true

// Deve retornar vazio ou erro — textos rápidos são só da equipe
await supabase.from('textos_rapidos').select('*');

// Deve falhar — não é admin
await supabase.from('categorias').insert({ nome: 'teste', ativo: true });

// Deve falhar — trigger protege_perfil_usuario
await supabase.from('usuarios').update({ perfil: 'admin' }).eq('id', '<meu-id>');
```

### Headers

```bash
curl -sI https://<seu-dominio>/painel | grep -iE "content-security|strict-transport|permissions-policy|x-frame|x-content"
```

### Cadeia de migrations

```bash
supabase db reset   # do zero, sem erro
```

---

## Ordem de execução recomendada

**Antes de migrar os dados do Trello:** itens 11 → 1 → 2 → 3.

O 11 destrava o `db reset`, o 1 põe o schema sob controle de versão, o 2 fecha a porta de
entrada e o 3 estanca o único vazamento de dado real. Os itens 4, 5 e 6 são defesa em
profundidade e podem entrar na sequência. Os demais são melhoria contínua.

**Nada aqui pede que você afrouxe uma policy existente.** Se alguma tela quebrar depois
de uma correção, o ajuste é na tela.
