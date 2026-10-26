// TEXTO COM LINKS CLICAVEIS.
//
// Preenche um elemento com o texto da mensagem, transformando URLs em <a>.
// Monta so com textContent/createElement (nunca innerHTML), entao o texto
// do usuario continua sem poder injetar HTML.

const PADRAO_LINK = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
// Pontuacao que costuma vir colada no fim do link ("veja https://x.com.").
const PONTUACAO_FINAL = /[.,;:!?)\]}]+$/;

export function preencherTextoComLinks(elemento, texto) {
  const conteudo = texto ?? "";
  let fim = 0;

  for (const achado of conteudo.matchAll(PADRAO_LINK)) {
    let url = achado[0];
    const sobra = url.match(PONTUACAO_FINAL)?.[0] ?? "";
    if (sobra) url = url.slice(0, -sobra.length);
    if (!url) continue;

    if (achado.index > fim) {
      elemento.append(document.createTextNode(conteudo.slice(fim, achado.index)));
    }

    const link = document.createElement("a");
    link.href = /^www\./i.test(url) ? `https://${url}` : url;
    link.textContent = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "texto-link";
    elemento.append(link);

    fim = achado.index + url.length;
  }

  if (fim < conteudo.length) {
    elemento.append(document.createTextNode(conteudo.slice(fim)));
  }
}
