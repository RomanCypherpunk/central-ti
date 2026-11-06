// ZOOM COM JANELA ABERTA.
//
// Com um card (ou qualquer <dialog>) aberto, Ctrl + roda, a pinça do
// touchpad e Ctrl + / Ctrl - / Ctrl 0 nao podem aumentar a pagina nem o
// quadro que esta por baixo. Sem nenhuma janela aberta, tudo segue normal
// (zoom do navegador, ou o zoom proprio do quadro no Portal).
//
// No visualizador de imagem o zoom vai para a imagem: roda (com ou sem
// Ctrl) e pinça aumentam no ponto do mouse, arrastar move a imagem
// aumentada, duplo clique alterna entre 1x e 2x, Ctrl 0 volta ao tamanho
// normal.

const ZOOM_IMAGEM_MINIMO = 1;
const ZOOM_IMAGEM_MAXIMO = 6;

function janelaAberta() {
  return document.querySelector("dialog[open]");
}

function ehTeclaDeZoom(evento) {
  if (!(evento.ctrlKey || evento.metaKey)) return null;
  if (evento.key === "+" || evento.key === "=" || evento.code === "NumpadAdd") return "mais";
  if (evento.key === "-" || evento.key === "_" || evento.code === "NumpadSubtract") return "menos";
  if (evento.key === "0" || evento.code === "Numpad0") return "zerar";
  return null;
}

let travaLigada = false;

// Captura na janela: roda antes do zoom do quadro (portal.js) e do
// navegador. passive: false e o que deixa o preventDefault valer na roda.
export function travarZoomComJanelaAberta() {
  if (travaLigada) return;
  travaLigada = true;

  window.addEventListener("wheel", (evento) => {
    if (!evento.ctrlKey || !janelaAberta()) return;

    evento.preventDefault();
    // O visualizador trata a propria roda; o resto (quadro) nao recebe.
    if (!evento.target.closest?.("[data-visualizador]")) evento.stopPropagation();
  }, { passive: false, capture: true });

  window.addEventListener("keydown", (evento) => {
    if (!ehTeclaDeZoom(evento) || !janelaAberta()) return;
    evento.preventDefault();
  }, { capture: true });
}

// Liga o zoom dentro do visualizador. Devolve zerar(), para quem abre uma
// imagem nova comecar sempre do tamanho normal.
export function ligarZoomDaImagem(visualizador, imagem) {
  travarZoomComJanelaAberta();

  let escala = 1;
  let x = 0;
  let y = 0;
  let arrasto = null;
  let arrastou = false;

  function desenhar() {
    imagem.style.transform = escala === 1 ? "" : `translate(${x}px, ${y}px) scale(${escala})`;
    visualizador.classList.toggle("visualizador--ampliado", escala > 1);
  }

  function zerar() {
    escala = 1;
    x = 0;
    y = 0;
    desenhar();
  }

  // Zoom do Portal (CSS zoom no .portal) tambem escala o dialog: os pixels
  // da tela viram pixels do elemento dividindo por este fator.
  function fatorDaTela() {
    const largura = imagem.offsetWidth * escala;
    return largura ? imagem.getBoundingClientRect().width / largura : 1;
  }

  // Aumenta mantendo parado o ponto que esta embaixo do mouse.
  function aplicarEscala(nova, telaX, telaY) {
    nova = Math.min(ZOOM_IMAGEM_MAXIMO, Math.max(ZOOM_IMAGEM_MINIMO, nova));
    if (nova === escala) return;

    if (nova === 1) {
      zerar();
      return;
    }

    const caixa = imagem.getBoundingClientRect();
    const fator = fatorDaTela();
    const pontoX = telaX ?? caixa.left + caixa.width / 2;
    const pontoY = telaY ?? caixa.top + caixa.height / 2;
    const proporcao = 1 - nova / escala;

    x += ((pontoX - caixa.left) / fator) * proporcao;
    y += ((pontoY - caixa.top) / fator) * proporcao;
    escala = nova;
    desenhar();
  }

  imagem.style.transformOrigin = "0 0";

  visualizador.addEventListener("wheel", (evento) => {
    evento.preventDefault();
    evento.stopPropagation();
    // Pinça do touchpad manda deltas pequenos e muitos; roda do mouse manda
    // ~100 por clique. A exponencial deixa os dois suaves.
    const pinca = evento.ctrlKey && Math.abs(evento.deltaY) < 50;
    const passo = Math.exp(-evento.deltaY * (pinca ? 0.01 : 0.0025));
    aplicarEscala(escala * passo, evento.clientX, evento.clientY);
  }, { passive: false });

  visualizador.addEventListener("keydown", (evento) => {
    const tecla = ehTeclaDeZoom(evento);
    if (!tecla) return;

    evento.preventDefault();
    if (tecla === "mais") aplicarEscala(escala * 1.25);
    if (tecla === "menos") aplicarEscala(escala / 1.25);
    if (tecla === "zerar") zerar();
  });

  imagem.addEventListener("dblclick", (evento) => {
    if (escala > 1) zerar();
    else aplicarEscala(2, evento.clientX, evento.clientY);
  });

  // ARRASTAR A IMAGEM AUMENTADA
  imagem.addEventListener("pointerdown", (evento) => {
    if (escala === 1 || evento.button !== 0) return;

    evento.preventDefault();
    imagem.setPointerCapture(evento.pointerId);
    arrasto = { id: evento.pointerId, ultimoX: evento.clientX, ultimoY: evento.clientY, fator: fatorDaTela() };
    arrastou = false;
    visualizador.classList.add("visualizador--arrastando");
  });

  imagem.addEventListener("pointermove", (evento) => {
    if (!arrasto || evento.pointerId !== arrasto.id) return;

    const dx = evento.clientX - arrasto.ultimoX;
    const dy = evento.clientY - arrasto.ultimoY;
    if (Math.abs(dx) + Math.abs(dy) > 0) arrastou = true;

    x += dx / arrasto.fator;
    y += dy / arrasto.fator;
    arrasto.ultimoX = evento.clientX;
    arrasto.ultimoY = evento.clientY;
    desenhar();
  });

  function soltar(evento) {
    if (!arrasto || evento.pointerId !== arrasto.id) return;
    arrasto = null;
    visualizador.classList.remove("visualizador--arrastando");
  }

  imagem.addEventListener("pointerup", soltar);
  imagem.addEventListener("pointercancel", soltar);

  // Soltar o arrasto fora da imagem gera um clique no fundo, que fecharia o
  // visualizador. Esse clique e engolido.
  visualizador.addEventListener("click", (evento) => {
    if (!arrastou) return;
    arrastou = false;
    evento.stopImmediatePropagation();
  }, { capture: true });

  visualizador.addEventListener("close", zerar);

  return { zerar };
}
