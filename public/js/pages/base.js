// Base de soluções: listagem, busca, filtros e painel de detalhe — Fase 1.
//
// Portado da tela de início do projeto GASO, com três diferenças:
//   - lê da tabela `artigos` deste projeto, não de `solucoes`;
//   - a descrição vem de `conteudo` e a categoria de uma junção com `categorias`;
//   - o tipo Script/SQL não existe aqui, então código, parâmetros e risco saíram.

import { supabase } from "../config/supabase-config.js";

const contagemEl = document.getElementById("busca-contagem");
const buscaInput = document.getElementById("busca-input");
const grade = document.getElementById("solucoes-grade");
const vazioEl = document.getElementById("solucoes-vazio");

const filtroTipo = document.getElementById("filtro-tipo");
const filtroCategoria = document.getElementById("filtro-categoria");
const filtroCriticidade = document.getElementById("filtro-criticidade");
const filtroAutor = document.getElementById("filtro-autor");
const filtroPeriodo = document.getElementById("filtro-periodo");
const filtros = [filtroTipo, filtroCategoria, filtroCriticidade, filtroAutor, filtroPeriodo];

const filtrosAplicadosEl = document.getElementById("filtros-aplicados");
const filtrosChipsEl = document.getElementById("filtros-aplicados-chips");
const filtrosLimparBtn = document.getElementById("filtros-limpar");

const ordenarBtn = document.getElementById("ordenar-btn");
const ordenarTexto = document.getElementById("ordenar-texto");

const visualizacaoGradeBtn = document.getElementById("visualizacao-grade");
const visualizacaoListaBtn = document.getElementById("visualizacao-lista");

let artigosTodos = [];
let ordenacao = "recentes";

const TIPO_INFO = {
  erro: {
    label: "Erro",
    cor: "var(--tipo-erro-cor)",
    fundo: "var(--tipo-erro-fundo)",
    icone: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'
  },
  procedimento: {
    label: "Procedimento",
    cor: "var(--tipo-procedimento-cor)",
    fundo: "var(--tipo-procedimento-fundo)",
    icone: '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12l2 2 4-4"/>'
  }
};

const CRITICIDADE_INFO = {
  baixa: { label: "Baixa", cor: "var(--prioridade-baixa)" },
  media: { label: "Média", cor: "var(--prioridade-media)" },
  alta: { label: "Alta", cor: "var(--prioridade-alta)" },
  critica: { label: "Crítica", cor: "var(--prioridade-critica)" }
};

const ICONE_TAG_CATEGORIA = '<path d="M3 21h18"/><path d="M5 21V10M9 21V10M15 21V10M19 21V10"/><path d="M3 10l9-6 9 6"/>';
const ICONE_TAG_SINTOMA = '<path d="M20.59 13.41L11 3.83A2 2 0 0 0 9.59 3H4a1 1 0 0 0-1 1v5.59a2 2 0 0 0 .59 1.41l9.58 9.58a2 2 0 0 0 2.83 0l4.59-4.59a2 2 0 0 0 0-2.83z"/><circle cx="7.5" cy="7.5" r="1"/>';
const ICONE_TAG_TABELA = '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>';

// Tudo que vem do banco passa por aqui antes de virar HTML.
function escapar(texto) {
  const div = document.createElement("div");

  div.textContent = texto ?? "";

  return div.innerHTML;
}

function formatarData(dataIso) {
  if (!dataIso) return "";

  return new Date(dataIso).toLocaleDateString("pt-BR");
}

function iniciaisAutor(nome) {
  const partes = (nome || "").trim().split(/\s+/).filter(Boolean);

  if (partes.length === 0) return "?";

  return ((partes[0][0] || "") + (partes[1]?.[0] || "")).toUpperCase();
}

//GRADE OU LISTA
function aplicarVisualizacao(modo) {
  localStorage.setItem("visualizacao", modo);
  grade.classList.toggle("solucoes-grade--lista", modo === "lista");
  visualizacaoGradeBtn.classList.toggle("visualizacao-btn--ativo", modo === "grade");
  visualizacaoListaBtn.classList.toggle("visualizacao-btn--ativo", modo === "lista");
  renderizarLista();
}

