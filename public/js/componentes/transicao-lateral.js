// Transicao entre paginas: os blocos de conteudo saem e entram em
// sequencia (ver css/transicao-lateral.css para a mecanica da animacao).
//
// Saida: o clique em [data-transicao-lateral] nao navega na hora — os
// blocos escorregam para a esquerda, um atras do outro. Um sinal no
// sessionStorage avisa a pagina de destino para ela entrar na mesma
// cadencia, pela direita.

const CHAVE = "transicao-lateral";

// Os blocos de conteudo das telas, na ordem em que aparecem. E quase a
// mesma lista da animacao de entrada do main.js (ELEMENTOS_ENTRADA), com
// a faixa da equipe a mais — sao os mesmos pedacos que ja sobem com fade
// na primeira visita.
const BLOCOS = ".saudacao, .porta, .coluna, .equipe";

// Precisam bater com o CSS. Se mudar la, mude aqui: o JS usa estes numeros
// para saber quando a coreografia acabou (e navegar, ou limpar a tela).
const DURACAO_SAIR = 220;
const DURACAO_ENTRAR = 420;
const PASSO_SAIR = 50;
const PASSO_ENTRAR = 80;

// Teto de blocos que ganham atraso proprio. Sem isto, uma tela com oito
// blocos acumularia quase meio segundo so de espera antes do ultimo sair.
// Passado o teto, o resto anda junto com o ultimo.
const MAXIMO_DE_PASSOS = 3;

function querMenosMovimento() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// So o que esta realmente na tela. Blocos com [hidden] (as portas de
// colaborador, por exemplo) gastariam um lugar na fila e abririam um
// buraco no meio da sequencia.
function blocosVisiveis() {
  return [...document.querySelectorAll(BLOCOS)].filter((bloco) => bloco.offsetParent !== null);
}

function marcarBlocos(passo) {
  const blocos = blocosVisiveis();

  blocos.forEach((bloco, indice) => {
    bloco.dataset.transicaoBloco = "";
    bloco.style.setProperty(
      "--transicao-atraso",
      `${Math.min(indice, MAXIMO_DE_PASSOS) * passo}ms`,
    );
  });

  return blocos.length;
}

function tempoTotal(duracao, passo, quantidade) {
  const ultimo = Math.min(Math.max(quantidade - 1, 0), MAXIMO_DE_PASSOS);

  return duracao + ultimo * passo;
}

function limparEstado() {
  document.body.classList.remove("transicao-entrando", "transicao-saindo");
  document.documentElement.classList.remove("transicao-em-curso");
  delete document.documentElement.dataset.transicao;

  // O transform de cada bloco vira bloco de contencao para position:fixed
  // dentro dele. Nada pode sobrar depois que a animacao acaba.
  document.querySelectorAll("[data-transicao-bloco]").forEach((bloco) => {
    delete bloco.dataset.transicaoBloco;
    bloco.style.removeProperty("--transicao-atraso");
  });
}

function ligarSaida() {
  document.querySelectorAll("[data-transicao-lateral]").forEach((gatilho) => {
    gatilho.addEventListener("click", (evento) => {
      const destino = gatilho.getAttribute("href");

      if (!destino) return;

      // Ctrl/Cmd/Shift/Alt ou botao do meio: a pessoa quer abrir em outra
      // aba ou janela. Interceptar aqui roubaria esse comportamento.
      if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
      if (evento.button !== 0) return;
      if (querMenosMovimento()) return;

      evento.preventDefault();

      try {
        sessionStorage.setItem(CHAVE, JSON.stringify({ ts: Date.now() }));
      } catch {
        // Sem sessionStorage a pagina de destino abre sem a entrada: a
        // saida continua acontecendo, so a chegada e que e seca.
      }

      const quantidade = marcarBlocos(PASSO_SAIR);

      document.documentElement.classList.add("transicao-em-curso");
      document.body.classList.add("transicao-saindo");

      let navegou = false;

      const irEmbora = () => {
        if (navegou) return;
        navegou = true;
        window.location.href = destino;
      };

      // Espera a coreografia inteira, e nao so o primeiro bloco: navegar
      // no primeiro animationend cortaria a saida no meio. A margem cobre
      // o caso de a aba estar em segundo plano, onde a animacao congela e
      // o evento de fim nunca chega.
      setTimeout(irEmbora, tempoTotal(DURACAO_SAIR, PASSO_SAIR, quantidade) + 60);
    });
  });
}

// O guard.js so torna o <body> visivel depois de conferir a sessao no
// servidor. Comecar a entrada antes disso gastaria a animacao com a tela
// ainda invisivel — a pessoa veria tudo aparecer de uma vez, ja parado.
function quandoOCorpoAparecer(aoAparecer) {
  const visivel = () => getComputedStyle(document.body).visibility !== "hidden";

  if (visivel()) {
    aoAparecer();
    return;
  }

  const observador = new MutationObserver(() => {
    if (!visivel()) return;

    observador.disconnect();
    clearTimeout(rede);
    aoAparecer();
  });

  observador.observe(document.body, { attributes: true, attributeFilter: ["style"] });

  // Rede de seguranca: sessao expirada, rede caida, qualquer coisa que
  // impeca o guard de liberar o corpo. Passado o teto, solta do mesmo jeito
  // — a pagina nao pode ficar presa apagada.
  const rede = setTimeout(() => {
    observador.disconnect();
    aoAparecer();
  }, 2000);
}

// Chegada: o <html> ja veio marcado pelo head-transicao.js, entao os
// blocos estao apagados. Aqui eles sao soltos, um atras do outro.
function ligarEntrada() {
  if (document.documentElement.dataset.transicao !== "entrando") return;

  quandoOCorpoAparecer(() => {
    const quantidade = marcarBlocos(PASSO_ENTRAR);

    document.body.classList.add("transicao-entrando");
    setTimeout(limparEstado, tempoTotal(DURACAO_ENTRAR, PASSO_ENTRAR, quantidade) + 200);
  });
}

export function ligarTransicaoLateral() {
  ligarSaida();
  ligarEntrada();

  // Voltar pelo historico pode restaurar a pagina do cache no meio da
  // animacao (a navegacao foi cancelada). Sem isto ela voltaria com os
  // blocos apagados.
  window.addEventListener("pageshow", (evento) => {
    if (evento.persisted) limparEstado();
  });
}
