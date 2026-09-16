// Base de soluções: listagem, busca, filtros e painel de detalhe — Fase 1.
//
// Portado da tela de início do projeto GASO, com três diferenças:
//   - lê da tabela `artigos` deste projeto, não de `solucoes`;
//   - a descrição vem de `conteudo` e os setores de `setores` (ids resolvidos
//     para nome); a RLS só devolve o que o setor de quem está logado pode ver;
//   - o tipo Script/SQL não existe aqui, então código, parâmetros e risco saíram.

import { supabase } from "../config/supabase-config.js";
import { pintarFoto } from "../componentes/avatar.js";

const contagemEl = document.getElementById("busca-contagem");
const buscaInput = document.getElementById("busca-input");
const grade = document.getElementById("solucoes-grade");
const vazioEl = document.getElementById("solucoes-vazio");

const filtroTipo = document.getElementById("filtro-tipo");
const filtroSetor = document.getElementById("filtro-setor");
const filtroAutor = document.getElementById("filtro-autor");
const filtroPeriodo = document.getElementById("filtro-periodo");
const filtros = [filtroTipo, filtroSetor, filtroAutor, filtroPeriodo];

const filtrosAplicadosEl = document.getElementById("filtros-aplicados");
const filtrosChipsEl = document.getElementById("filtros-aplicados-chips");
const filtrosLimparBtn = document.getElementById("filtros-limpar");

const ordenarBtn = document.getElementById("ordenar-btn");
const ordenarTexto = document.getElementById("ordenar-texto");

const visualizacaoGradeBtn = document.getElementById("visualizacao-grade");
const visualizacaoListaBtn = document.getElementById("visualizacao-lista");

let artigosTodos = [];
let ordenacao = "recentes";

// As cores ficam aqui em hex, e nao em var(--), porque o CSS do projeto
// nao usa variaveis de cor.
const TIPO_INFO = {
  erro: {
    label: "Erro",
    cor: "#b02a2a",
    fundo: "#fdeceb",
    icone: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'
  },
  procedimento: {
    label: "Procedimento",
    cor: "#2f9e44",
    fundo: "#eaf7ee",
    icone: '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12l2 2 4-4"/>'
  }
};

const ICONE_TAG_SETOR = '<path d="M3 21h18"/><path d="M5 21V10M9 21V10M15 21V10M19 21V10"/><path d="M3 10l9-6 9 6"/>';
const ICONE_TAG_SINTOMA = '<path d="M20.59 13.41L11 3.83A2 2 0 0 0 9.59 3H4a1 1 0 0 0-1 1v5.59a2 2 0 0 0 .59 1.41l9.58 9.58a2 2 0 0 0 2.83 0l4.59-4.59a2 2 0 0 0 0-2.83z"/><circle cx="7.5" cy="7.5" r="1"/>';

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

