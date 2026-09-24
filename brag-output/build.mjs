// Gera composition/index.html. Tempos de animacao e SFX saem das mesmas
// constantes, entao digitacao, cliques e sons nunca se desencontram.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "composition");
const audioData = JSON.parse(fs.readFileSync(path.join(dir, "audio-data.json"), "utf8"));

const DUR = 28;
const OV = 0.5; // sobreposicao da transicao entre cenas
const S = {
  hook: [0, 3.1],
  cad: [2.6, 7.3],   // cadastro + confirmacao por codigo na mesma tela
  home: [9.4, 4.3],
  tri: [13.2, 5.7],
  base: [18.4, 3.9],
  sol: [21.8, 3.9],
  out: [25.2, 2.8],
};

const sfx = [];
let sfxN = 0;
const KEYS = ["003", "007", "011", "015", "019", "023"];
const DURS = { "bong_001.ogg": 0.12, "card-slide-1.ogg": 0.6, "click2.ogg": 0.06, "impactBell_heavy_000.ogg": 1.48, "impactSoft_medium_001.ogg": 0.18, "impactSoft_medium_004.ogg": 0.14 };
function som(src, t, vol) {
  const dur = DURS[src] ?? 0.25;
  sfx.push(`<audio id="sfx-${++sfxN}" src="assets/sfx/${src}" data-start="${t.toFixed(3)}" data-duration="${dur}" data-track-index="${2 + (sfxN % 8)}" data-volume="${vol}"></audio>`);
}

// Digitacao: cada caractere vira um span com seu proprio cursor de texto.
// O cursor visivel e sempre o do ultimo caractere revelado.
const typing = []; // {id, t0, dt, n, keyEvery}
function digitado(id, texto, t0, dt, keyEvery = 1, blinkAte = null) {
  const chars = [...texto];
  typing.push({ id, t0, dt, n: chars.length, blinkAte });
  chars.forEach((c, i) => {
    if (i % keyEvery === 0 && c !== " ") som(`keypress-${KEYS[i % KEYS.length]}.wav`, t0 + i * dt, 0.22, 0.25);
  });
  const spans = chars
    .map((c) => `<span class="ch">${c === " " ? "&nbsp;" : c}<i class="cr"></i></span>`)
    .join("");
  return `<span class="typed" id="${id}"><i class="cr cr0"></i>${spans}</span>`;
}

// ---------- tempos das acoes ----------
const T = {
  // cadastro
  nome: 3.25, sobrenome: 3.8, setor: 4.25, unidade: 4.6, proximo: 5.25,
  // confirmacao (mesmo clip)
  etapa3: 6.4, email: 6.95, codigo: 7.75, confirmar: 8.55, ok: 8.7,
  // home
  saud: 9.95, porta1: 10.3, porta2: 10.55, cursorHome: 11.7, novo: 12.65, // beat-locked: 12.65s
  // triagem
  texto: 14.05, busca: 15.95, itens: 16.25, abrir: 17.45,
  // base
  cards: 19.0,
  // solicitacoes
  chamados: 22.65, // beat-locked: 22.65s (primeiro card)
  destaque: 23.75,
  // outro
  logo: 25.55,
};