visualizacaoGradeBtn.addEventListener("click", () => aplicarVisualizacao("grade"));
visualizacaoListaBtn.addEventListener("click", () => aplicarVisualizacao("lista"));

//CARD
function renderizarLinhaTags(itens, limite) {
  if (itens.length === 0) return "";

  const visiveis = itens.slice(0, limite);
  const restantes = itens.length - visiveis.length;

  const chips = visiveis.map((item) => `
    <span class="solucao-card__tag">
      <svg class="solucao-card__tag-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${item.icone}</svg>
      ${escapar(item.texto)}
    </span>
  `).join("");

  const mais = restantes > 0
    ? `<span class="solucao-card__tag solucao-card__tag--mais">+${restantes}</span>`
    : "";

  return `<div class="solucao-card__tags">${chips}${mais}</div>`;
}

function criarCard(artigo) {
  const tipoInfo = TIPO_INFO[artigo.tipo] || { label: artigo.tipo || "—", cor: "#6b7280", fundo: "#f2f3f5", icone: "" };
  const criticidadeInfo = CRITICIDADE_INFO[artigo.criticidade];
  const emLista = grade.classList.contains("solucoes-grade--lista");

  const itensNegocio = [];

  if (artigo.categoria) itensNegocio.push({ texto: artigo.categoria, icone: ICONE_TAG_CATEGORIA });

  (artigo.sintomas || []).forEach((s) => s && itensNegocio.push({ texto: s, icone: ICONE_TAG_SINTOMA }));

  const itensTecnicos = (artigo.tabelas_campos || [])
    .filter(Boolean)
    .map((t) => ({ texto: t, icone: ICONE_TAG_TABELA }));

  const criticidadeHtml = criticidadeInfo
    ? `<span class="criticidade-pill"><span class="criticidade-pill__ponto" style="background-color:${criticidadeInfo.cor};"></span>${criticidadeInfo.label}</span>`
    : "";

  const card = document.createElement("div");

  card.className = "solucao-card";
  card.innerHTML = `
    <div class="solucao-card__topo">
      <span class="tipo-pill" style="background-color:${tipoInfo.fundo}; color:${tipoInfo.cor};">
        <svg class="tipo-pill__icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${tipoInfo.icone}</svg>
        ${tipoInfo.label}
      </span>
      ${criticidadeHtml}
    </div>

    <h3 class="solucao-card__titulo">${escapar(artigo.titulo || "Sem título")}</h3>
    <p class="solucao-card__descricao">${escapar(artigo.conteudo)}</p>

    ${renderizarLinhaTags(itensNegocio, emLista ? itensNegocio.length : 2)}
    ${renderizarLinhaTags(itensTecnicos, emLista ? itensTecnicos.length : 1)}

    <div class="solucao-card__rodape">
      <span class="solucao-card__avatar">${escapar(iniciaisAutor(artigo.autor))}</span>
      <span class="solucao-card__autor">${escapar(artigo.autor || "Autor não informado")}</span>
      <span class="solucao-card__tempo">· Criada em ${formatarData(artigo.criado_em)}</span>
    </div>
  `;

  card.addEventListener("click", () => abrirPainel(artigo));

  return card;
}

//IMAGEM EM TAMANHO GRANDE
const lightboxEl = document.getElementById("lightbox");
const lightboxImagemEl = document.getElementById("lightbox-imagem");

function abrirLightbox(src, alt) {
  lightboxImagemEl.src = src;
  lightboxImagemEl.alt = alt || "";
  lightboxEl.hidden = false;
}

function fecharLightbox() {
  lightboxEl.hidden = true;
  lightboxImagemEl.src = "";
}

lightboxEl.addEventListener("click", fecharLightbox);

//CONFIRMACAO DE EXCLUSAO
const confirmarOverlay = document.getElementById("confirmar-overlay");
const confirmarCancelarBtn = document.getElementById("confirmar-cancelar");
const confirmarExcluirBtn = document.getElementById("confirmar-excluir");

let confirmarResolver = null;
let confirmarTimer = null;

