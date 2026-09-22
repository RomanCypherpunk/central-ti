# Auditoria de segurança — 22/09/2026

Escopo: front-end estático (Vercel), banco e autenticação (Supabase), Edge
Functions, dependências e histórico do repositório. Os testes marcados como
**produção** foram feitos contra o projeto real, sem sessão, usando apenas a
chave pública do site — o mesmo que um atacante teria.

Esta auditoria **não prova ausência de vulnerabilidades**. Ela registra o que
foi testado, com que resultado, e o que ficou fora do alcance.

---

## 1. Achados corrigidos nesta auditoria

### 1.1 Senha fraca aceita pelo servidor — ALTO

A regra "8+ caracteres, com maiúscula, número e símbolo" existia **apenas no
JavaScript** (`SENHA_REGEX`, `cadastro.js`). Quem chamasse a API de cadastro
direto criava conta com o padrão do Supabase: 6 caracteres, sem exigência.

Evidência (produção, `POST /auth/v1/signup`): senha `123456` → **200**.

Correção: `minimum_password_length = 8` e
`password_requirements = "lower_upper_letters_digits_symbols"` em
`supabase/config.toml`.

> **Pendente de ação no Dashboard.** O `config.toml` vale para o ambiente
> local ou via `supabase config push`. Enquanto não for aplicado em
> Authentication > Providers > Email, **produção continua aceitando `123456`**.

### 1.2 Cadastro aberto a qualquer domínio — ACHADO RETIRADO (não é falha)

Eu havia classificado isto como ALTO e travado o cadastro no domínio da
empresa. **Estava errado, e a correção foi desfeita por inteiro.**

O cadastro é aberto **de propósito**: parceiros e terceiros (Movelex, Gmail,
Hotmail) também precisam abrir chamado. Quem controla o acesso não é o
domínio do e-mail — é a **aprovação do TI** (`status_aprovacao`), e sem ela
as policies de `chamados` e `artigo_feedback` já não deixam a conta fazer
nada. `docs/plano-implementacao.md` registra a decisão desde o começo
("Qualquer e-mail é aceito no cadastro"); eu não a levei em conta.

Desfeito: a migration `20260922090000_dominio_corporativo_no_cadastro.sql`
foi apagada, a checagem saiu do `cadastro.js` e o texto da tela voltou ao que
era. Só ficou de pé uma correção de copy: o rótulo dizia "E-mail
corporativo", o que contradizia a regra real — agora é "E-mail".

**Risco residual, que continua existindo e é aceito:** qualquer pessoa da
internet dispara um cadastro, e cada tentativa gasta um e-mail do SMTP da
empresa. O que limita:

- confirmação por código de 6 dígitos — conta sem confirmar não entra, e o
  código prova que a caixa existe (o `@dominio-invalido-auditoria.test` do
  teste abaixo aceitou o cadastro, mas nunca receberia o código);
- aprovação do TI antes de qualquer dado;
- limites de taxa do Auth (`email_sent`, `max_frequency = 1m`) — **conferir no
  Dashboard**, o `config.toml` não os aplica em produção (item 5 da seção 3).

### 1.3 jsPDF desatualizado (CVEs públicos) — MÉDIO

`jspdf 2.5.1` em `base.html` e `painel.html`. Atualizado para **4.2.1**, com
SRI conferido contra o arquivo servido e as 12 funções usadas pelo site
testadas na versão nova (2 páginas, quebra de texto, imagem PNG e JPEG).

### 1.4 Dependência de Edge Function sem versão fixa — MÉDIO

`npm:web-push@3` aceitaria qualquer 3.x futura, numa função que roda com a
chave mestra. Fixado em `3.6.7`.

### 1.5 CORS das funções de administração — BAIXO

Era `*` fixo. Agora vem de `ALLOWED_ORIGIN` (padrão `*`, para não quebrar
nada). Definindo o segredo com `https://ti-gasometromadeiras.vercel.app`, o
navegador passa a recusar chamadas de outros sites. Não é a proteção
principal: quem protege é o token no `Authorization`.

### 1.6 Código morto publicado — BAIXO