const ICON = {
  livro: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 5.2A1.7 1.7 0 0 1 5.2 3.5H10a2.5 2.5 0 0 1 2 1v14a2.5 2.5 0 0 0-2-1H5.2a1.7 1.7 0 0 1-1.7-1.7Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M20.5 5.2a1.7 1.7 0 0 0-1.7-1.7H14a2.5 2.5 0 0 0-2 1v14a2.5 2.5 0 0 1 2-1h4.8a1.7 1.7 0 0 0 1.7-1.7Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  quadro: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 12h17M9 4.5v15M15 4.5v15" stroke="currentColor" stroke-width="1.8"/></svg>`,
  fone: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="2.5" y="13" width="4" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="17.5" y="13" width="4" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`,
  monitor: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 20h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  info: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 10.6v6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="7.6" r="1.1" fill="currentColor"/></svg>`,
  seta: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  lupa: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  alerta: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
  lista: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg>`,
  check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  email: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m3.8 7 8.2 6 8.2-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  tag: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.2"/></svg>`,
  conversa: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12Z"/></svg>`,
  voltar: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

const cursor = (id) => `<div class="cursor" id="${id}"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 3l20 12.5-9 1.8 5.2 9.7-3.6 1.9-5.2-9.8L6 25z" fill="#14181f" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg><span class="ripple"></span></div>`;
const etiqueta = (id, n, texto) => `<div class="etapa-tag" data-layout-allow-occlusion id="${id}"><span class="etapa-tag__n">${n}</span><span class="etapa-tag__t" data-layout-allow-overlap>${texto}</span></div>`;
const topo = (produto) => `
  <header class="topo">
    <div class="topo__marca"><img class="topo__logo" src="assets/img/logo-claro.svg" alt=""><span class="topo__divisor"></span><span class="topo__produto">${produto}</span></div>
    <div class="topo__usuario"><span class="avatar">MC</span><span class="topo__usuario-texto"><span class="topo__nome">Mariana Costa</span><span class="topo__setor">Vendas · Loja Centro</span></span><span class="topo__seta">${ICON.seta}</span></div>
  </header>`;

// ---------- cenas ----------
const hook = `
<section class="clip cena" id="cena-hook" data-start="${S.hook[0]}" data-duration="${S.hook[1]}" data-track-index="0">
  <div class="palco degrade" id="hook-palco">
    <div class="brilho" id="hook-brilho"></div>
    <img class="hook__logo" id="hook-logo" src="assets/img/logo-branco.svg" alt="">
    <p class="hook__marca" id="hook-marca">SETOR DE TI · NOVA CENTRAL</p>
    <div class="hook__textos">
      <h1 class="hook__t1" id="hook-t1">Precisa do TI?</h1>
      <p class="hook__t2" id="hook-t2">Agora é tudo num lugar só.</p>
    </div>
  </div>
</section>`;

const cad = `
<section class="clip cena" id="cena-cad" data-start="${S.cad[0]}" data-duration="${S.cad[1]}" data-track-index="1">
  <div class="palco branco" id="cad-palco">
    <div class="cam" id="cad-cam">
      <aside class="vitrine degrade">
        <img class="vitrine__logo" src="assets/img/logo-branco.svg" alt="">
        <div>
          <h2 class="vitrine__titulo">TI Gasômetro Madeiras</h2>
          <p class="vitrine__texto">Crie sua conta para ter acesso as soluções e ao portal de chamados.</p>
        </div>
      </aside>
      <div class="form">
        <p class="form__contador">Etapa <span class="contador-num"><span id="cont-1">1</span><span id="cont-3">3</span></span> de 3</p>
        <h1 class="form__titulo">Criar conta</h1>
        <p class="form__sub">A equipe de TI valida o cadastro antes de liberar o acesso.</p>
        <div class="form__etapas">
          <div class="form__etapa" id="etapa1">
            <div class="grade2">
              <div class="campo"><label>Nome</label><div class="input" id="in-nome"><span class="ph" id="ph-nome">Digite seu nome</span>${digitado("tp-nome", "Mariana", T.nome, 0.06)}</div></div>
              <div class="campo"><label>Sobrenome</label><div class="input" id="in-sobrenome"><span class="ph" id="ph-sobrenome">Digite seu sobrenome</span>${digitado("tp-sobrenome", "Costa", T.sobrenome, 0.06)}</div></div>
              <div class="campo"><label>Setor</label><div class="input select" id="in-setor"><span class="ph" id="ph-setor">Selecione o setor</span><span class="valor" id="v-setor">Vendas</span>${ICON.seta}</div></div>
              <div class="campo"><label>Unidade</label><div class="input select" id="in-unidade"><span class="ph" id="ph-unidade">Selecione a unidade</span><span class="valor" id="v-unidade">Loja Centro</span>${ICON.seta}</div></div>
            </div>
            <div class="acoes"><span class="btn" id="btn-proximo">Próximo <span>→</span></span><span class="entrar">Já tem conta? <b>Entrar</b></span></div>
          </div>
          <div class="form__etapa" id="etapa3">
            <div class="campo"><label>Código de verificação</label><div class="input codigo" id="in-codigo"><span class="ph" id="ph-codigo">000000</span>${digitado("tp-codigo", "482917", T.codigo, 0.1)}</div></div>
            <p class="ajuda">Digite os 6 dígitos que enviamos para <strong>mariana.costa@exemplo.com</strong>. O código vale por 1 hora.</p>
            <div class="aviso">${ICON.info}<p>Depois de confirmar, o TI ainda confere o setor e a unidade. Você receberá um e-mail quando o acesso estiver liberado.</p></div>
            <div class="acoes"><span class="btn" id="btn-confirmar">Confirmar e-mail <span>→</span></span><span class="ok" id="ok-email">${ICON.check} E-mail confirmado</span></div>
          </div>
        </div>
      </div>
    </div>
    <div class="email-toast" id="email-toast">
      <span class="email-toast__icone">${ICON.email}</span>
      <span class="email-toast__txt"><b>TI Gasômetro Madeiras</b><span>Seu código de verificação: <strong>482917</strong></span></span>
    </div>
    ${cursor("cur-cad")}
    ${etiqueta("tag-cad", "01", "Crie sua conta")}
    ${etiqueta("tag-cod", "02", "Confirme o e-mail com um código")}
  </div>
</section>`;

const home = `
<section class="clip cena" id="cena-home" data-start="${S.home[0]}" data-duration="${S.home[1]}" data-track-index="1">
  <div class="palco branco" id="home-palco">
    <div class="cam" id="home-cam">
      ${topo("TI - Gasômetro Madeiras")}
      <section class="faixa degrade">
        <h1 class="saudacao" id="saudacao">Olá, Mariana! Como podemos te ajudar hoje?</h1>
        <div class="portas">
          <article class="porta porta--base" id="porta1">
            <span class="porta__icone">${ICON.livro}</span>
            <h2 class="porta__titulo">Base de Soluções</h2>
            <p class="porta__desc">Encontre soluções rápidas para dúvidas e problemas comuns, sem precisar abrir um chamado.</p>
            <span class="chip">${ICON.monitor} Vendas</span>
            <span class="btn">Acessar base <span>→</span></span>
          </article>
          <article class="porta" id="porta2">
            <span class="porta__icone">${ICON.quadro}</span>
            <h2 class="porta__titulo">Portal de Chamados</h2>
            <p class="porta__desc">Não encontrou a resposta? Solicite ajuda especializada de nossa equipe.</p>
            <span class="meta">${ICON.fone} Segunda a sexta das 8h às 17h48 · Sábados das 8h às 12h</span>
            <span class="btn" id="btn-novo"><span>+</span> Novo chamado</span>
          </article>
        </div>
      </section>
      <div class="colunas">
        <section class="coluna"><h3>Soluções em destaque</h3><p>Configurar a impressora térmica do caixa</p></section>
        <section class="coluna"><h3>Suas últimas solicitações</h3><p>#117 · Mouse com defeito · Fechado</p></section>
      </div>
    </div>
    ${cursor("cur-home")}
    ${etiqueta("tag-home", "03", "Tudo começa no Início")}
  </div>
</section>`;

const triItens = [
  ["Erro", "Impressora do caixa não imprime o cupom", "A fila trava depois de uma queda de energia. Limpe a fila e reinicie o serviço."],
  ["Procedimento", "Reinstalar o driver da impressora térmica", "Passo a passo para reinstalar e definir a impressora padrão do PDV."],
  ["Erro", "Cupom sai em branco", "Bobina colocada ao contrário ou cabeça de impressão suja."],
];
const tri = `
<section class="clip cena" id="cena-tri" data-start="${S.tri[0]}" data-duration="${S.tri[1]}" data-track-index="1">
  <div class="palco cinza" id="tri-palco">
    <div class="cam" id="tri-cam">
      ${topo("Novo chamado")}
      <header class="faixa faixa--baixa degrade">
        <span class="trocar">${ICON.voltar} Trocar tipo de chamado</span>
        <div class="faixa__titulo"><span class="porta__icone">${ICON.fone}</span><div><p class="faixa__rotulo">Suporte TI</p><h1 class="faixa__nome">Vamos tentar resolver agora</h1></div></div>
      </header>
      <div class="folha">
        <div class="secao-titulo"><span>O que você precisa</span><em>a busca acontece enquanto você escreve</em></div>
        <label class="rotulo">Escreva o problema ou a dúvida</label>
        <div class="input textarea" id="in-triagem"><span class="ph" id="ph-triagem">Ex.: a impressora do caixa 2 não imprime o cupom</span>${digitado("tp-triagem", "a impressora do caixa não imprime o cupom", T.texto, 0.042, 2)}</div>
        <p class="dica"><span id="dica-1">Escreva com as suas palavras. Procuramos na base de soluções sozinhos.</span><span id="dica-2">Continue escrevendo para afinar a busca.</span></p>
        <div class="resultado" id="resultado">
          <div class="secao-titulo"><span>Isso pode resolver</span><em>clique numa solução para ver o passo a passo aqui</em></div>
          <ul class="tri-lista">
            ${triItens.map(([tipo, titulo, resumo], i) => `
            <li class="tri-item" id="tri-item-${i}">
              <div class="tri-sol"><span class="selo">${tipo}</span><span class="tri-titulo">${titulo}</span><span class="tri-resumo">${resumo}</span><span class="tri-ver" id="tri-ver-${i}">Ver solução</span></div>
            </li>${i === 0 ? `<li class="tri-detalhe" id="tri-passos"><ol class="tri-passos"><li>Abra <b>Dispositivos e impressoras</b> no computador do caixa.</li><li>Clique na impressora do cupom e em <b>Cancelar todos os documentos</b>.</li><li>Desligue a impressora por 10 segundos e ligue de novo.</li></ol></li>` : ""}`).join("")}
          </ul>
          <div class="tri-acoes"><span class="btn">Nenhuma resolveu, abrir chamado <span>→</span></span></div>
        </div>
      </div>
    </div>
    ${cursor("cur-tri")}
    ${etiqueta("tag-tri", "04", "A Base tenta resolver antes do chamado")}
  </div>
</section>`;

const cards = [
  ["proc", "Configurar a impressora térmica do caixa", "Passo a passo para reinstalar o driver e definir a impressora padrão do PDV.", "Vendas", "12/09/2026"],
  ["erro", "NL: nota fiscal fica pendente de autorização", "O que conferir antes de transmitir de novo e quando acionar o TI.", "Faturamento", "15/09/2026"],
  ["proc", "Acessar o e-mail da empresa pelo celular", "Configuração do Outlook no Android e no iPhone em poucos passos.", "Todos os setores", "18/09/2026"],
  ["erro", "Wi-Fi da loja conectado, mas sem internet", "Como verificar o roteador e o que anotar antes de abrir chamado.", "Vendas", "22/09/2026"],
];
const base = `
<section class="clip cena" id="cena-base" data-start="${S.base[0]}" data-duration="${S.base[1]}" data-track-index="1">
  <div class="palco branco" id="base-palco">
    <div class="cam" id="base-cam">
      <nav class="sidebar degrade"><img src="assets/img/logo-branco.svg" alt=""><span class="side-link">Início</span></nav>
      <div class="base-main">
        <header class="base-header"><p>Base de soluções - Gasômetro madeiras</p><div class="topo__usuario"><span class="avatar">MC</span><span class="topo__usuario-texto"><span class="topo__nome">Mariana Costa</span><span class="topo__setor">Vendas · Loja Centro</span></span></div></header>
        <div class="base-conteudo">
          <p class="contagem">24 soluções cadastradas</p>
          <div class="busca">${ICON.lupa}<span>Busque por erro, código, caminho...</span></div>
          <div class="filtros-base"><span>Tipo</span><span>Setor</span><span>Autor</span><span>Período</span><span class="ordenar">Mais recentes</span></div>
          <div class="grade-cards">
            ${cards.map(([tipo, titulo, desc, setor, data], i) => `
            <div class="sol-card" id="sol-card-${i}">
              <span class="pill pill--${tipo}">${tipo === "erro" ? ICON.alerta + " Erro" : ICON.lista + " Procedimento"}</span>
              <h3>${titulo}</h3>
              <p>${desc}</p>
              <span class="sol-tag">${ICON.tag} ${setor}</span>
              <div class="sol-rodape"><span class="avatar avatar--p">TI</span><b>Equipe de TI</b><span>· Criada em ${data}</span></div>
            </div>`).join("")}
          </div>
        </div>
      </div>
    </div>
    ${etiqueta("tag-base", "05", "Soluções do seu setor, com passo a passo")}
  </div>
</section>`;

const chamados = [
  ["aguardando", "Aguardando você", "#128", "Impressora do caixa não imprime", "O cupom não sai desde a queda de energia de hoje cedo.", "Impressora", "2 mensagens", "Equipe de TI", "24/09/2026"],
  ["andamento", "Em andamento", "#121", "Acesso ao NL bloqueado", "Aparece “usuário sem permissão” ao abrir o pedido de venda.", "Sistemas", "3 mensagens", "Equipe de TI", "22/09/2026"],
  ["fechado", "Fechado", "#117", "Mouse com defeito", "O clique direito parou de funcionar no computador do balcão.", "Equipamento", "4 mensagens", "Equipe de TI", "18/09/2026"],
];
const sol = `
<section class="clip cena" id="cena-sol" data-start="${S.sol[0]}" data-duration="${S.sol[1]}" data-track-index="1">
  <div class="palco cinza" id="sol-palco">
    <div class="cam" id="sol-cam">
      ${topo("TI - Gasômetro Madeiras")}
      <div class="sol-area">
        <header class="sol-cab">
          <div><h1>Solicitações</h1><p>3 solicitações · 1 aguardando você</p></div>
          <span class="sol-busca">${ICON.lupa} Buscar por número ou assunto</span>
        </header>
        <div class="filtros"><span class="filtro filtro--ativo">Todas</span><span class="filtro">Aguardando você</span><span class="filtro">Em andamento</span><span class="filtro">Abertas</span><span class="filtro">Fechadas</span></div>
        <div class="chamados">
          ${chamados.map(([k, rot, num, assunto, desc, cat, msgs, quem, data], i) => `
          <div class="chamado chamado--${k}" id="chamado-${i}">
            <div class="chamado__topo"><span class="selos"><span class="status">${rot}</span>${k === "aguardando" ? '<span class="responda">Responda</span>' : ""}</span><span class="numero">${num}</span></div>
            <p class="chamado__assunto">${num} - ${assunto}</p>
            <p class="chamado__desc">${desc}</p>
            <div class="chamado__tags"><span>${ICON.tag} ${cat}</span><span>${ICON.conversa} ${msgs}</span></div>
            <div class="chamado__rodape"><span class="avatar avatar--p">TI</span><span><b>${quem}</b><em>Aberto em ${data}</em></span></div>
          </div>`).join("")}
        </div>
      </div>
    </div>
    ${etiqueta("tag-sol", "06", "Acompanhe cada chamado e responda aqui")}
  </div>
</section>`;

const outro = `
<section class="clip cena" id="cena-out" data-start="${S.out[0]}" data-duration="${S.out[1]}" data-track-index="1">
  <div class="palco degrade" id="out-palco">
    <div class="brilho" id="out-brilho"></div>
    <div class="out">
      <img class="out__logo" id="out-logo" src="assets/img/logo-branco.svg" alt="">
      <h1 class="out__titulo" id="out-titulo">Central de TI</h1>
      <p class="out__linha" id="out-linha">Resolva sozinho. Ou fale com a gente.</p>
      <p class="out__url" id="out-url">ti.madeirasgasometro.com.br</p>
    </div>
  </div>
</section>`;

// ---------- sons das acoes ----------
som("click2.ogg", T.setor, 0.5, 0.3);
som("click2.ogg", T.unidade, 0.5, 0.3);
som("click2.ogg", T.proximo, 0.6, 0.3);
som("card-slide-1.ogg", T.etapa3, 0.35, 0.6);
som("bong_001.ogg", T.email, 0.45, 0.6);
som("click2.ogg", T.confirmar, 0.6, 0.3);
som("impactSoft_medium_001.ogg", T.ok, 0.55, 0.5);
som("card-slide-1.ogg", T.porta1, 0.3, 0.6);
som("card-slide-1.ogg", T.porta2, 0.3, 0.6);
som("click2.ogg", T.novo, 0.6, 0.3);
som("impactSoft_medium_004.ogg", T.busca, 0.5, 0.5);
[0, 1, 2].forEach((i) => som("card-slide-1.ogg", T.itens + i * 0.3, 0.28, 0.6));
som("click2.ogg", T.abrir, 0.6, 0.3);
[0, 1, 2, 3].forEach((i) => som("card-slide-1.ogg", T.cards + i * 0.26, 0.26, 0.6));
[0, 1, 2].forEach((i) => som("card-slide-1.ogg", T.chamados + i * 0.3, 0.28, 0.6));
som("impactSoft_medium_001.ogg", T.destaque, 0.45, 0.5);
som("impactBell_heavy_000.ogg", T.logo, 0.4, 2.2);

// RMS dos quadros do hook e do outro (so o que o brilho usa).
const rms = audioData.frames.slice(0, DUR * 30).map((f) => +f.rms.toFixed(3));

const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "estilo.css"), "utf8");
const js = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "timeline.js"), "utf8");

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1920, height=1080">
<title>Central de TI — Gasômetro Madeiras</title>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
${css}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="${DUR}">
${hook}
${cad}
${home}
${tri}
${base}
${sol}
${outro}
<audio id="musica" src="assets/music/happy-beats-business-moves-vol-11-by-ende-dot-app.mp3" data-start="0" data-duration="${DUR}" data-track-index="1" data-volume="0.5" data-automation='{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":1},{"t":26.3,"v":1},{"t":28,"v":0}]}]}'></audio>
${sfx.join("\n")}
</div>
<script>
const S = ${JSON.stringify(S)};
const T = ${JSON.stringify(T)};
const OV = ${OV};
const TYPING = ${JSON.stringify(typing)};
const RMS = ${JSON.stringify(rms)};
${js}
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(dir, "index.html"), html);
console.log("ok", sfx.length, "sfx");