// A espera de 5s existe para ninguém apagar no impulso.
function abrirConfirmacaoExclusao() {
  confirmarOverlay.hidden = false;

  let restante = 5;

  confirmarExcluirBtn.disabled = true;
  confirmarExcluirBtn.textContent = `Aguarde ${restante}s...`;

  confirmarTimer = setInterval(() => {
    restante -= 1;

    if (restante > 0) {
      confirmarExcluirBtn.textContent = `Aguarde ${restante}s...`;
      return;
    }

    clearInterval(confirmarTimer);
    confirmarExcluirBtn.disabled = false;
    confirmarExcluirBtn.textContent = "Excluir";
  }, 1000);

  return new Promise((resolver) => { confirmarResolver = resolver; });
}

function fecharConfirmacaoExclusao(resultado) {
  clearInterval(confirmarTimer);
  confirmarOverlay.hidden = true;

  if (confirmarResolver) {
    confirmarResolver(resultado);
    confirmarResolver = null;
  }
}

confirmarCancelarBtn.addEventListener("click", () => fecharConfirmacaoExclusao(false));
confirmarExcluirBtn.addEventListener("click", () => fecharConfirmacaoExclusao(true));

confirmarOverlay.addEventListener("click", (evento) => {
  if (evento.target === confirmarOverlay) fecharConfirmacaoExclusao(false);
});

//PAINEL DE DETALHE
const painelOverlay = document.getElementById("painel-overlay");
const painelEl = document.getElementById("painel");
const painelTipoEl = document.getElementById("painel-tipo");
const painelModuloEl = document.getElementById("painel-modulo");
const painelCorpoEl = document.getElementById("painel-corpo");
const painelErroEl = document.getElementById("painel-erro");
const painelEditarBtn = document.getElementById("painel-editar");
const painelExcluirBtn = document.getElementById("painel-excluir");
const painelExpandirBtn = document.getElementById("painel-expandir");
const painelFecharBtn = document.getElementById("painel-fechar");

let artigoAberto = null;

function renderizarGaleriaPasso(imagens) {
  if (!imagens || imagens.length === 0) return "";

  const itens = imagens
    .map((img) => `<img class="painel-passo__imagem" src="${escapar(img.url)}" alt="${escapar(img.nome || "Imagem do passo")}">`)
    .join("");

  return `<div class="painel-passo__galeria">${itens}</div>`;
}

function renderizarPassos(passos) {
  if (!passos || passos.length === 0) {
    return '<p class="painel__vazio-secao">Nenhum passo cadastrado.</p>';
  }

  return passos.map((passo) => `
    <div class="painel-passo">
      <span class="painel-passo__numero">${passo.ordem}</span>
      <div class="painel-passo__conteudo">
        <p class="painel-passo__texto">${escapar(passo.texto)}</p>
        ${renderizarGaleriaPasso(passo.imagens)}
      </div>
    </div>
  `).join("");
}

function renderizarSecaoTags(titulo, itens) {
  if (!itens || itens.length === 0) return "";

  const chips = itens.map((t) => `<span class="solucao-card__tag">${escapar(t)}</span>`).join("");

  return `
    <div class="painel__secao">
      <span class="painel__secao-titulo">${titulo}</span>
      <div class="painel-tags">${chips}</div>
    </div>
  `;
}

function renderizarAnexos(anexos) {
  if (!anexos || anexos.length === 0) return "";

  const itens = anexos
    .map((anexo) => `<li><a href="${escapar(anexo.url)}" target="_blank" rel="noopener">${escapar(anexo.nome)}</a></li>`)
    .join("");

  return `
    <div class="painel__secao">
      <span class="painel__secao-titulo">Anexos</span>
      <ul class="painel-anexos">${itens}</ul>
    </div>
  `;
}

function renderizarRelacionadas(relacionadas) {
  if (!relacionadas || relacionadas.length === 0) return "";

  const itens = relacionadas
    .map((id) => artigosTodos.find((a) => a.id === id))
    .filter(Boolean)
    .map((a) => `<button type="button" class="painel-relacionada" data-id="${escapar(a.id)}">${escapar(a.titulo || "Sem título")}</button>`)
    .join("");

  if (!itens) return "";

  return `
    <div class="painel__secao">
      <span class="painel__secao-titulo">Soluções relacionadas</span>
      <div class="painel-relacionadas">${itens}</div>
    </div>
  `;
}

