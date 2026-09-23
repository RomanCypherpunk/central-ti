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
const DURACAO_FAIXA = 330;
const ATRASO_FAIXA = 60;

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

// A FAIXA LARANJA QUE CRESCE. Uma copia da faixa em degrade, em tela
// cheia, recortada para comecar exatamente em cima da original — o CSS
// depois desce a borda de baixo dela ate o pe da tela.
//
// O degrade e copiado do estilo calculado, e nao repetido aqui: a faixa
// tem uma animacao propria de fundo que nunca para (destaque-fundo-respira
// no index.css), entao copiar tambem a posicao atual faz a copia comecar
// no mesmo ponto em que a original esta naquele instante. Repetir o
// degrade neste arquivo daria um salto de cor no primeiro quadro, alem de
// virar duas verdades para manter.
function criarFaixaQueCresce() {
  const faixa = document.querySelector(".destaque");

  if (!faixa) return null;

  const area = faixa.getBoundingClientRect();
  const alturaDaTela = window.innerHeight;

  // Faixa fora da tela (pagina rolada) ou que ja chega no pe dela: nao ha
  // branco para comer, e a copia so atrapalharia.
  if (area.bottom <= 0 || area.bottom >= alturaDaTela - 1) return null;

  const estilo = getComputedStyle(faixa);
  const capa = document.createElement("div");

  capa.className = "transicao-faixa";
  capa.style.backgroundImage = estilo.backgroundImage;
  capa.style.backgroundSize = estilo.backgroundSize;
  capa.style.backgroundPosition = estilo.backgroundPosition;
  capa.style.setProperty("--faixa-topo", `${Math.max(area.top, 0)}px`);
  capa.style.setProperty("--faixa-base", `${alturaDaTela - area.bottom}px`);

  document.body.appendChild(capa);

  return capa;
}

function limparEstado() {
  document.querySelector(".transicao-faixa")?.remove();

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
      const faixa = criarFaixaQueCresce();

      document.documentElement.classList.add("transicao-em-curso");
      document.body.classList.add("transicao-saindo");

      let navegou = false;

      const irEmbora = () => {
        if (navegou) return;
        navegou = true;
        window.location.href = destino;
      };

      // Espera a coreografia inteira, e nao so o primeiro bloco: navegar
      // no primeiro animationend cortaria a saida no meio. Os blocos e a
      // faixa correm em paralelo, entao vale o mais demorado dos dois. A
      // margem cobre o caso de a aba estar em segundo plano, onde a
      // animacao congela e o evento de fim nunca chega.
      const tempoDosBlocos = tempoTotal(DURACAO_SAIR, PASSO_SAIR, quantidade);
      const tempoDaFaixa = faixa ? ATRASO_FAIXA + DURACAO_FAIXA : 0;

      setTimeout(irEmbora, Math.max(tempoDosBlocos, tempoDaFaixa) + 60);
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

// Alem do corpo aparecer, a pagina pode precisar decidir o que mostrar:
// Abrir chamado so sabe se exibe as portas de Cadastro e Desligamento
// depois de consultar o perfil de quem entrou. Comecar antes disso animava
// uma tela pela metade, e as portas restantes surgiam de estalo depois.
//
// Quem precisa dessa espera se declara com [data-conteudo-adiado] no
// <body> (esta no HTML, entao ja vale na primeira pintura) e avisa com
// "central-ti:conteudo-pronto" quando terminar. Quem nao se declara nao
// espera nada — senao toda tela sem esse aviso ficaria vazia ate o teto.
const EVENTO_CONTEUDO = "central-ti:conteudo-pronto";
const ESPERA_CONTEUDO = 900;

function quandoOConteudoEstiverPronto(aoPronto) {
  quandoOCorpoAparecer(() => {
    if (!("conteudoAdiado" in document.body.dataset)) {
      aoPronto();
      return;
    }

    // O aviso pode ter passado antes de chegarmos aqui — por isso a marca
    // no <html>, que fica.
    if ("conteudoPronto" in document.documentElement.dataset) {
      aoPronto();
      return;
    }

    let soltou = false;

    const soltar = () => {
      if (soltou) return;
      soltou = true;
      document.removeEventListener(EVENTO_CONTEUDO, soltar);
      clearTimeout(rede);
      aoPronto();
    };

    document.addEventListener(EVENTO_CONTEUDO, soltar);

    const rede = setTimeout(soltar, ESPERA_CONTEUDO);
  });
}

// Chegada: o <html> ja veio marcado pelo head-transicao.js, entao os
// blocos estao apagados. Aqui eles sao soltos, um atras do outro.
function ligarEntrada() {
  if (document.documentElement.dataset.transicao !== "entrando") return;

  // Nao e preciso esconder nada aqui: o CSS ja apaga os blocos desde a
  // primeira pintura, so pela marca no <html> (ver a regra que lista
  // .saudacao/.porta/.coluna/.equipe em transicao-lateral.css). Este
  // modulo so decide QUANDO soltar e em que ordem.
  quandoOConteudoEstiverPronto(() => {
    // De novo, agora com a tela completa: o que foi revelado nesse meio
    // tempo (as portas de colaborador) entra na fila e recebe o atraso
    // certo. Roda na mesma tarefa do aviso, antes de qualquer pintura,
    // entao a porta revelada nao chega a piscar destapada.
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
