# Auditoria de segurança — 2026-09-21

## Resultado executivo

O código foi endurecido contra os achados reproduzíveis de maior impacto. Não existe garantia técnica de “100% seguro”: a aprovação para produção depende de aplicar as migrations e secrets em staging, executar o inventário do banco remoto e concluir os testes por papel. Esta revisão não alterou o banco nem o deploy remoto.

## Correções implementadas

| Área | Estado | Controle |
|---|---|---|
| Segredos | Corrigido no repositório | `.env*`, chaves privadas e certificados ignorados; exemplo sem valores; `service_role`, SMTP e VAPID somente por ambiente/Vault |
| Histórico Git | Verificado | Scanner heurístico sem valores encontrou 0 achados em 78 commits, 466 blobs alcançáveis e 105 arquivos rastreados |
| Chave do navegador | Aceito por desenho | `sb_publishable_*` é pública e continua no cliente; não substitui RLS |
| Autenticação | Corrigido | Senha mínima de 8 caracteres com complexidade, confirmação de e-mail, troca segura, JWT curto e rotação de refresh token |
| Cadastro | Corrigido | Formato de e-mail validado e confirmação obrigatória; sem restrição por domínio |
| Rotas privilegiadas | Corrigido | Guard único fail-closed; Painel somente admin; Portal analista/admin; Base e edição exigem perfil ativo/aprovado |
| Autorização no banco | Migration pronta | Unidade imutável pelo próprio usuário; autoria de artigo; origem/tipo de comentário; ACL e `search_path` de funções |
| Storage | Migration pronta | Buckets `artigos`, `terceiros` e `avatares` privados; URLs assinadas por sessão e curta duração |
| Push | Corrigido | Autenticação server-to-server, payload em allowlist, releitura do evento, deduplicação, endpoints permitidos e mensagem sem dado sensível |
| Rate limiting | Corrigido/configurado | Limites locais do Supabase Auth e limite atômico de 10 criações administrativas por 5 minutos |
| CORS | Configurado | `criar-usuario` permite chamadas cross-origin, mantendo autenticação JWT e autorização administrativa obrigatórias |
| Headers | Corrigido | CSP efetiva, HSTS, `nosniff`, anti-frame, Referrer e Permissions Policy |
| Supply chain | Corrigido | Supabase JS fixado em `2.116.0`; bibliotecas CDN com versão fixa e SRI SHA-384 |
| XSS | Endurecido | Scripts/eventos inline removidos, CSP bloqueia script inline, atributos dinâmicos escapam aspas, URLs de anexos não entram em `href/src` sem validação |
| Debug | Verificado | Nenhum `debugger`, `console.log` ou `verify_jwt=false`; Edge Functions exigem JWT |

## Migrations novas

1. `20260921090000_security_authorization_hardening.sql`
2. `20260921091000_private_storage.sql`
3. `20260921092000_push_hardening.sql`
4. `20260921094000_admin_edge_rate_limit.sql`

## Validações executadas

- `node --check` em todos os arquivos JavaScript e nas duas Edge Functions: aprovado.
- Testes de segurança de push/service worker: 6 aprovados, 0 falhas; 4 PoCs históricas marcadas como ignoradas porque a implementação vulnerável foi substituída.
- `git diff --check`: aprovado (apenas avisos de normalização LF/CRLF).
- JSON de `vercel.json`: parse aprovado.
- Busca de scripts/eventos inline, debug e JWT desativado: nenhum achado ativo.
- Varredura heurística de segredos: nenhum achado no working tree rastreado ou histórico alcançável.

## Bloqueadores obrigatórios antes da produção

1. O schema remoto ainda não possui baseline reproduzível no Git. As tabelas antigas criadas pelo Studio impedem certificar `supabase db reset` do zero. Exporte/reconcilie o schema real em staging antes de `db push`.
2. Execute `scripts/security/rls-inventory.sql` como role administrativa e revise policies, grants, triggers, owners, Vault, `pg_net` e buckets. O script é somente leitura.
3. Aplique as quatro migrations em staging, depois rode regressão com solicitante pendente/aprovado/desativado, contribuinte, analista e admin. Só então promova para produção.
4. No Supabase hospedado, configure senha mínima/complexidade, proteção contra senhas vazadas, CAPTCHA e rate limits em Authentication. `config.toml` cobre o ambiente local, não prova o estado remoto.
5. Rotacione imediatamente qualquer segredo que já tenha sido compartilhado fora do secret manager, mesmo sem achado no Git. A varredura não cobre objetos Git inalcançáveis, PDFs/binários, ambientes remotos ou Vault.
6. Faça teste manual da CSP e dos fluxos de exportação PDF/gráficos no preview da Vercel antes de promover.

## Risco residual

A proteção real dos dados continua sendo RLS/Storage/ACL no Supabase; guards do navegador são somente defesa de interface. Sem inventário do banco remoto e teste das migrations em staging, o estado de produção não pode ser declarado seguro.