function abrirPainel(artigo) {
  artigoAberto = artigo;
  painelErroEl.textContent = "";

  const tipoInfo = TIPO_INFO[artigo.tipo] || { label: artigo.tipo || "—", cor: "#6b7280", fundo: "#f2f3f5" };
  const criticidadeInfo = CRITICIDADE_INFO[artigo.criticidade];

  painelTipoEl.textContent = tipoInfo.label;
  painelTipoEl.style.backgroundColor = tipoInfo.fundo;
  painelTipoEl.style.color = tipoInfo.cor;
  painelModuloEl.textContent = artigo.modulo || "";
  painelModuloEl.hidden = !artigo.modulo;

  painelCorpoEl.innerHTML = `
    <h2 class="painel__titulo">${escapar(artigo.titulo || "Sem título")}</h2>
    <p class="painel__descricao">${escapar(artigo.conteudo)}</p>

    <div class="painel__info-grid">
      <div>
        <span class="painel__campo-label">Prioridade</span>
        <p class="painel__campo-valor" style="color:${criticidadeInfo?.cor || "inherit"};">${criticidadeInfo?.label || "Não informado"}</p>
      </div>
      <div>
        <span class="painel__campo-label">Categoria</span>
        <p class="painel__campo-valor">${escapar(artigo.categoria || "Não informado")}</p>
      </div>
      <div>
        <span class="painel__campo-label">Autor</span>
        <p class="painel__campo-valor">${escapar(artigo.autor || "Não informado")}</p>
      </div>
      <div>
        <span class="painel__campo-label">Criado em</span>
        <p class="painel__campo-valor">${formatarData(artigo.criado_em)}</p>
      </div>
    </div>

    ${artigo.codigo_erro ? `
      <div class="painel__secao">
        <span class="painel__secao-titulo">Código ou mensagem de erro</span>
        <p class="painel__texto">${escapar(artigo.codigo_erro)}</p>
      </div>
    ` : ""}

    <div class="painel__secao">
      <span class="painel__secao-titulo">Solução</span>
      <div class="painel-passos">${renderizarPassos(artigo.passos)}</div>
    </div>

    ${renderizarSecaoTags("Sintomas e palavras-chave", artigo.sintomas)}
    ${renderizarSecaoTags("Tabelas e campos envolvidos", artigo.tabelas_campos)}
    ${renderizarAnexos(artigo.anexos)}
    ${renderizarRelacionadas(artigo.relacionadas)}
  `;

  painelCorpoEl.querySelectorAll(".painel-passo__imagem").forEach((img) => {
    img.addEventListener("click", () => abrirLightbox(img.src, img.alt));
  });

  painelCorpoEl.querySelectorAll(".painel-relacionada").forEach((botao) => {
    botao.addEventListener("click", () => {
      const alvo = artigosTodos.find((a) => a.id === botao.dataset.id);

      if (alvo) abrirPainel(alvo);
    });
  });

  painelOverlay.hidden = false;
  document.body.style.overflow = "hidden";

  const url = new URL(window.location.href);

  url.searchParams.set("id", artigo.id);
  window.history.replaceState({}, "", url);
}

function fecharPainel() {
  painelOverlay.hidden = true;
  painelEl.classList.remove("painel--expandido");
  document.body.style.overflow = "";
  artigoAberto = null;

  const url = new URL(window.location.href);

  url.searchParams.delete("id");
  window.history.replaceState({}, "", url);
}

painelFecharBtn.addEventListener("click", fecharPainel);
painelExpandirBtn.addEventListener("click", () => painelEl.classList.toggle("painel--expandido"));

painelOverlay.addEventListener("click", (evento) => {
  if (evento.target === painelOverlay) fecharPainel();
});

document.addEventListener("keydown", (evento) => {
  if (evento.key !== "Escape") return;

  if (!lightboxEl.hidden) fecharLightbox();
  else if (!confirmarOverlay.hidden) fecharConfirmacaoExclusao(false);
  else if (!painelOverlay.hidden) fecharPainel();
});

painelEditarBtn.addEventListener("click", () => {
  if (artigoAberto) window.location.href = `nova-solucao.html?id=${artigoAberto.id}`;
});