// O nome vem da conta de quem cadastrou (autor_id), não de um texto digitado:
// acompanha quem edita o próprio nome em "Dados pessoais" e nunca fica
// desencontrado do avatar ao lado.
function nomeDoAutor(artigo) {
  const pessoa = artigo.usuarios;

  if (!pessoa) return "Autor não informado";

  return [pessoa.nome, pessoa.sobrenome].filter(Boolean).join(" ") || "Autor não informado";
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
  const emLista = grade.classList.contains("solucoes-grade--lista");

  const itensNegocio = [];

  artigo.setoresNomes.forEach((s) => itensNegocio.push({ texto: s, icone: ICONE_TAG_SETOR }));

  (artigo.sintomas || []).forEach((s) => s && itensNegocio.push({ texto: s, icone: ICONE_TAG_SINTOMA }));

  const card = document.createElement("div");

  card.className = "solucao-card";
  card.innerHTML = `
    <div class="solucao-card__topo">
      <span class="tipo-pill" style="background-color:${tipoInfo.fundo}; color:${tipoInfo.cor};">
        <svg class="tipo-pill__icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${tipoInfo.icone}</svg>
        ${tipoInfo.label}
      </span>
    </div>

    <h3 class="solucao-card__titulo">${escapar(artigo.titulo || "Sem título")}</h3>
    <p class="solucao-card__descricao">${escapar(artigo.conteudo)}</p>

    ${renderizarLinhaTags(itensNegocio, emLista ? itensNegocio.length : 2)}
    <div class="solucao-card__rodape">
      <span class="solucao-card__avatar" data-avatar-autor></span>
      <span class="solucao-card__autor">${escapar(nomeDoAutor(artigo))}</span>
      <span class="solucao-card__tempo">· Criada em ${formatarData(artigo.criado_em)}</span>
    </div>
  `;

  // Depois do innerHTML: pintarFoto monta uma <img> no elemento, que só
  // existe agora.
  pintarFoto(
    card.querySelector("[data-avatar-autor]"),
    artigo.usuarios?.foto_path,
    iniciaisAutor(nomeDoAutor(artigo)),
    { classeFoto: "solucao-card__avatar-foto" },
  );

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
const painelBaixarBtn = document.getElementById("painel-baixar-pdf");

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
        <span class="painel__campo-label">Setores</span>
        <p class="painel__campo-valor">${escapar(artigo.setoresNomes.join(", ") || "Não informado")}</p>
      </div>
      <div>
        <span class="painel__campo-label">Autor</span>
        <p class="painel__campo-valor">${escapar(nomeDoAutor(artigo))}</p>
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

    ${renderizarSecaoTags("Sintomas e palavras-chave", artigo.sintomas)}    ${renderizarAnexos(artigo.anexos)}
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

//BAIXAR PDF
//Portado do projeto GASO (base de soluções antiga). Monta o documento no
//navegador com jsPDF, sem servidor — o PDF reflete exatamente o que está
//na tela: título, autor/data, código de erro, passo a passo com imagens.
function nomeArquivoPdf(titulo) {
  const base = (titulo || "solucao")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");

  return `${base || "solucao"}.pdf`;
}

async function carregarImagemBase64(url) {
  try {
    const resposta = await fetch(url);

    if (!resposta.ok) throw new Error(`Resposta ${resposta.status}`);

    const blob = await resposta.blob();

    return await new Promise((resolve, reject) => {
      const leitor = new FileReader();

      leitor.onloadend = () => resolve(leitor.result);
      leitor.onerror = () => reject(new Error("Falha ao ler imagem"));
      leitor.readAsDataURL(blob);
    });
  } catch (erro) {
    console.error("Não foi possível carregar imagem para o PDF:", url, erro);
    return null;
  }
}

function medirImagem(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();

    img.onload = () => resolve({ largura: img.naturalWidth || 4, altura: img.naturalHeight || 3 });
    img.onerror = () => resolve({ largura: 4, altura: 3 });
    img.src = dataUrl;
  });
}

function formatoDaDataUrl(dataUrl) {
  const match = /^data:image\/(\w+);base64,/.exec(dataUrl);

  if (!match) return "JPEG";

  const tipo = match[1].toUpperCase();

  return tipo === "JPG" ? "JPEG" : tipo;
}

async function baixarPdfSolucao(artigo) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const margem = 18;
  const larguraUtil = 210 - margem * 2;
  const corMarca = [232, 78, 14];
  const corTexto = [30, 30, 30];
  const corTextoSuave = [120, 120, 120];
  let y = 20;

  function avancar(altura) {
    y += altura;

    if (y > 275) {
      doc.addPage();
      y = 20;
    }
  }

  function garantirEspaco(altura) {
    if (y + altura > 285) {
      doc.addPage();
      y = 20;
    }
  }

  function secaoTitulo(texto) {
    garantirEspaco(12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...corMarca);
    doc.text(texto.toUpperCase(), margem, y);
    avancar(2);
    doc.setDrawColor(...corMarca);
    doc.setLineWidth(0.4);
    doc.line(margem, y, margem + larguraUtil, y);
    avancar(6);
  }

  function paragrafo(texto, tamanho = 10, fonte = "helvetica") {
    if (!texto) return;

    doc.setFont(fonte, "normal");
    doc.setFontSize(tamanho);
    doc.setTextColor(...corTexto);
    doc.splitTextToSize(texto, larguraUtil).forEach((linha) => {
      garantirEspaco(tamanho / 1.8);
      doc.text(linha, margem, y);
      avancar(tamanho / 1.8);
    });
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...corTexto);
  doc.splitTextToSize(artigo.titulo || "Sem título", larguraUtil).forEach((linha) => {
    doc.text(linha, margem, y);
    avancar(8);
  });
  avancar(2);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...corTextoSuave);
  doc.text(`${nomeDoAutor(artigo)}  ·  ${formatarData(artigo.criado_em)}`, margem, y);
  avancar(4);

  doc.setDrawColor(230, 230, 230);
  doc.setLineWidth(0.3);
  doc.line(margem, y, margem + larguraUtil, y);
  avancar(8);

  if (artigo.codigo_erro) {
    secaoTitulo("Código ou mensagem de erro");
    paragrafo(artigo.codigo_erro, 9, "courier");
    avancar(4);
  }

  const passos = artigo.passos || [];

  if (passos.length > 0) {
    secaoTitulo("Passo a passo da solução");

    for (const passo of passos) {
      garantirEspaco(6);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...corMarca);
      doc.text(`${passo.ordem}.`, margem, y);

      doc.setFont("helvetica", "normal");
      doc.setTextColor(...corTexto);

      const linhasTexto = doc.splitTextToSize(passo.texto || "", larguraUtil - 8);

      linhasTexto.forEach((linha, indice) => {
        garantirEspaco(5);
        doc.text(linha, margem + 8, y);
        if (indice < linhasTexto.length - 1) avancar(5);
      });
      avancar(6);

      const imagens = passo.imagens || [];

      if (imagens.length > 0) {
        let x = margem + 8;
        const larguraMaxImg = 150;
        const alturaMaxImg = 130;
        let maiorAlturaLinha = 0;

        for (const imagem of imagens) {
          const dataUrl = await carregarImagemBase64(imagem.url);

          if (!dataUrl) continue;

          const { largura, altura } = await medirImagem(dataUrl);
          let larguraImg = larguraMaxImg;
          let alturaImg = (altura / largura) * larguraImg;

          if (alturaImg > alturaMaxImg) {
            alturaImg = alturaMaxImg;
            larguraImg = (largura / altura) * alturaImg;
          }

          if (x + larguraImg > margem + larguraUtil) {
            x = margem + 8;
            avancar(maiorAlturaLinha + 4);
            maiorAlturaLinha = 0;
          }

          garantirEspaco(alturaImg + 4);

          try {
            doc.addImage(dataUrl, formatoDaDataUrl(dataUrl), x, y, larguraImg, alturaImg);
          } catch (erro) {
            console.error("Não foi possível inserir imagem no PDF:", erro);
          }

          x += larguraImg + 4;
          maiorAlturaLinha = Math.max(maiorAlturaLinha, alturaImg);
        }

        avancar(maiorAlturaLinha + 8);
      } else {
        avancar(4);
      }
    }

    avancar(2);
  }

  doc.save(nomeArquivoPdf(artigo.titulo));
}

