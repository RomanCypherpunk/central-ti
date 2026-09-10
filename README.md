# Central Única de TI

Plataforma própria do setor de TI do Grupo Gasômetro Madeiras, unificando
portal de chamados, base de soluções, triagem prévia e dashboard
operacional sobre um único banco de dados.

O plano completo, a arquitetura e o modelo de dados estão documentados em
[docs/central-unica-ti-plano.md](docs/central-unica-ti-plano.md) — essa é
a fonte da verdade do projeto. Este README cobre apenas a estrutura do
repositório e como rodar localmente.

## Estrutura

```
central-ti/
  public/               # site estático servido pela Vercel (sem build step)
    index.html            # Central — porta de entrada
    login.html
    base.html               # Base de soluções
    triagem.html             # Abertura de chamado
    portal.html               # Portal do TI (quadro de atendimento)
    dashboard.html             # Dashboard operacional
    css/
      style.css
    js/
      auth-guard.js            # guarda de sessão, incluído nas páginas autenticadas
      main.js                   # comportamento compartilhado
      config/
        supabase-config.js          # URL + chave publishable, versionado (não é segredo)
        supabase-config.example.js  # modelo, caso a chave precise trocar
      pages/
        <nome>.js                     # um arquivo por página
    assets/
      img/
  supabase/
    config.toml             # ambiente local (Supabase CLI)
    migrations/               # schema do banco (vazio até a Fase 0)
  docs/                        # proposta, plano de implementação, arquitetura
  vercel.json                    # cleanUrls, headers de segurança
```

Sem framework, sem etapa de build: HTML/CSS/JS servidos diretamente. O
client do Supabase é importado via `esm.sh`, seguindo o mesmo padrão usado
no projeto [GASO](../base-solucoes/GASO).

## Rodando localmente

```bash
npx serve public
```

## Configuração do Supabase

`public/js/config/supabase-config.js` já vem preenchido e versionado no
repositório — não precisa copiar nada para rodar localmente ou fazer
deploy na Vercel. A chave usada é do tipo `publishable`
(`sb_publishable_...`): identifica o projeto, mas não autoriza nada por si
só — quem protege os dados são as políticas de Row Level Security (RLS)
nas tabelas e no bucket do Storage. Por isso pode ficar no git com
segurança, ao contrário da chave `service_role`, que nunca deve ser usada
no front-end nem versionada.

Se a chave publishable precisar trocar (rotação, novo projeto Supabase),
edite `supabase-config.js` diretamente — `supabase-config.example.js` fica
só como modelo de referência.

Ambiente local do banco via [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase start
```

## Status

Projeto em fase de estruturação inicial. Próximo passo: Fase 0 —
modelagem do schema e migração do histórico do Trello (ver plano).