`triagem.html`, `dashboard.html` e os dois JS de uma linha foram removidos.
Eram cascas vazias apontando para um `css/style.css` inexistente.

---

## 2. O que foi testado e está correto

| Item | Evidência |
|---|---|
| Segredos no código | Nenhum. `service_role` só via `Deno.env` |
| Histórico do Git (102 commits, todos os branches) | Nenhum `.env`, chave ou token |
| Leitura sem login das 19 tabelas | Só `setores` e `unidades` (id, nome, ativo), necessárias ao cadastro |
| Storage sem login (5 buckets) | Listagem e download bloqueados |
| Funções de permissão (`is_admin`, `is_equipe_ti`…) | Fechadas para anônimo (401/42501) |
| Escalada de privilégio por edição do próprio cadastro | Bloqueada por trigger: `perfil` só admin; aprovação só TI e nunca em si mesmo; setor e unidade só TI |
| Escalada no cadastro | `handle_new_user` só lê nome, sobrenome, setor e unidade; `perfil`/`status_aprovacao` usam o padrão |
| Edge Functions sem token | 401 nas quatro |
| Edge Function com **token forjado** | Rejeitado pela plataforma (`Invalid JWT`) — `verify_jwt` ativo |
| Funções de admin | Conferem admin no banco, validam campos por lista, limitam tentativas (criar/excluir) |
| XSS | 39 pontos de injeção de HTML revisados; nenhum recebe dado de usuário sem escape. Texto de comentário usa `textContent` |
| Arquivos internos expostos | `supabase/`, `docs/`, `scripts/`, `.git`, `README` → 404. Só `public/` é publicado |
| Cabeçalhos de segurança | CSP, HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy ativos em produção |
| HTTP → HTTPS | 308 |
| Scripts de terceiros | Os 3 com SRI correto, conferido contra o arquivo servido |
| Inline script / `onclick=` | Nenhum (CSP não quebra nada) |
| Log de dado sensível | Nenhum |
| Permissões amplas no banco (`grant all`, `to public`) | Nenhuma |

---

## 3. Pendente — precisa de quem tem acesso ao Dashboard

1. **Aplicar a política de senha** (item 1.1). Sem isso, senha fraca continua
   sendo aceita.
2. **Ativar "Leaked password protection"** (Authentication > Policies): recusa
   senhas que já vazaram em outros sites.
3. **Apagar as contas de teste desta auditoria** (criadas involuntariamente ao
   testar a política de senha, ver seção 4).
4. **Conferir os limites de taxa** em Authentication > Rate limits (o
   `config.toml` do repositório não os aplica em produção). É o que segura o
   volume de cadastros abertos (item 1.2).
5. **`ALLOWED_ORIGIN`** nos segredos das Edge Functions.
6. **MFA para administradores**: o TOTP está habilitado no projeto, mas nenhuma
   tela do site oferece cadastro do segundo fator.

## 4. Efeito colateral desta auditoria

O teste da política de senha (seção 1.1) enviou 4 cadastros com endereços
`@dominio-invalido-auditoria.test`. Como o servidor aceitou, é provável que
existam 4 contas não confirmadas. Para conferir e remover, no SQL Editor:

```sql
select id, email, created_at, email_confirmed_at
from auth.users
where email like '%@dominio-invalido-auditoria.test';

-- depois de conferir que são só as do teste:
delete from auth.users
where email like '%@dominio-invalido-auditoria.test';
```

## 5. Limites desta auditoria

- **Não houve teste autenticado entre perfis.** Verificar na prática se um
  solicitante enxerga chamado de outro exige contas de teste de cada perfil;
  a análise aqui foi de código e políticas, não de execução.
- Não foram avaliados: backups e restauração, retenção de logs, resposta a
  incidentes, segurança física/dos dispositivos, e o painel do provedor
  (Vercel/Supabase) — quem tem acesso a ele tem acesso a tudo.
- Nenhuma auditoria torna um sistema "100% seguro". O que este documento
  sustenta é: as falhas encontradas foram corrigidas, e o que não foi testado
  está listado acima.