painelBaixarBtn.addEventListener("click", async () => {
  if (!artigoAberto) return;

  if (!window.jspdf) {
    console.error("Biblioteca de geração de PDF não carregou.");
    painelErroEl.textContent = "Não foi possível gerar o PDF. Recarregue a página.";
    return;
  }

  const textoOriginal = painelBaixarBtn.textContent;

  painelErroEl.textContent = "";
  painelBaixarBtn.disabled = true;
  painelBaixarBtn.textContent = "Gerando PDF...";

  try {
    await baixarPdfSolucao(artigoAberto);
  } catch (erro) {
    console.error("Erro ao gerar PDF:", erro);
    painelErroEl.textContent = "Não foi possível gerar o PDF.";
  } finally {
    painelBaixarBtn.disabled = false;
    painelBaixarBtn.textContent = textoOriginal;
  }
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
  setor: "Setor",
  autor: "Autor",
  periodo: "Período"
};

function obterFiltrosAtivos() {
  return {
    tipo: filtroTipo.value,
    setor: filtroSetor.value,
    autor: filtroAutor.value,
    periodo: filtroPeriodo.value
  };
}

function rotuloDoFiltro(chave, valor) {
  if (chave === "periodo") return `Período · Últimos ${valor} dias`;
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
    ...artigo.setoresNomes,
    artigo.modulo,
    artigo.codigo_erro,
    ...(Array.isArray(artigo.sintomas) ? artigo.sintomas : [])
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
    if (ativos.setor && !artigo.setoresNomes.includes(ativos.setor)) return false;
    if (ativos.autor && nomeDoAutor(artigo) !== ativos.autor) return false;

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
  // `setores` é uuid[]: não dá junção direta, então os nomes vêm à parte.
  const [{ data, error }, { data: setores }] = await Promise.all([
    supabase
      // O autor vem por junção em autor_id, e não da coluna de texto `autor`:
      // é o que permite mostrar a foto de quem cadastrou (a foto mora no
      // perfil) e o nome sempre atualizado, mesmo que a pessoa se renomeie.
      .from("artigos")
      .select("*, usuarios!artigos_autor_id_fkey(id, nome, sobrenome, foto_path)")
      .eq("ativo", true)
      .order("criado_em", { ascending: false }),
    supabase.from("setores").select("id,nome")
  ]);

  if (error) {
    console.error("Erro ao carregar soluções:", error);
    vazioEl.textContent = "Não foi possível carregar as soluções.";
    vazioEl.hidden = false;
    return;
  }

  const nomeDoSetor = new Map((setores || []).map((s) => [s.id, s.nome]));

  artigosTodos = (data || []).map((artigo) => ({
    ...artigo,
    setoresNomes: (artigo.setores || []).map((id) => nomeDoSetor.get(id)).filter(Boolean).sort()
  }));

  atualizarContagem();
  preencherSelect(filtroAutor, artigosTodos.map(nomeDoAutor));
  preencherSelect(filtroSetor, artigosTodos.flatMap((a) => a.setoresNomes));
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
