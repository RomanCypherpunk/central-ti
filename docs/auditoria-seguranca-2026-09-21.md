# Auditoria de segurança — 2026-09-21

## Resultado executivo

O código foi endurecido contra os achados reproduzíveis de maior impacto e publicado em produção no commit `6be6232`. As quatro transações SQL e as duas Edge Functions também foram aplicadas no projeto `pmwcfdxryjwsvwsmcufm`. Não existe garantia técnica de “100% seguro”: ainda faltam controles do Auth hospedado e testes manuais por papel.

## Correções implementadas

| Área | Estado | Controle |
|---|---|---|
| Segredos | Corrigido no repositório | `.env*`, chaves privadas e certificados ignorados; exemplo sem valores; `service_role`, SMTP e VAPID somente por ambiente/Vault |
| Histórico Git | Verificado | Scanner heurístico sem valores encontrou 0 achados em 78 commits, 506 blobs alcançáveis e 105 arquivos rastreados |
| Chave do navegador | Aceito por desenho | `sb_publishable_*` é pública e continua no cliente; não substitui RLS |
| Autenticação | Parcial | Cliente e Edge administrativa exigem senha de 8–128 caracteres com complexidade; política equivalente e proteção contra senhas vazadas ainda precisam ser ativadas no Auth hospedado |
| Cadastro | Corrigido no código | Formato de e-mail validado, sem restrição por domínio; confirmação obrigatória ainda precisa ser ativada no Auth hospedado |
| Rotas privilegiadas | Corrigido | Guard único fail-closed; Painel somente admin; Portal analista/admin; Base e edição exigem perfil ativo/aprovado |
| Autorização no banco | Aplicado em produção | Unidade imutável pelo próprio usuário; autoria de artigo; origem/tipo de comentário; ACL e `search_path` de funções |
| Storage | Aplicado em produção | Buckets `artigos`, `terceiros` e `avatares` privados; URLs assinadas por sessão e curta duração |
| Push | Corrigido | Autenticação server-to-server, payload em allowlist, releitura do evento, deduplicação, endpoints permitidos e mensagem sem dado sensível |
| Rate limiting | Aplicado em produção | Limite atômico de 10 criações administrativas por 5 minutos; limites globais do Auth não foram sobrescritos sem revisão do painel |
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
- Deployment Vercel de produção: concluído com sucesso.
- Buckets confirmados como privados: `artigos` (132 objetos), `avatares` (4) e `terceiros` (7), preservando todos os objetos.
- Edge Functions `criar-usuario` e `notificar-portal`: versão 4 ativa, `verify_jwt=true` e resposta HTTP 401 sem credencial.
- Supabase Security Advisor: redução de 59 para 13 avisos; 12 são RPCs/helpers autenticadas intencionais e 1 é proteção contra senha vazada pendente.

## Pendências operacionais

1. No painel do Auth hospedado, exigir mínimo 8 caracteres, maiúscula, minúscula, número e símbolo; ativar proteção contra senhas vazadas (plano Pro ou superior), confirmação de e-mail, confirmação dupla de troca de e-mail e troca segura de senha.
2. O histórico remoto de migrations não registra diversas alterações de 14–17/09 que já existem no schema. Não executar `supabase db push --include-all`, `db reset --linked` ou `migration repair` até reconciliar um baseline em ambiente isolado.
3. Executar regressão manual com solicitante pendente/aprovado/desativado, contribuinte, analista e admin, incluindo anexos, avatar, PDF/gráficos e push.
4. Rotacionar imediatamente qualquer segredo que já tenha sido compartilhado fora do secret manager, mesmo sem achado no Git. A varredura não cobre objetos Git inalcançáveis, PDFs/binários, ambientes remotos ou Vault.

## Risco residual

A proteção real dos dados continua sendo RLS/Storage/ACL no Supabase; guards do navegador são somente defesa de interface. A ausência de achados no scanner e a aplicação dos controles não eliminam vulnerabilidades futuras nem substituem testes contínuos e monitoramento.
