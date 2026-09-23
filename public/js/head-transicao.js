// Segunda metade da transicao lateral: marca a pagina que CHEGA antes da
// primeira pintura, para ela ja nascer deslocada para a direita. Sem isto
// ela apareceria um quadro no lugar certo, pularia para a direita e so
// entao deslizaria de volta.
//
// Precisa ser script classico no <head> (nao modulo, que e adiado) pelo
// mesmo motivo do head-preferences.js. Sem inline, por causa da CSP.
try {
  const bruto = sessionStorage.getItem("transicao-lateral");

  if (bruto) {
    // Consome na hora: recarregar a pagina ou voltar pelo historico nao
    // pode reanimar a entrada.
    sessionStorage.removeItem("transicao-lateral");

    const dados = JSON.parse(bruto);
    const recente = Date.now() - dados.ts < 4000;
    const querAnimacao = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (recente && querAnimacao) {
      document.documentElement.dataset.transicao = "entrando";
    }
  }
} catch {
  // Sem sessionStorage ou JSON quebrado: a pagina abre normal, sem transicao.
}
