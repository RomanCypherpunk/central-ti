# Biblioteca do Supabase, dentro do projeto

Estes arquivos **não são nossos**: são o cliente `@supabase/supabase-js`
versão **2.116.0**, mais os três atalhos de Node que ele usa no navegador.
Não edite nada aqui.

## Por que não vem mais do CDN

Antes o `supabase-config.js` importava de `https://esm.sh/@supabase/supabase-js@2`
em tempo de execução. Medido na tela de login: aquilo virava **17 arquivos
encadeados, em 6 níveis**, e a página só ficava pronta em **890 ms** — sendo
que o nosso próprio HTML, CSS e JS terminavam em 66 ms. Como toda tela espera
essa biblioteca para saber quem está logado, tudo atrasava junto.

Com os arquivos aqui dentro, a mesma tela fica pronta em **145 ms**.

## Como atualizar a versão

1. Escolha a versão nova (ex.: `2.120.0`) e baixe o pacote já montado:
   `https://esm.sh/@supabase/supabase-js@<versão>/es2022/supabase-js.bundle.mjs`
2. Baixe também o que esse arquivo importar (os caminhos que começam com
   `/node/...`), e o que esses importarem, até não sobrar nenhum.
3. Troque os caminhos `/node/x.mjs` por `./node-x.js`, que é como eles estão
   nomeados aqui.
4. **Renomeie os arquivos com a versão nova** (ex.: `supabase-js-2.120.0.js`)
   e ajuste o `import` do `js/config/supabase-config.js` e o
   `<link rel="modulepreload">` das páginas.

O passo 4 não é capricho: o `vercel.json` manda o navegador guardar esta
pasta por um ano, sem revalidar (`immutable`). É o que a deixa instantânea a
partir da segunda visita — e é também por isso que **nome repetido significa
arquivo velho preso no navegador das pessoas**. Nome novo, cache novo.

## Se um dia entrar uma etapa de build

Com `npm` no deploy, dá para gerar este pacote com esbuild a partir do
`package.json`, em vez de baixar à mão. O efeito no navegador é o mesmo; o
ganho é não depender deste passo manual.