painelExcluirBtn.addEventListener("click", async () => {
  if (!artigoAberto) return;

  const confirmado = await abrirConfirmacaoExclusao();

  if (!confirmado) return;

  painelErroEl.textContent = "";
  painelExcluirBtn.disabled = true;

  const { error } = await supabase.from("artigos").delete().eq("id", artigoAberto.id);

  painelExcluirBtn.disabled = false;

  if (error) {
    console.error("Erro ao excluir solução:", error);
    painelErroEl.textContent = "Não foi possível excluir. Só quem cadastrou a solução pode apagá-la.";
    return;
  }

  const idExcluido = artigoAberto.id;

  artigosTodos = artigosTodos.filter((a) => a.id !== idExcluido);
  fecharPainel();
  renderizarLista();
  atualizarContagem();
});

//FILTROS
const LABELS_FILTRO = {
  tipo: "Tipo",
  categoria: "Categoria",
  criticidade: "Prioridade",
  autor: "Autor",
  periodo: "Período"
};

function obterFiltrosAtivos() {
  return {
    tipo: filtroTipo.value,
    categoria: filtroCategoria.value,
    criticidade: filtroCriticidade.value,
    autor: filtroAutor.value,
    periodo: filtroPeriodo.value
  };
}

function rotuloDoFiltro(chave, valor) {
  if (chave === "periodo") return `Período · Últimos ${valor} dias`;
  if (chave === "criticidade") return `Prioridade · ${CRITICIDADE_INFO[valor]?.label || valor}`;
  if (chave === "tipo") return `Tipo · ${TIPO_INFO[valor]?.label || valor}`;

  return `${LABELS_FILTRO[chave]} · ${valor}`;
}

function renderizarFiltrosAplicados() {
  const ativos = Object.entries(obterFiltrosAtivos()).filter(([, valor]) => valor);

  filtrosChipsEl.innerHTML = "";

  if (ativos.length === 0) {
    filtrosAplicadosEl.hidden = true;
    return;
  }

  filtrosAplicadosEl.hidden = false;

  ativos.forEach(([chave, valor]) => {
    const chip = document.createElement("span");

    chip.className = "filtro-chip";
    chip.textContent = rotuloDoFiltro(chave, valor);

    const remover = document.createElement("button");

    remover.type = "button";
    remover.className = "filtro-chip__remover";
    remover.setAttribute("aria-label", "Remover filtro");
    remover.textContent = "×";
    remover.addEventListener("click", () => {
      document.getElementById(`filtro-${chave}`).value = "";
      renderizarLista();
    });

    chip.appendChild(remover);
    filtrosChipsEl.appendChild(chip);
  });
}

function preencherSelect(selectEl, valores) {
  const valorAtual = selectEl.value;
  const primeira = selectEl.querySelector("option");

  selectEl.innerHTML = "";
  selectEl.appendChild(primeira);

  Array.from(new Set(valores.filter(Boolean))).sort().forEach((valor) => {
    const opcao = document.createElement("option");

    opcao.value = valor;
    opcao.textContent = valor;
    selectEl.appendChild(opcao);
  });

  selectEl.value = valorAtual;
}

//BUSCA
const TAMANHO_MINIMO_TERMO = 3;

