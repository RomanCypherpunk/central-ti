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
        supabase-config.example.js  # copiar para supabase-config.js (fora do git)
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

```bash
cp public/js/config/supabase-config.example.js public/js/config/supabase-config.js
```

Preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY` com os valores do projeto
(Console Supabase > Project Settings > API Keys). A chave anon não é
segredo — RLS protege os dados. `supabase-config.js` fica fora do git.

Ambiente local do banco via [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase start
```

## Status

Projeto em fase de estruturação inicial. Próximo passo: Fase 0 —
modelagem do schema e migração do histórico do Trello (ver plano).