function normalizar(texto) {
  return (texto || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function pontuar(artigo, termos, termoCompleto) {
  const nome = normalizar(artigo.titulo);
  const descricao = normalizar(artigo.conteudo);
  const outros = normalizar([
    artigo.categoria,
    artigo.modulo,
    artigo.codigo_erro,
    ...(Array.isArray(artigo.sintomas) ? artigo.sintomas : []),
    ...(Array.isArray(artigo.tabelas_campos) ? artigo.tabelas_campos : [])
  ].filter(Boolean).join(" "));

  let pontuacao = 0;

  termos.forEach((termo) => {
    if (nome.includes(termo)) pontuacao += 3;
    if (descricao.includes(termo)) pontuacao += 2;
    if (outros.includes(termo)) pontuacao += 1;
  });

  if (pontuacao === 0) return 0;

  // Título igual ao que foi digitado vence qualquer soma de termos soltos.
  if (nome === termoCompleto) pontuacao += 1000;
  else if (nome.startsWith(termoCompleto)) pontuacao += 500;
  else if (nome.includes(termoCompleto)) pontuacao += 100;

  return pontuacao;
}

function renderizarLista() {
  const termo = buscaInput.value.trim();
  const ativos = obterFiltrosAtivos();

  let filtradas = artigosTodos.filter((artigo) => {
    if (ativos.tipo && artigo.tipo !== ativos.tipo) return false;
    if (ativos.categoria && artigo.categoria !== ativos.categoria) return false;
    if (ativos.criticidade && artigo.criticidade !== ativos.criticidade) return false;
    if (ativos.autor && artigo.autor !== ativos.autor) return false;

    if (ativos.periodo) {
      const dias = (Date.now() - new Date(artigo.criado_em).getTime()) / (1000 * 60 * 60 * 24);

      if (dias > Number(ativos.periodo)) return false;
    }

    return true;
  });

  const porData = (a, b) => {
    const diff = new Date(b.criado_em) - new Date(a.criado_em);

    return ordenacao === "recentes" ? diff : -diff;
  };

  if (termo) {
    const termoNormalizado = normalizar(termo);
    const termos = termoNormalizado.split(/\s+/).filter((t) => t.length >= TAMANHO_MINIMO_TERMO);

    filtradas = termos.length === 0 ? [] : filtradas
      .map((artigo) => ({ artigo, pontuacao: pontuar(artigo, termos, termoNormalizado) }))
      .filter((item) => item.pontuacao > 0)
      .sort((a, b) => (b.pontuacao - a.pontuacao) || porData(a.artigo, b.artigo))
      .map((item) => item.artigo);
  } else {
    filtradas = filtradas.slice().sort(porData);
  }

  grade.innerHTML = "";

  if (filtradas.length === 0) {
    vazioEl.textContent = artigosTodos.length === 0
      ? "Nenhuma solução cadastrada ainda."
      : "Nenhuma solução encontrada para esse filtro.";
    vazioEl.hidden = false;
  } else {
    vazioEl.hidden = true;
    filtradas.forEach((artigo) => grade.appendChild(criarCard(artigo)));
  }

  renderizarFiltrosAplicados();
}

function atualizarContagem() {
  const total = artigosTodos.length;

  contagemEl.textContent = `${total.toLocaleString("pt-BR")} ${total === 1 ? "solução cadastrada" : "soluções cadastradas"}`;
}

//CARGA INICIAL
async function carregarArtigos() {
  const { data, error } = await supabase
    .from("artigos")
    .select("*, categorias(nome)")
    .eq("ativo", true)
    .order("criado_em", { ascending: false });

  if (error) {
    console.error("Erro ao carregar soluções:", error);
    vazioEl.textContent = "Não foi possível carregar as soluções.";
    vazioEl.hidden = false;
    return;
  }

  // A junção devolve { categorias: { nome } }; o resto do código espera uma
  // string simples em `categoria`.
  artigosTodos = (data || []).map((artigo) => ({
    ...artigo,
    categoria: artigo.categorias?.nome || null
  }));

  atualizarContagem();
  preencherSelect(filtroAutor, artigosTodos.map((a) => a.autor));
  preencherSelect(filtroCategoria, artigosTodos.map((a) => a.categoria));
  renderizarLista();

  // Link direto para uma solução abre o painel dela.
  const idNaUrl = new URLSearchParams(window.location.search).get("id");

  if (!idNaUrl) return;

  const artigo = artigosTodos.find((a) => a.id === idNaUrl);

  if (artigo) abrirPainel(artigo);
}

filtros.forEach((select) => select.addEventListener("change", renderizarLista));

buscaInput.addEventListener("input", renderizarLista);

filtrosLimparBtn.addEventListener("click", () => {
  filtros.forEach((select) => { select.value = ""; });
  renderizarLista();
});

ordenarBtn.addEventListener("click", () => {
  ordenacao = ordenacao === "recentes" ? "antigas" : "recentes";
  ordenarTexto.textContent = ordenacao === "recentes" ? "Mais recentes" : "Mais antigas";
  renderizarLista();
});

aplicarVisualizacao(localStorage.getItem("visualizacao") || "grade");
carregarArtigos();
