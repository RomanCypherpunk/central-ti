// Portal de Chamados: quadro kanban da equipe de TI — Fase 4.

import { supabase } from "../config/supabase-config.js";

const quadro = document.querySelector("[data-quadro]");
const resumo = document.querySelector("[data-resumo]");
const erro = document.querySelector("[data-erro]");

//TEMA: SO DESTA TELA, POR ISSO MORA AQUI E NAO NO main.js COMPARTILHADO.
//A chave tambem e propria ("tema-portal") para nao ligar o escuro nas
//outras paginas, que continuam so no claro.
function ligarTema() {
  const botao = document.querySelector("[data-tema-alternar]");

  function aplicar(tema) {
    document.documentElement.dataset.tema = tema;
    localStorage.setItem("tema-portal", tema);

    const escuro = tema === "escuro";
    botao.setAttribute("aria-pressed", escuro);
    botao.setAttribute(
      "aria-label",
      escuro ? "Ativar tema claro" : "Ativar tema escuro",
    );
  }

  botao.addEventListener("click", () => {
    const atual = document.documentElement.dataset.tema;
    aplicar(atual === "escuro" ? "claro" : "escuro");
  });

  // O <head> ja pintou o tema salvo; aqui so acerta o estado do botao.
  aplicar(document.documentElement.dataset.tema ?? "claro");
}

ligarTema();

//ZOOM: SO O QUADRO (<main class="portal">), NUNCA O TOPO. O zoom do CSS
//escala tudo que esta dentro dele; a escolha fica salva neste navegador,
//com chave propria, como o tema.
const ZOOM_MINIMO = 0.5;
const ZOOM_MAXIMO = 1.5;
const ZOOM_PASSO_BOTAO = 0.1;
// A roda (e a pinca do touchpad, que chega como Ctrl + roda) vem em muitos
// eventos seguidos: passo menor para o zoom andar suave, sem saltos.
const ZOOM_PASSO_RODA = 0.05;

function ligarZoom() {
  const caixa = document.querySelector("[data-zoom]");
  const abrir = document.querySelector("[data-zoom-abrir]");
  const painel = document.querySelector("[data-zoom-painel]");
  const valor = document.querySelector("[data-zoom-valor]");
  const slider = document.querySelector("[data-zoom-slider]");
  const menos = document.querySelector("[data-zoom-menos]");
  const mais = document.querySelector("[data-zoom-mais]");
  const redefinir = document.querySelector("[data-zoom-redefinir]");
  const portal = document.querySelector(".portal");

  function atual() {
    const salvo = getComputedStyle(document.documentElement).getPropertyValue("--zoom-portal");

    return Number(salvo) || 1;
  }

  function aplicar(zoom) {
    // Arredonda de 5 em 5%: somar 0.1 repetidas vezes da 0.7999...
    const ajustado = Math.min(ZOOM_MAXIMO, Math.max(ZOOM_MINIMO, Math.round(zoom * 20) / 20));
    const porcento = Math.round(ajustado * 100);

    document.documentElement.style.setProperty("--zoom-portal", ajustado);
    localStorage.setItem("zoom-portal", ajustado);

    valor.textContent = `${porcento}%`;
    slider.value = porcento;
    // Faixa de 50 a 150: a parte pintada do trilho e (valor - 50)%.
    slider.style.setProperty("--preenchido", `${porcento - 50}%`);
    menos.disabled = ajustado <= ZOOM_MINIMO;
    mais.disabled = ajustado >= ZOOM_MAXIMO;
    redefinir.disabled = porcento === 100;

    // A barra de rolagem propria mede o quadro: em outro zoom, redesenha.
    window.dispatchEvent(new Event("resize"));
  }

  function mostrarPainel(aberto) {
    painel.classList.toggle("zoom__painel--aberto", aberto);
    abrir.setAttribute("aria-expanded", String(aberto));
  }

  abrir.addEventListener("click", () => {
    mostrarPainel(!painel.classList.contains("zoom__painel--aberto"));
  });

  // input, e nao change: o quadro acompanha a bolinha enquanto ela e arrastada.
  slider.addEventListener("input", () => aplicar(Number(slider.value) / 100));
  menos.addEventListener("click", () => aplicar(atual() - ZOOM_PASSO_BOTAO));
  mais.addEventListener("click", () => aplicar(atual() + ZOOM_PASSO_BOTAO));
  redefinir.addEventListener("click", () => aplicar(1));

  // Clique fora fecha, como o menu do perfil.
  document.addEventListener("click", (evento) => {
    if (!caixa.contains(evento.target)) mostrarPainel(false);
  });

  document.addEventListener("keydown", (evento) => {
    if (evento.key !== "Escape" || !painel.classList.contains("zoom__painel--aberto")) return;

    mostrarPainel(false);
    abrir.focus();
  });

  // CTRL + RODA SOBRE O QUADRO: o preventDefault segura o zoom do navegador
  // (que aumentaria o topo junto) e aplica so no quadro. passive: false e o
  // que permite o preventDefault num evento de roda.
  portal.addEventListener("wheel", (evento) => {
    if (!evento.ctrlKey) return;

    evento.preventDefault();
    aplicar(atual() + (evento.deltaY < 0 ? ZOOM_PASSO_RODA : -ZOOM_PASSO_RODA));
  }, { passive: false });

  // O <head> ja aplicou o zoom salvo; aqui so acerta o numero, o slider e os limites.
  aplicar(atual());
}

ligarZoom();

//Com zoom, clientX vem em pixels da tela, mas scrollLeft e clientWidth vem
//em pixels do quadro. Quem soma um no outro divide pelo zoom, senao o quadro
//corre mais (ou menos) que o mouse.
function zoomDoQuadro() {
  return quadro.getBoundingClientRect().width / quadro.offsetWidth || 1;
}

function mostrarErro(mensagem) {
  erro.textContent = mensagem;
  erro.classList.add("portal__erro--visivel");
}

//SO A EQUIPE DE TI ATENDE CHAMADOS. O RLS JA PROTEGE OS DADOS; ISSO EVITA
//DEIXAR UM SOLICITANTE OLHANDO UM QUADRO QUE NUNCA VAI TER NADA PRA ELE.
//Devolve o id de quem esta logado se for admin, ou null se nao for —
//o id e usado depois como autor das mensagens.
//O atalho no menu do perfil segue a mesma regra; aqui e o que vale de
//verdade, porque esconder link nao impede ninguem de digitar a URL.
async function quemEstaAtendendo() {
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: perfil } = await supabase
    .from("usuarios")
    .select("perfil")
    .eq("id", user.id)
    .single();

  return perfil?.perfil === "admin" ? user.id : null;
}

//O STATUS NAO E UMA COLUNA: VEM DE QUEM FALOU POR ULTIMO NO CHAMADO.
//So conta conversa de verdade — nota interna entre a equipe e mensagem
//automatica de abertura nao mudam o status.
function derivarStatus(chamado) {
  if (chamado.fechamento_em) {
    return { chave: "fechado", rotulo: "Fechado" };
  }

  const publicos = chamado.comentarios
    .filter((comentario) => comentario.visibilidade === "publico" && comentario.tipo === "humano")
    .sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));

  const ultimo = publicos[publicos.length - 1];

  if (!ultimo) {
    return { chave: "aberto", rotulo: "Aberto" };
  }

  // O solicitante e o dono do chamado; qualquer outro autor e a equipe.
  return ultimo.autor_id === chamado.solicitante_id
    ? { chave: "respondeu", rotulo: "Usuário respondeu" }
    : { chave: "aguardando", rotulo: "Aguardando retorno" };
}

//O banco guarda nome e sobrenome separados. No quadro aparece so o nome —
//e o que o analista precisa para reconhecer quem esta no card.
function primeiroNome(pessoa) {
  return pessoa?.nome ?? "Alguém";
}

//Nome completo: para identificar a pessoa sem ambiguidade (detalhe do
//chamado) e para a busca achar por sobrenome.
function nomeCompleto(pessoa) {
  if (!pessoa?.nome) return null;

  return [pessoa.nome, pessoa.sobrenome].filter(Boolean).join(" ");
}

function iniciais(nome, sobrenome) {
  const primeira = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  const ultima = (sobrenome ?? "").trim().split(/\s+/).pop() ?? "";

  return (primeira[0] ?? "").concat(ultima[0] ?? "").toUpperCase();
}

//O titulo e do banco; chamados antigos sem titulo caem no formato padrao.
function tituloDoChamado(chamado) {
  return chamado.titulo
    ?? `${chamado.categorias?.nome ?? "Sem categoria"} | Ticket-${chamado.numero}`;
}

function formatarData(iso) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

//AVATAR DA CONVERSA: A FOTO E A QUE A PESSOA ENVIOU EM "Dados pessoais".
//Sem foto, ficam as iniciais.
//classe: qual estilo de avatar usar — o balao do chat e o circulo do card
//tem tamanhos diferentes, mas os dois mostram a mesma foto de perfil.
function montarAvatar(pessoa, fotoPath, classe = "comentario__avatar") {
  const avatar = document.createElement("span");
  avatar.className = classe;
  avatar.textContent = iniciais(pessoa?.nome, pessoa?.sobrenome);
  // O balao mostra so o primeiro nome; o completo fica no title, ao passar o mouse.
  avatar.title = nomeCompleto(pessoa) ?? "Alguém";

  if (!fotoPath) return avatar;

  const { data } = supabase.storage.from("avatares").getPublicUrl(fotoPath);

  const foto = document.createElement("img");
  foto.src = data.publicUrl;
  foto.alt = "";
  foto.loading = "lazy";
  // Se o arquivo sumiu, a imagem sai e as iniciais que ja estao ali reaparecem.
  foto.addEventListener("error", () => foto.remove());
  foto.addEventListener("load", () => { avatar.textContent = ""; avatar.appendChild(foto); });

  avatar.appendChild(foto);

  return avatar;
}

//COR DE DESTAQUE: A COR QUE A PESSOA ESCOLHEU (usuarios.cor_destaque) VIRA
//UM FUNDO CLARO DO COMECO DA FOTO ATE O FIM DO NOME. Recebe o elemento que
//envolve foto e nome. Sem cor, sem fundo. O data-usuario deixa trocar a cor
//em todos os lugares da tela de uma vez, sem redesenhar o quadro.
function aplicarCorDestaque(elemento, pessoa) {
  elemento.dataset.usuario = pessoa.id ?? "";
  elemento.classList.toggle("membro--destaque", Boolean(pessoa.cor_destaque));

  if (pessoa.cor_destaque) {
    elemento.style.setProperty("--cor-destaque", pessoa.cor_destaque);
  } else {
    elemento.style.removeProperty("--cor-destaque");
  }
}

//Cores oferecidas no detalhe do chamado. Todas fortes o bastante para o anel
//aparecer tanto no card claro quanto no escuro.
const CORES_DESTAQUE = [
  { nome: "Laranja", valor: "#dd5b12" },
  { nome: "Vermelho", valor: "#d64545" },
  { nome: "Rosa", valor: "#d6457f" },
  { nome: "Roxo", valor: "#7c5cf0" },
  { nome: "Azul", valor: "#2c6fd6" },
  { nome: "Ciano", valor: "#0f9bb3" },
  { nome: "Verde", valor: "#2f9e44" },
  { nome: "Amarelo", valor: "#d19a0a" },
];

//RODAPE DO CARD: QUEM ESTA ATENDENDO. Foto maior e o primeiro nome ao lado,
//para dar para saber de quem e o ticket sem abrir. Usado ao montar o card e
//ao atualiza-lo depois de uma edicao no detalhe, para os dois sairem iguais.
function desenharMembrosDoCard(container, chamadoMembros) {
  container.replaceChildren();

  chamadoMembros.forEach((membro) => {
    const pessoa = membro.usuarios;

    if (!pessoa?.nome) return;

    const chip = document.createElement("span");
    chip.className = "card__membro-chip";

    // Mesma foto que aparece no balao do chat quando essa pessoa responde.
    const avatar = montarAvatar(pessoa, pessoa.foto_path, "card__membro");
    aplicarCorDestaque(chip, pessoa);

    const nome = document.createElement("span");
    nome.className = "card__membro-nome";
    nome.textContent = primeiroNome(pessoa);

    chip.append(avatar, nome);
    container.appendChild(chip);
  });
}

function montarCard(chamado) {
  const card = document.createElement("li");
  card.className = "card";
  card.draggable = true;
  card.dataset.chamado = chamado.id;
  card.dataset.fila = chamado.fila_id;

  //ETIQUETAS: TODO CARD TEM UMA PRIORIDADE. SEM FLAG MARCADA, E NORMAL.
  const etiquetas = document.createElement("div");
  etiquetas.className = "card__etiquetas";

  if (chamado.eh_urgente) {
    const urgente = document.createElement("span");
    urgente.className = "card__etiqueta card__etiqueta--urgente";
    urgente.textContent = "Urgente";
    etiquetas.appendChild(urgente);
  }

  if (chamado.eh_prioridade) {
    const prioridade = document.createElement("span");
    prioridade.className = "card__etiqueta card__etiqueta--prioridade";
    prioridade.textContent = "Prioridade";
    etiquetas.appendChild(prioridade);
  }

  if (!etiquetas.children.length) {
    const normal = document.createElement("span");
    normal.className = "card__etiqueta card__etiqueta--normal";
    normal.textContent = "Normal";
    etiquetas.appendChild(normal);
  }

  card.appendChild(etiquetas);

  //TITULO: VEM DO BANCO, QUE NASCE COMO "CATEGORIA | TICKET-N" E DEPOIS
  //PODE SER EDITADO NO DETALHE.
  const titulo = document.createElement("p");
  titulo.className = "card__titulo";
  titulo.dataset.titulo = "";
  titulo.textContent = tituloDoChamado(chamado);
  card.appendChild(titulo);

  //STATUS
  const status = derivarStatus(chamado);
  const selo = document.createElement("span");
  selo.className = `card__status card__status--${status.chave}`;
  selo.textContent = status.rotulo;
  card.appendChild(selo);

  //MEMBROS
  const membros = document.createElement("div");
  membros.className = "card__membros";
  desenharMembrosDoCard(membros, chamado.chamado_membros);
  card.appendChild(membros);

  return card;
}

function montarFila(fila, chamados) {
  const coluna = document.createElement("section");
  coluna.className = "fila";
  coluna.dataset.fila = fila.id;

  const topo = document.createElement("header");
  topo.className = "fila__topo";

  const nome = document.createElement("h2");
  nome.className = "fila__nome";
  nome.textContent = fila.nome;

  const contador = document.createElement("span");
  contador.className = "fila__contador";
  contador.textContent = chamados.length;

  topo.append(nome, contador);
  coluna.appendChild(topo);

  const lista = document.createElement("ul");
  lista.className = "fila__cards";

  if (chamados.length) {
    chamados.forEach((chamado) => lista.appendChild(montarCard(chamado)));
  } else {
    const vazia = document.createElement("li");
    vazia.className = "fila__vazia";
    vazia.textContent = "Nenhum chamado";
    lista.appendChild(vazia);
  }

  coluna.appendChild(lista);

  return coluna;
}

//ATUALIZA O CONTADOR E O AVISO DE VAZIO DE UMA COLUNA DEPOIS DE MOVER UM CARD
function sincronizarColuna(coluna) {
  const lista = coluna.querySelector(".fila__cards");
  const cards = lista.querySelectorAll(".card");
  const vazia = lista.querySelector(".fila__vazia");

  coluna.querySelector(".fila__contador").textContent = cards.length;

  if (cards.length && vazia) {
    vazia.remove();
  }

  if (!cards.length && !vazia) {
    const aviso = document.createElement("li");
    aviso.className = "fila__vazia";
    aviso.textContent = "Nenhum chamado";
    lista.appendChild(aviso);
  }
}

//ARRASTAR PERTO DA BORDA PUXA O QUADRO: SEM ISSO NAO DA PRA LEVAR UM CARD
//ATE UMA FILA QUE ESTA FORA DA TELA.
const MARGEM_AUTOSCROLL = 140;
const VELOCIDADE_AUTOSCROLL = 55;

let autoScroll = null;

function pararAutoScroll() {
  if (autoScroll === null) return;

  cancelAnimationFrame(autoScroll);
  autoScroll = null;
}

function avaliarAutoScroll(x) {
  const area = quadro.getBoundingClientRect();
  // Ja comeca com boa parte da velocidade assim que entra na zona da borda,
  // em vez de arrastar devagar ate chegar bem na beirada.
  const forca = (distancia) => 0.35 + 0.65 * (distancia / MARGEM_AUTOSCROLL);
  let passo = 0;

  if (x < area.left + MARGEM_AUTOSCROLL) {
    passo = -VELOCIDADE_AUTOSCROLL * forca(area.left + MARGEM_AUTOSCROLL - x);
  } else if (x > area.right - MARGEM_AUTOSCROLL) {
    passo = VELOCIDADE_AUTOSCROLL * forca(x - (area.right - MARGEM_AUTOSCROLL));
  }

  if (!passo) {
    pararAutoScroll();
    return;
  }

  if (autoScroll !== null) return;

  const rolar = () => {
    quadro.scrollLeft += passo;
    autoScroll = requestAnimationFrame(rolar);
  };

  autoScroll = requestAnimationFrame(rolar);
}

//ARRASTAR E SOLTAR: MOVE O CARD NA HORA E DESFAZ SE O BANCO RECUSAR
function ligarArrastar() {
  let cardArrastado = null;

  quadro.addEventListener("dragstart", (evento) => {
    const card = evento.target.closest(".card");

    if (!card) return;

    cardArrastado = card;
    card.classList.add("card--arrastando");
    evento.dataTransfer.effectAllowed = "move";
  });

  quadro.addEventListener("dragend", () => {
    cardArrastado?.classList.remove("card--arrastando");
    quadro.querySelectorAll(".fila--alvo")
      .forEach((coluna) => coluna.classList.remove("fila--alvo"));
    cardArrastado = null;
    pararAutoScroll();
  });

  quadro.addEventListener("dragover", (evento) => {
    if (!cardArrastado) return;

    // Sem o preventDefault o navegador nao considera a area como alvo valido.
    evento.preventDefault();
    evento.dataTransfer.dropEffect = "move";
    avaliarAutoScroll(evento.clientX);

    const coluna = evento.target.closest(".fila");

    if (!coluna) return;

    quadro.querySelectorAll(".fila--alvo")
      .forEach((outra) => outra.classList.remove("fila--alvo"));
    coluna.classList.add("fila--alvo");
  });

  quadro.addEventListener("drop", async (evento) => {
    pararAutoScroll();

    const coluna = evento.target.closest(".fila");

    if (!coluna || !cardArrastado) return;

    evento.preventDefault();

    const card = cardArrastado;
    const filaDestino = coluna.dataset.fila;
    const filaOrigem = card.dataset.fila;

    if (filaDestino === filaOrigem) return;

    const colunaOrigem = quadro.querySelector(`.fila[data-fila="${filaOrigem}"]`);

    // Move na hora: a tela responde antes do banco confirmar.
    coluna.querySelector(".fila__cards").appendChild(card);
    card.dataset.fila = filaDestino;
    sincronizarColuna(coluna);
    sincronizarColuna(colunaOrigem);

    const { error } = await supabase
      .from("chamados")
      .update({ fila_id: filaDestino, fila_anterior_id: filaOrigem })
      .eq("id", card.dataset.chamado);

    if (!error) return;

    // Banco recusou: devolve o card para onde estava.
    colunaOrigem.querySelector(".fila__cards").appendChild(card);
    card.dataset.fila = filaOrigem;
    sincronizarColuna(coluna);
    sincronizarColuna(colunaOrigem);
    mostrarErro("Não foi possível mover o chamado. Tente novamente.");
  });
}

//SEGURAR O FUNDO E PUXAR ROLA O QUADRO, COMO NO TRELLO. SO PEGA NO VAZIO:
//em cima de um card manda o arrastar-e-soltar, nao o pan.
function ligarArrastoDoFundo() {
  let puxando = false;
  let inicioX = 0;
  let inicioScroll = 0;
  let zoom = 1;

  quadro.addEventListener("pointerdown", (evento) => {
    if (evento.button !== 0) return;
    if (evento.target.closest(".card")) return;

    puxando = true;
    inicioX = evento.clientX;
    inicioScroll = quadro.scrollLeft;
    zoom = zoomDoQuadro();
    quadro.classList.add("portal__quadro--puxando");

    // Segue o ponteiro mesmo se ele sair do quadro no meio do movimento.
    quadro.setPointerCapture?.(evento.pointerId);
  });

  quadro.addEventListener("pointermove", (evento) => {
    if (!puxando) return;

    quadro.scrollLeft = inicioScroll - (evento.clientX - inicioX) / zoom;
  });

  function soltar(evento) {
    if (!puxando) return;

    puxando = false;
    quadro.classList.remove("portal__quadro--puxando");

    if (quadro.hasPointerCapture?.(evento.pointerId)) {
      quadro.releasePointerCapture(evento.pointerId);
    }
  }

  quadro.addEventListener("pointerup", soltar);
  quadro.addEventListener("pointercancel", soltar);
  // Soltar o botao fora do quadro tambem encerra o arrasto.
  document.addEventListener("pointerup", soltar);
}

//BARRA DE ROLAGEM PROPRIA: A NATIVA FICA ONDE A AREA DE ROLAGEM TERMINA,
//NO MEIO DA TELA. ESTA FICA COLADA NO RODAPE, DE FORA A FORA.
function ligarBarra() {
  const barra = document.querySelector("[data-barra]");
  const alca = document.querySelector("[data-alca]");

  function desenhar() {
    const transbordo = quadro.scrollWidth - quadro.clientWidth;

    barra.classList.toggle("portal__barra--visivel", transbordo > 1);

    if (transbordo <= 1) return;

    const proporcao = quadro.clientWidth / quadro.scrollWidth;
    const trilho = barra.querySelector(".portal__barra-trilho").clientWidth;
    const largura = Math.max(trilho * proporcao, 40);

    alca.style.width = `${largura}px`;
    alca.style.left = `${(quadro.scrollLeft / transbordo) * (trilho - largura)}px`;
  }

  //ARRASTAR A ALCA ROLA O QUADRO
  function aoArrastar(eventoInicial) {
    eventoInicial.preventDefault();
    alca.classList.add("portal__barra-alca--arrastando");

    const trilho = barra.querySelector(".portal__barra-trilho").clientWidth;
    const inicioX = eventoInicial.clientX;
    const inicioScroll = quadro.scrollLeft;
    const transbordo = quadro.scrollWidth - quadro.clientWidth;
    const curso = trilho - alca.clientWidth;
    const zoom = zoomDoQuadro();

    function mover(evento) {
      quadro.scrollLeft = inicioScroll + ((evento.clientX - inicioX) / zoom / curso) * transbordo;
    }

    function soltar() {
      alca.classList.remove("portal__barra-alca--arrastando");
      document.removeEventListener("pointermove", mover);
      document.removeEventListener("pointerup", soltar);
    }

    document.addEventListener("pointermove", mover);
    document.addEventListener("pointerup", soltar);
  }

  alca.addEventListener("pointerdown", aoArrastar);

  //CLIQUE NO TRILHO PULA PARA AQUELE PONTO
  barra.addEventListener("pointerdown", (evento) => {
    if (evento.target === alca) return;

    const trilho = barra.querySelector(".portal__barra-trilho");
    const area = trilho.getBoundingClientRect();
    const alvo = (evento.clientX - area.left) / area.width;

    quadro.scrollLeft = alvo * (quadro.scrollWidth - quadro.clientWidth);
  });

  quadro.addEventListener("scroll", desenhar);
  window.addEventListener("resize", desenhar);
  desenhar();
}

//BUSCA: TICKET, SOLICITANTE, UNIDADE, CATEGORIA OU DESCRICAO
function ligarBusca(chamados, filas, detalhe) {
  const campo = document.querySelector("[data-busca]");
  const painel = document.querySelector("[data-resultados]");
  const nomeDaFila = new Map(filas.map((fila) => [fila.id, fila.nome]));

  function fechar() {
    painel.hidden = true;
    painel.replaceChildren();
  }

  function irAteOCard(chamado) {
    const card = quadro.querySelector(`[data-chamado="${chamado.id}"]`);

    if (!card) return;

    card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });

    quadro.querySelectorAll(".card--destacado")
      .forEach((outro) => outro.classList.remove("card--destacado"));
    card.classList.add("card--destacado");

    setTimeout(() => card.classList.remove("card--destacado"), 2200);
  }

  function montarResultado(chamado) {
    const item = document.createElement("button");
    item.className = "busca__item";
    item.type = "button";

    const icone = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icone.setAttribute("class", "busca__item-icone");
    icone.setAttribute("viewBox", "0 0 24 24");
    icone.setAttribute("width", "13");
    icone.setAttribute("height", "13");
    icone.innerHTML = '<rect x="3.5" y="5" width="17" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7.5 9.5h9M7.5 13h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>';

    const texto = document.createElement("span");
    texto.className = "busca__item-texto";

    const titulo = document.createElement("span");
    titulo.className = "busca__item-titulo";
    titulo.textContent = `${chamado.categorias?.nome ?? "Sem categoria"} | Ticket-${chamado.numero}`;

    const contexto = document.createElement("span");
    contexto.className = "busca__item-contexto";
    contexto.textContent = [
      // Finalizado nao esta em nenhuma fila do quadro; dizer isso aqui
      // evita a pessoa estranhar o clique nao rolar ate lugar nenhum.
      chamado.fechamento_em ? "Finalizado" : nomeDaFila.get(chamado.fila_id),
      nomeCompleto(chamado.usuarios),
      chamado.unidades?.nome,
    ].filter(Boolean).join(" • ");

    texto.append(titulo, contexto);
    item.append(icone, texto);

    item.addEventListener("click", () => {
      // Fechado nao tem card no quadro pra rolar ate — abre o detalhe direto.
      if (chamado.fechamento_em) {
        detalhe.abrir(chamado);
      } else {
        irAteOCard(chamado);
      }
      fechar();
      campo.value = "";
    });

    return item;
  }

  function buscar(termo) {
    const busca = termo.trim().toLowerCase();

    if (!busca) {
      fechar();
      return;
    }

    const achados = chamados.filter((chamado) => [
      `ticket-${chamado.numero}`,
      String(chamado.numero),
      chamado.categorias?.nome,
      // Busca pelo nome completo: procurar pelo sobrenome tem de achar.
      nomeCompleto(chamado.usuarios),
      chamado.unidades?.nome,
      chamado.descricao,
    ].some((campo) => campo?.toLowerCase().includes(busca)));

    painel.replaceChildren();

    if (!achados.length) {
      const vazio = document.createElement("p");
      vazio.className = "busca__vazio";
      vazio.textContent = "Nenhum chamado encontrado";
      painel.appendChild(vazio);
      painel.hidden = false;
      return;
    }

    const titulo = document.createElement("p");
    titulo.className = "busca__titulo";
    titulo.textContent = "Chamados";
    painel.appendChild(titulo);

    achados.slice(0, 8).forEach((chamado) => painel.appendChild(montarResultado(chamado)));
    painel.hidden = false;
  }

  campo.addEventListener("input", () => buscar(campo.value));

  campo.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape") {
      campo.value = "";
      fechar();
    }
  });

  //CLIQUE FORA FECHA, IGUAL AO MENU DO PERFIL
  document.addEventListener("click", (evento) => {
    if (!evento.target.closest(".busca")) fechar();
  });
}

//DETALHE DO CHAMADO: ABRE AO CLICAR NO CARD. EDITA TITULO, PRIORIDADE,
//MEMBROS E DESCRICAO; A CONVERSA E SO LEITURA POR ENQUANTO.
function ligarDetalhe(chamados, filas, equipe, atendente) {
  const janela = document.querySelector("[data-detalhe]");
  const campoFila = document.querySelector("[data-detalhe-fila]");
  const campoTitulo = document.querySelector("[data-detalhe-titulo]");
  const campoDados = document.querySelector("[data-detalhe-dados]");
  const campoEtiquetas = document.querySelector("[data-detalhe-etiquetas]");
  const campoMembros = document.querySelector("[data-detalhe-membros]");
  const campoDescricao = document.querySelector("[data-detalhe-descricao]");
  const campoConversa = document.querySelector("[data-detalhe-conversa]");
  const campoAnexos = document.querySelector("[data-detalhe-anexos]");
  const campoMensagem = document.querySelector("[data-conversa-campo]");
  const campoArquivo = document.querySelector("[data-conversa-arquivo]");
  const nomeDoArquivo = document.querySelector("[data-conversa-arquivo-nome]");
  const botaoEnviar = document.querySelector("[data-conversa-enviar]");
  const aviso = document.querySelector("[data-detalhe-aviso]");
  const botaoFecharChamado = document.querySelector("[data-detalhe-fechar-chamado]");
  const nomeDaFila = new Map(filas.map((fila) => [fila.id, fila.nome]));

  let aberto = null;

  function avisar(texto, erro = false) {
    aviso.textContent = texto;
    aviso.classList.toggle("detalhe__aviso--erro", erro);

    if (!erro) setTimeout(() => { aviso.textContent = ""; }, 2500);
  }

  async function gravar(mudancas) {
    const { error } = await supabase
      .from("chamados")
      .update(mudancas)
      .eq("id", aberto.id);

    if (error) {
      avisar("Não foi possível salvar. Tente de novo.", true);
      return false;
    }

    Object.assign(aberto, mudancas);
    avisar("Salvo");
    return true;
  }

  //ETIQUETAS DE PRIORIDADE: CLICAR LIGA E DESLIGA
  function desenharEtiquetas() {
    campoEtiquetas.replaceChildren();

    [
      { chave: "eh_urgente", rotulo: "Urgente", classe: "urgente" },
      { chave: "eh_prioridade", rotulo: "Prioridade", classe: "prioridade" },
    ].forEach(({ chave, rotulo, classe }) => {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = `detalhe__etiqueta detalhe__etiqueta--${classe}`;
      botao.classList.toggle("detalhe__etiqueta--ativa", aberto[chave]);
      botao.textContent = rotulo;
      botao.setAttribute("aria-pressed", String(Boolean(aberto[chave])));

      botao.addEventListener("click", async () => {
        if (await gravar({ [chave]: !aberto[chave] })) {
          desenharEtiquetas();
          atualizarCard();
        }
      });

      campoEtiquetas.appendChild(botao);
    });
  }

  //MEMBROS: DOIS BOTOES AO LADO DOS CHIPS. O + SO ADICIONA ALGUEM AO CHAMADO;
  //A ENGRENAGEM SO TROCA A COR DE CADA MEMBRO. O x no chip tira a pessoa.
  //So um painel fica aberto por vez. O estado guarda o id do chamado: ao
  //abrir outro ticket, nada vem aberto.
  let painelMembros = null; // { chamado, tipo: "adicionar" | "cor" }

  function painelAberto(tipo) {
    return painelMembros?.chamado === aberto.id && painelMembros.tipo === tipo;
  }

  function alternarPainel(tipo) {
    painelMembros = painelAberto(tipo) ? null : { chamado: aberto.id, tipo };
    desenharMembros();
  }

  //A COR E DA PESSOA, NAO DO CHAMADO: grava em usuarios e atualiza a pessoa
  //em todos os chamados ja carregados, na lista da equipe e em todo avatar
  //dela que esta na tela (cards do quadro inclusive).
  async function trocarCorDestaque(usuarioId, cor) {
    // O .select devolve as linhas gravadas. Sem ele, um update que a RLS
    // barra volta sem erro e sem gravar nada — a tela mostraria a cor nova e
    // ela sumiria ao recarregar.
    const { data: gravadas, error } = await supabase
      .from("usuarios")
      .update({ cor_destaque: cor })
      .eq("id", usuarioId)
      .select("id");

    if (error) {
      console.error("Erro ao trocar a cor de destaque:", error);
      avisar("Não foi possível trocar a cor.", true);
      return;
    }

    if (!gravadas?.length) {
      console.error("Update de cor_destaque não gravou nenhuma linha (RLS?) para", usuarioId);
      avisar("A cor não foi salva: sem permissão para alterar essa pessoa.", true);
      return;
    }

    chamados.forEach((chamado) => {
      chamado.chamado_membros.forEach((membro) => {
        if (membro.usuario_id === usuarioId && membro.usuarios) membro.usuarios.cor_destaque = cor;
      });
    });

    equipe.forEach((pessoa) => {
      if (pessoa.id === usuarioId) pessoa.cor_destaque = cor;
    });

    // Os elementos marcados sao os que envolvem foto e nome (card e detalhe).
    document.querySelectorAll(`[data-usuario="${usuarioId}"]`).forEach((elemento) => {
      aplicarCorDestaque(elemento, { id: usuarioId, cor_destaque: cor });
    });

    avisar("Salvo");
    desenharMembros();
  }

  async function removerMembro(usuarioId) {
    const { error } = await supabase
      .from("chamado_membros")
      .delete()
      .eq("chamado_id", aberto.id)
      .eq("usuario_id", usuarioId);

    if (error) {
      avisar("Não foi possível remover o membro.", true);
      return;
    }

    aberto.chamado_membros = aberto.chamado_membros
      .filter((outro) => outro.usuario_id !== usuarioId);
    avisar("Salvo");
    desenharMembros();
    atualizarCard();
  }

  async function adicionarMembro(pessoa) {
    const { error } = await supabase
      .from("chamado_membros")
      .insert({ chamado_id: aberto.id, usuario_id: pessoa.id });

    if (error) {
      avisar("Não foi possível adicionar o membro.", true);
      return;
    }

    aberto.chamado_membros.push({
      usuario_id: pessoa.id,
      usuarios: {
        id: pessoa.id, nome: pessoa.nome, sobrenome: pessoa.sobrenome,
        foto_path: pessoa.foto_path, cor_destaque: pessoa.cor_destaque,
      },
    });
    avisar("Salvo");
    desenharMembros();
    atualizarCard();
  }

  //AS BOLINHAS DE COR DE UMA PESSOA. A atual ganha o anel duplo.
  function montarAmostras(pessoa, usuarioId) {
    const corAtual = pessoa.cor_destaque?.toLowerCase() ?? null;
    const cores = document.createElement("div");
    cores.className = "detalhe__cores";

    [...CORES_DESTAQUE, { nome: "Sem cor", valor: null }].forEach(({ nome, valor }) => {
      const atual = corAtual === (valor?.toLowerCase() ?? null);
      const amostra = document.createElement("button");

      amostra.type = "button";
      amostra.className = "detalhe__cor";
      amostra.classList.toggle("detalhe__cor--sem", valor === null);
      amostra.classList.toggle("detalhe__cor--atual", atual);
      amostra.title = nome;
      amostra.setAttribute("aria-label", `${nome} para ${primeiroNome(pessoa)}`);
      amostra.setAttribute("aria-pressed", String(atual));

      if (valor) amostra.style.setProperty("--cor", valor);

      amostra.addEventListener("click", () => {
        if (!atual) trocarCorDestaque(usuarioId, valor);
      });

      cores.appendChild(amostra);
    });

    return cores;
  }

  //PAINEL DA ENGRENAGEM: SO A COR, E SO DE QUEM ESTA LOGADO. Cada analista
  //escolhe a propria cor; a dos colegas nao se mexe daqui.
  function montarPainelCores() {
    const painel = document.createElement("div");
    painel.className = "detalhe__escolher";

    const titulo = document.createElement("p");
    titulo.className = "detalhe__escolher-titulo";
    titulo.textContent = "Sua cor de destaque";
    painel.appendChild(titulo);

    // A equipe carregada no inicio inclui quem esta logado (perfil admin).
    const eu = equipe.find((pessoa) => pessoa.id === atendente);

    if (!eu) {
      const vazio = document.createElement("p");
      vazio.className = "detalhe__escolher-nota";
      vazio.textContent = "Não foi possível identificar seu perfil. Recarregue a página.";
      painel.appendChild(vazio);
      return painel;
    }

    const linha = document.createElement("div");
    linha.className = "detalhe__config-linha";

    const quem = document.createElement("span");
    quem.className = "detalhe__config-pessoa";

    const avatar = montarAvatar(eu, eu.foto_path, "detalhe__membro-avatar");
    aplicarCorDestaque(quem, eu);

    const nome = document.createElement("span");
    nome.className = "detalhe__config-nome";
    nome.textContent = nomeCompleto(eu);

    quem.append(avatar, nome);
    linha.append(quem, montarAmostras(eu, eu.id));
    painel.appendChild(linha);

    const nota = document.createElement("p");
    nota.className = "detalhe__escolher-nota";
    nota.textContent = "A cor é sua: aparece em volta da sua foto em todos os cards.";
    painel.appendChild(nota);

    return painel;
  }

  //PAINEL DO +: SO QUEM PODE ENTRAR. Clicou, entrou, o painel fecha.
  function montarPainelAdicionar(disponiveis) {
    const painel = document.createElement("div");
    painel.className = "detalhe__escolher";

    const titulo = document.createElement("p");
    titulo.className = "detalhe__escolher-titulo";
    titulo.textContent = "Adicionar ao chamado";

    const opcoes = document.createElement("div");
    opcoes.className = "detalhe__escolher-opcoes";

    disponiveis.forEach((pessoa) => {
      const opcao = document.createElement("button");
      opcao.type = "button";
      opcao.className = "detalhe__membro";

      const avatar = montarAvatar(pessoa, pessoa.foto_path, "detalhe__membro-avatar");
      aplicarCorDestaque(opcao, pessoa);

      // A lista de escolha mostra o nome completo: e onde da para confundir
      // duas pessoas de primeiro nome parecido.
      opcao.append(avatar, document.createTextNode(nomeCompleto(pessoa)));
      opcao.addEventListener("click", () => {
        painelMembros = null;
        adicionarMembro(pessoa);
      });

      opcoes.appendChild(opcao);
    });

    painel.append(titulo, opcoes);

    return painel;
  }

  function montarBotaoMembros({ tipo, rotulo, icone, desativado = false }) {
    const ativo = painelAberto(tipo);
    const botao = document.createElement("button");

    botao.type = "button";
    botao.className = `detalhe__adicionar detalhe__adicionar--${tipo}`;
    botao.classList.toggle("detalhe__adicionar--ativo", ativo);
    botao.disabled = desativado;
    botao.title = rotulo;
    botao.setAttribute("aria-label", rotulo);
    botao.setAttribute("aria-expanded", String(ativo));
    botao.innerHTML = icone;
    botao.addEventListener("click", () => alternarPainel(tipo));

    return botao;
  }

  function desenharMembros() {
    campoMembros.replaceChildren();

    // Chip: foto, nome e o x para tirar a pessoa do chamado.
    aberto.chamado_membros.forEach((membro) => {
      const pessoa = membro.usuarios;

      if (!pessoa?.nome) return;

      const chip = document.createElement("span");
      chip.className = "detalhe__membro detalhe__membro--fixo";
      chip.title = nomeCompleto(pessoa);

      const avatar = montarAvatar(pessoa, pessoa.foto_path, "detalhe__membro-avatar");
      aplicarCorDestaque(chip, pessoa);

      const remover = document.createElement("button");
      remover.type = "button";
      remover.className = "detalhe__membro-remover";
      remover.textContent = "×";
      remover.title = `Remover ${nomeCompleto(pessoa)} do chamado`;
      remover.setAttribute("aria-label", remover.title);
      remover.addEventListener("click", () => removerMembro(membro.usuario_id));

      chip.append(avatar, document.createTextNode(primeiroNome(pessoa)), remover);
      campoMembros.appendChild(chip);
    });

    const disponiveis = equipe.filter((pessoa) =>
      !aberto.chamado_membros.some((membro) => membro.usuario_id === pessoa.id));

    // Painel de adicionar aberto mas ninguem mais disponivel: fecha sozinho.
    if (painelAberto("adicionar") && !disponiveis.length) painelMembros = null;

    campoMembros.appendChild(montarBotaoMembros({
      tipo: "adicionar",
      rotulo: disponiveis.length ? "Adicionar membro" : "Toda a equipe já está no chamado",
      desativado: !disponiveis.length,
      icone: `
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
          <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>`,
    }));

    const configurar = montarBotaoMembros({
      tipo: "cor",
      rotulo: "Cor dos membros",
      icone: `
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none"
           stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>`,
    });

    campoMembros.appendChild(configurar);

    if (painelAberto("adicionar")) campoMembros.appendChild(montarPainelAdicionar(disponiveis));
    if (painelAberto("cor")) campoMembros.appendChild(montarPainelCores());
  }

  function desenharConversa() {
    campoConversa.replaceChildren();

    const conversa = [...aberto.comentarios]
      .sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));

    if (!conversa.length) {
      const vazio = document.createElement("p");
      vazio.className = "conversa__vazia";
      vazio.textContent = "Nenhuma mensagem ainda";
      campoConversa.appendChild(vazio);
      return;
    }

    conversa.forEach((comentario) => {
      const bloco = document.createElement("article");
      bloco.className = "comentario";

      // Quem nao e o solicitante e a equipe — e a equipe fica do lado direito.
      const daEquipe = comentario.autor_id !== aberto.solicitante_id;
      // No balao vai so o primeiro nome, como numa conversa de verdade.
      const nome = primeiroNome(comentario.usuarios);

      if (comentario.tipo === "sistema") {
        bloco.classList.add("comentario--sistema");
      } else if (daEquipe) {
        bloco.classList.add("comentario--equipe");
      }

      bloco.appendChild(montarAvatar(comentario.usuarios, comentario.usuarios?.foto_path));

      const balao = document.createElement("div");
      balao.className = "comentario__balao";

      const topo = document.createElement("header");
      topo.className = "comentario__topo";

      const autor = document.createElement("span");
      autor.className = "comentario__autor";
      autor.textContent = comentario.tipo === "sistema" ? "Mensagem automática" : nome;

      const quando = document.createElement("time");
      quando.className = "comentario__quando";
      quando.dateTime = comentario.criado_em;
      quando.textContent = formatarData(comentario.criado_em);

      const texto = document.createElement("p");
      texto.className = "comentario__texto";
      texto.textContent = comentario.texto;

      topo.append(autor, quando);
      balao.append(topo, texto);
      bloco.appendChild(balao);
      campoConversa.appendChild(bloco);
    });

    // A conversa comeca no comentario mais recente.
    campoConversa.scrollTop = campoConversa.scrollHeight;
  }

  //ANEXOS: O BUCKET E PRIVADO, ENTAO O LINK E ASSINADO NA HORA DO CLIQUE —
  //assim o arquivo nunca fica acessivel por uma URL solta.
  function desenharAnexos() {
    campoAnexos.replaceChildren();

    if (!aberto.anexos?.length) {
      const vazio = document.createElement("p");
      vazio.className = "anexos__vazio";
      vazio.textContent = "Nenhum anexo";
      campoAnexos.appendChild(vazio);
      return;
    }

    [...aberto.anexos]
      .sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em))
      .forEach((anexo) => {
        const botao = document.createElement("button");
        botao.type = "button";
        botao.className = "anexo";
        botao.title = anexo.nome_arquivo;

        const icone = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icone.setAttribute("class", "anexo__icone");
        icone.setAttribute("viewBox", "0 0 24 24");
        icone.setAttribute("width", "14");
        icone.setAttribute("height", "14");
        icone.innerHTML = '<path d="M13.5 3.5H7a1.8 1.8 0 0 0-1.8 1.8v13.4A1.8 1.8 0 0 0 7 20.5h10a1.8 1.8 0 0 0 1.8-1.8V8.8Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M13.5 3.5v5.3h5.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>';

        const texto = document.createElement("span");
        texto.className = "anexo__texto";

        const nome = document.createElement("span");
        nome.className = "anexo__nome";
        nome.textContent = anexo.nome_arquivo;

        const quando = document.createElement("span");
        quando.className = "anexo__quando";
        quando.textContent = formatarData(anexo.criado_em);

        texto.append(nome, quando);
        botao.append(icone, texto);

        botao.addEventListener("click", async () => {
          const { data, error } = await supabase.storage
            .from("anexos")
            .createSignedUrl(anexo.storage_path, 60);

          if (error) {
            avisar("Não foi possível abrir o anexo.", true);
            return;
          }

          window.open(data.signedUrl, "_blank", "noopener");
        });

        campoAnexos.appendChild(botao);
      });
  }

  //RESPONDER AO SOLICITANTE. Tudo que se escreve aqui e conversa com ele —
  //nota interna nao existe nesta tela.
  async function responder() {
    const texto = campoMensagem.value.trim();
    const arquivo = campoArquivo.files[0];

    if (!texto && !arquivo) return;

    botaoEnviar.disabled = true;
    botaoEnviar.textContent = "Enviando…";

    const { data: comentario, error: erroComentario } = await supabase
      .from("comentarios")
      .insert({
        chamado_id: aberto.id,
        autor_id: atendente,
        texto: texto || `Enviou o anexo ${arquivo.name}`,
        visibilidade: "publico",
        tipo: "humano",
      })
      .select("id, autor_id, texto, visibilidade, tipo, criado_em, usuarios(nome, sobrenome, foto_path)")
      .single();

    if (erroComentario) {
      avisar("Não foi possível enviar a mensagem.", true);
      botaoEnviar.disabled = false;
      botaoEnviar.textContent = "Responder";
      return;
    }

    aberto.comentarios.push(comentario);

    if (arquivo) {
      // O caminho comeca pelo id do chamado: e assim que a policy do bucket
      // amarra a permissao do arquivo a permissao do chamado.
      const caminho = `${aberto.id}/${Date.now()}-${arquivo.name}`;
      const { error: erroUpload } = await supabase.storage
        .from("anexos")
        .upload(caminho, arquivo);

      if (erroUpload) {
        avisar("A mensagem foi enviada, mas o anexo falhou.", true);
      } else {
        const { data: anexo } = await supabase
          .from("anexos")
          .insert({
            chamado_id: aberto.id,
            comentario_id: comentario.id,
            usuario_id: atendente,
            storage_path: caminho,
            nome_arquivo: arquivo.name,
          })
          .select("id, nome_arquivo, storage_path, criado_em")
          .single();

        if (anexo) {
          aberto.anexos = [...(aberto.anexos ?? []), anexo];
          desenharAnexos();
        }
      }
    }

    campoMensagem.value = "";
    campoArquivo.value = "";
    nomeDoArquivo.textContent = "Anexar";
    nomeDoArquivo.parentElement.classList.remove("conversa__anexar--escolhido");
    botaoEnviar.disabled = false;
    botaoEnviar.textContent = "Responder";

    desenharConversa();
    // O status do card vem de quem falou por ultimo: agora fomos nos.
    atualizarStatusDoCard();
  }

  //O SELO DO CARD ACOMPANHA A CONVERSA
  function atualizarStatusDoCard() {
    const card = quadro.querySelector(`[data-chamado="${aberto.id}"]`);

    if (!card) return;

    const status = derivarStatus(aberto);
    const selo = card.querySelector(".card__status");
    selo.className = `card__status card__status--${status.chave}`;
    selo.textContent = status.rotulo;
  }

  campoArquivo.addEventListener("change", () => {
    const arquivo = campoArquivo.files[0];

    nomeDoArquivo.textContent = arquivo ? arquivo.name : "Anexar";
    nomeDoArquivo.parentElement
      .classList.toggle("conversa__anexar--escolhido", Boolean(arquivo));
  });

  botaoEnviar.addEventListener("click", responder);

  //TEXTOS RAPIDOS: RESPOSTAS PRONTAS DA EQUIPE. ESCOLHER UM POE O TEXTO NO
  //CAMPO DE RESPOSTA — sem enviar, porque quase sempre falta ajustar algo
  //antes de mandar para o solicitante.
  function ligarTextosRapidos() {
    const painel = document.querySelector("[data-rapidos]");
    const botaoAbrir = document.querySelector("[data-rapidos-abrir]");
    const lista = document.querySelector("[data-rapidos-lista]");
    const busca = document.querySelector("[data-rapidos-busca]");
    const formulario = document.querySelector("[data-rapidos-form]");
    const campoTitulo = document.querySelector("[data-rapidos-titulo]");
    const campoCorpo = document.querySelector("[data-rapidos-corpo]");
    const botaoNovo = document.querySelector("[data-rapidos-novo]");

    let textos = [];
    let carregados = false;
    let editando = null;

    async function carregar() {
      const { data, error } = await supabase
        .from("textos_rapidos")
        .select("id, titulo, corpo")
        .eq("ativo", true)
        .order("titulo");

      if (error) {
        avisar("Não foi possível carregar os textos rápidos.", true);
        return;
      }

      textos = data;
      carregados = true;
      desenhar();
    }

    function desenhar() {
      const termo = busca.value.trim().toLowerCase();
      const achados = textos.filter(({ titulo, corpo }) =>
        !termo || `${titulo} ${corpo}`.toLowerCase().includes(termo));

      lista.replaceChildren();

      if (!achados.length) {
        const vazio = document.createElement("p");
        vazio.className = "rapidos__vazio";
        vazio.textContent = carregados
          ? (termo ? "Nenhum texto encontrado" : "Nenhum texto rápido ainda")
          : "Carregando…";
        lista.appendChild(vazio);
        return;
      }

      achados.forEach((texto) => lista.appendChild(montarItem(texto)));
    }

    function montarItem(texto) {
      const item = document.createElement("div");
      item.className = "rapidos__item";
      item.tabIndex = 0;
      item.role = "button";

      const titulo = document.createElement("span");
      titulo.className = "rapidos__item-titulo";
      titulo.textContent = texto.titulo;

      const corpo = document.createElement("span");
      corpo.className = "rapidos__item-corpo";
      corpo.textContent = texto.corpo;

      const acoes = document.createElement("div");
      acoes.className = "rapidos__acoes";
      acoes.append(
        montarAcao("editar", "Editar", () => abrirFormulario(texto)),
        montarAcao("excluir", "Excluir", () => excluir(texto)),
      );

      item.append(titulo, corpo, acoes);

      item.addEventListener("click", (evento) => {
        // Clique nos botoes de editar/excluir nao deve inserir o texto.
        if (evento.target.closest(".rapidos__acoes")) return;
        inserir(texto);
      });

      item.addEventListener("keydown", (evento) => {
        if (evento.key !== "Enter" && evento.key !== " ") return;
        evento.preventDefault();
        inserir(texto);
      });

      return item;
    }

    function montarAcao(tipo, rotulo, aoClicar) {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = `rapidos__acao rapidos__acao--${tipo}`;
      botao.title = rotulo;
      botao.setAttribute("aria-label", rotulo);

      const desenho = tipo === "editar"
        ? '<path d="m5 19 .8-3.2L15.6 6a1.7 1.7 0 0 1 2.4 0l.8.8a1.7 1.7 0 0 1 0 2.4l-9.8 9.8Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>'
        : '<path d="M5.5 7h13M10 7V5.5h4V7M8 7l.7 11.5h6.6L16 7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>';

      botao.innerHTML =
        `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">${desenho}</svg>`;

      botao.addEventListener("click", aoClicar);

      return botao;
    }

    //O texto entra onde o cursor estava; se o campo ja tem conteudo, ele e
    //preservado — o analista pode ter escrito algo antes de buscar o pronto.
    function inserir(texto) {
      const atual = campoMensagem.value;
      const inicio = campoMensagem.selectionStart ?? atual.length;
      const fim = campoMensagem.selectionEnd ?? atual.length;
      const precisaQuebra = atual.slice(0, inicio).trim() !== "";
      const trecho = (precisaQuebra ? "\n\n" : "") + texto.corpo;

      campoMensagem.value = atual.slice(0, inicio) + trecho + atual.slice(fim);
      fechar();
      campoMensagem.focus();
      // O cursor fica no fim do que foi inserido, pronto para ajustar.
      const posicao = inicio + trecho.length;
      campoMensagem.setSelectionRange(posicao, posicao);
    }

    function abrirFormulario(texto = null) {
      editando = texto;
      campoTitulo.value = texto?.titulo ?? "";
      campoCorpo.value = texto?.corpo ?? "";
      formulario.hidden = false;
      botaoNovo.hidden = true;
      campoTitulo.focus();
    }

    function fecharFormulario() {
      editando = null;
      formulario.reset();
      formulario.hidden = true;
      botaoNovo.hidden = false;
    }

    formulario.addEventListener("submit", async (evento) => {
      evento.preventDefault();

      const titulo = campoTitulo.value.trim();
      const corpo = campoCorpo.value.trim();

      if (!titulo || !corpo) return;

      const { data, error } = editando
        ? await supabase
            .from("textos_rapidos")
            .update({ titulo, corpo })
            .eq("id", editando.id)
            .select("id, titulo, corpo")
            .single()
        : await supabase
            .from("textos_rapidos")
            .insert({ titulo, corpo, criado_por: atendente })
            .select("id, titulo, corpo")
            .single();

      if (error) {
        avisar("Não foi possível salvar o texto rápido.", true);
        return;
      }

      if (editando) {
        Object.assign(textos.find((outro) => outro.id === data.id), data);
      } else {
        textos.push(data);
      }

      textos.sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR"));
      fecharFormulario();
      desenhar();
      avisar("Salvo");
    });

    //Desativa em vez de apagar: o texto some da lista sem sumir do banco.
    async function excluir(texto) {
      if (!window.confirm(`Excluir o texto "${texto.titulo}"?`)) return;

      const { error } = await supabase
        .from("textos_rapidos")
        .update({ ativo: false })
        .eq("id", texto.id);

      if (error) {
        avisar("Não foi possível excluir o texto rápido.", true);
        return;
      }

      textos = textos.filter((outro) => outro.id !== texto.id);
      if (editando?.id === texto.id) fecharFormulario();
      desenhar();
      avisar("Texto excluído");
    }

    function abrir() {
      painel.hidden = false;
      botaoAbrir.setAttribute("aria-expanded", "true");
      // Busca so no banco na primeira vez; depois a lista vive em memoria.
      if (!carregados) carregar(); else desenhar();
      busca.focus();
    }

    function fechar() {
      painel.hidden = true;
      botaoAbrir.setAttribute("aria-expanded", "false");
      busca.value = "";
      fecharFormulario();
    }

    botaoAbrir.addEventListener("click", () => {
      if (painel.hidden) abrir(); else fechar();
    });

    document.querySelector("[data-rapidos-fechar]")
      .addEventListener("click", fechar);
    document.querySelector("[data-rapidos-cancelar]")
      .addEventListener("click", fecharFormulario);
    botaoNovo.addEventListener("click", () => abrirFormulario());
    busca.addEventListener("input", desenhar);

    // Esc fecha so o painel; sem isto o <dialog> fecharia o chamado inteiro.
    painel.addEventListener("keydown", (evento) => {
      if (evento.key !== "Escape") return;
      evento.stopPropagation();
      fechar();
    });

    // Clicar fora fecha, menos no proprio botao (que ja alterna).
    document.addEventListener("click", (evento) => {
      if (painel.hidden) return;
      if (evento.target.closest(".rapidos, [data-rapidos-abrir]")) return;
      fechar();
    });

    return { fechar };
  }

  const textosRapidos = ligarTextosRapidos();

  //O CARD NO QUADRO REFLETE O QUE MUDOU NO DETALHE
  function atualizarCard() {
    const card = quadro.querySelector(`[data-chamado="${aberto.id}"]`);

    if (!card) return;

    card.querySelector("[data-titulo]").textContent = tituloDoChamado(aberto);

    const etiquetas = card.querySelector(".card__etiquetas");
    etiquetas.replaceChildren();

    const marcadas = [
      aberto.eh_urgente && { rotulo: "Urgente", classe: "urgente" },
      aberto.eh_prioridade && { rotulo: "Prioridade", classe: "prioridade" },
    ].filter(Boolean);

    (marcadas.length ? marcadas : [{ rotulo: "Normal", classe: "normal" }])
      .forEach(({ rotulo, classe }) => {
        const etiqueta = document.createElement("span");
        etiqueta.className = `card__etiqueta card__etiqueta--${classe}`;
        etiqueta.textContent = rotulo;
        etiquetas.appendChild(etiqueta);
      });

    desenharMembrosDoCard(card.querySelector(".card__membros"), aberto.chamado_membros);
  }

  //SALVA AO SAIR DO CAMPO, SE MUDOU
  function ligarCampoEditavel(campo, chave, padrao = "") {
    campo.addEventListener("blur", async () => {
      const valor = campo.textContent.trim();

      if (valor === (aberto[chave] ?? padrao)) return;

      if (!valor && chave === "titulo") {
        // Titulo vazio nao ajuda ninguem: volta ao que estava.
        campo.textContent = tituloDoChamado(aberto);
        return;
      }

      if (await gravar({ [chave]: valor })) atualizarCard();
    });

    // Enter confirma no titulo; na descricao ele quebra linha normalmente.
    if (chave !== "titulo") return;

    campo.addEventListener("keydown", (evento) => {
      if (evento.key !== "Enter") return;

      evento.preventDefault();
      campo.blur();
    });
  }

  ligarCampoEditavel(campoTitulo, "titulo");
  ligarCampoEditavel(campoDescricao, "descricao");

  //DADOS DO CHAMADO: A FICHA QUE O ANALISTA LE ANTES DE ATENDER.
  //Todos os campos aparecem sempre; os que o formulario ainda nao preencheu
  //ficam como "Não informado" para o analista saber que falta, nao sumir.
  function desenharDados() {
    campoDados.replaceChildren();

    const aberturaEm = aberto.abertura_em
      ? new Date(aberto.abertura_em).toLocaleString("pt-BR", {
          day: "2-digit", month: "2-digit", year: "numeric",
          hour: "2-digit", minute: "2-digit",
        })
      : null;

    [
      // A ordem importa: a grade tem duas colunas, entao os pares ficam
      // lado a lado e os campos longos tomam a linha inteira.
      // A ficha identifica a pessoa, entao aqui vai o nome completo.
      { rotulo: "Solicitante", valor: nomeCompleto(aberto.usuarios) },
      { rotulo: "Aberto em", valor: aberturaEm },
      { rotulo: "E-mail", valor: aberto.usuarios?.email, largo: true },
      { rotulo: "Unidade", valor: aberto.unidades?.nome },
      { rotulo: "Categoria", valor: aberto.categorias?.nome },
      { rotulo: "Cliente na loja", valor: aberto.cliente_na_loja, marca: true },
      { rotulo: "Sistema lento ou fora", valor: aberto.sistema_lento_ou_fora, marca: true },
      { rotulo: "Acesso remoto", valor: aberto.acesso_remoto, largo: true },
    ].forEach(({ rotulo, valor, largo, marca }) => {
      const item = document.createElement("div");
      item.className = "dados__item";
      if (largo) item.classList.add("dados__item--largo");

      const termo = document.createElement("dt");
      termo.className = "dados__rotulo";
      termo.textContent = rotulo;

      const definicao = document.createElement("dd");
      definicao.className = "dados__valor";

      // Sim/nao vira selo: o "sim" muda a urgencia do atendimento e
      // precisa saltar aos olhos no meio dos outros dados.
      if (marca) {
        const selo = document.createElement("span");
        selo.className = "dados__marca";
        selo.classList.toggle("dados__marca--sim", valor === true);
        selo.textContent = valor ? "Sim" : "Não";
        definicao.appendChild(selo);
      } else if (valor) {
        definicao.textContent = valor;
      } else {
        definicao.classList.add("dados__valor--vazio");
        definicao.textContent = "Não informado";
      }

      item.append(termo, definicao);
      campoDados.appendChild(item);
    });
  }

  function abrir(chamado) {
    aberto = chamado;

    campoFila.textContent = nomeDaFila.get(chamado.fila_id) ?? "Sem fila";
    campoTitulo.textContent = tituloDoChamado(chamado);
    campoDescricao.textContent = chamado.descricao ?? "";
    campoMensagem.value = "";
    campoArquivo.value = "";
    nomeDoArquivo.textContent = "Anexar";
    nomeDoArquivo.parentElement.classList.remove("conversa__anexar--escolhido");
    aviso.textContent = "";
    // Sem isto o painel continuaria aberto por cima do chamado seguinte.
    textosRapidos.fechar();
    atualizarBotaoFechar();

    desenharDados();
    desenharEtiquetas();
    desenharMembros();
    desenharConversa();
    desenharAnexos();

    janela.showModal();
  }

  //O TEXTO DO BOTAO MUDA CONFORME O CHAMADO JA ESTA FECHADO OU NAO —
  //assim a mesma tela de detalhe serve tanto para o quadro quanto para
  //quem abriu um item de dentro de Tickets finalizados.
  function atualizarBotaoFechar() {
    const fechado = Boolean(aberto.fechamento_em);
    botaoFecharChamado.textContent = fechado ? "Reabrir chamado" : "Fechar chamado";
    botaoFecharChamado.classList.toggle("detalhe__fechar-chamado--reabrir", fechado);
  }

  //FECHAR: SOME DO QUADRO E VAI PARA TICKETS FINALIZADOS. REABRIR: O
  //INVERSO — fila_id nunca muda, entao o card volta pra onde estava.
  async function alternarFechamento() {
    const fechando = !aberto.fechamento_em;
    const pergunta = fechando
      ? "Fechar este chamado? Ele sai do quadro e vai para Tickets finalizados."
      : "Reabrir este chamado? Ele volta a aparecer no quadro.";

    if (!window.confirm(pergunta)) return;

    const ok = await gravar({ fechamento_em: fechando ? new Date().toISOString() : null });

    if (!ok) return;

    atualizarBotaoFechar();

    if (fechando) {
      quadro.querySelector(`[data-chamado="${aberto.id}"]`)?.closest("li")?.remove();
      const coluna = quadro.querySelector(`[data-fila="${aberto.fila_id}"]`);
      if (coluna) sincronizarColuna(coluna);
    } else {
      const coluna = quadro.querySelector(`[data-fila="${aberto.fila_id}"]`);
      if (coluna) {
        coluna.querySelector(".fila__cards").appendChild(montarCard(aberto));
        sincronizarColuna(coluna);
      }
    }

    atualizarResumo(chamados, filas.length);
    janela.close();
  }

  botaoFecharChamado.addEventListener("click", alternarFechamento);

  //CLICAR NO CARD ABRE; ARRASTAR NAO DEVE ABRIR
  let arrastou = false;

  quadro.addEventListener("dragstart", () => { arrastou = true; });
  quadro.addEventListener("dragend", () => {
    setTimeout(() => { arrastou = false; }, 0);
  });

  quadro.addEventListener("click", (evento) => {
    const card = evento.target.closest(".card");

    if (!card || arrastou) return;

    const chamado = chamados.find((outro) => outro.id === card.dataset.chamado);

    if (chamado) abrir(chamado);
  });

  document.querySelector("[data-detalhe-fechar]")
    .addEventListener("click", () => janela.close());

  //CLIQUE NO FUNDO ESMAECIDO FECHA
  janela.addEventListener("click", (evento) => {
    if (evento.target === janela) janela.close();
  });

  // Exposto para Tickets finalizados abrir o mesmo modal a partir da lista.
  return { abrir };
}

//MENU DO QUADRO: BOTAO DE 3 PONTINHOS. EXPORTAR, FUNDO, FINALIZADOS.
function ligarQuadroMenu() {
  const botao = document.querySelector("[data-quadro-menu-abrir]");
  const painel = document.querySelector("[data-quadro-menu-painel]");

  function fechar() {
    painel.hidden = true;
    botao.setAttribute("aria-expanded", "false");
  }

  botao.addEventListener("click", () => {
    const abrindo = painel.hidden;
    painel.hidden = !abrindo;
    botao.setAttribute("aria-expanded", String(abrindo));
  });

  document.addEventListener("click", (evento) => {
    if (painel.hidden) return;
    if (evento.target.closest(".quadro-menu")) return;
    fechar();
  });

  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && !painel.hidden) fechar();
  });

  //EXPORTAR: SO JSON/CSV/EXCEL FICAM PARA DEPOIS, POR ENQUANTO E UM AVISO.
  document.querySelector("[data-acao-exportar]").addEventListener("click", () => {
    fechar();
    window.alert("Exportar chamados: em breve.");
  });

  document.querySelector("[data-acao-fundo]").addEventListener("click", () => {
    fechar();
    document.querySelector("[data-fundo-modal]").showModal();
  });

  document.querySelector("[data-acao-finalizados]").addEventListener("click", () => {
    fechar();
    document.querySelector("[data-finalizados]").showModal();
  });
}

//TICKETS FINALIZADOS: LISTA OS CHAMADOS COM fechamento_em PREENCHIDO.
//Reabrir devolve o card ao quadro, na mesma fila de onde saiu — fila_id
//nunca muda ao fechar, entao nao ha ambiguidade de para onde ele volta.
function ligarFinalizados(chamados, filas, detalhe) {
  const janela = document.querySelector("[data-finalizados]");
  const lista = document.querySelector("[data-finalizados-lista]");
  const nomeDaFila = new Map(filas.map((fila) => [fila.id, fila.nome]));

  function desenhar() {
    const fechados = chamados
      .filter((chamado) => chamado.fechamento_em)
      .sort((a, b) => new Date(b.fechamento_em) - new Date(a.fechamento_em));

    lista.replaceChildren();

    if (!fechados.length) {
      const vazio = document.createElement("p");
      vazio.className = "finalizados__vazio";
      vazio.textContent = "Nenhum chamado finalizado ainda";
      lista.appendChild(vazio);
      return;
    }

    fechados.forEach((chamado) => lista.appendChild(montarItem(chamado)));
  }

  function montarItem(chamado) {
    const item = document.createElement("div");
    item.className = "finalizados__item";

    const info = document.createElement("div");
    info.className = "finalizados__item-info";

    const titulo = document.createElement("span");
    titulo.className = "finalizados__item-titulo";
    titulo.textContent = tituloDoChamado(chamado);

    const meta = document.createElement("span");
    meta.className = "finalizados__item-meta";
    meta.textContent =
      `${nomeDaFila.get(chamado.fila_id) ?? "Sem fila"} • Fechado em ${formatarData(chamado.fechamento_em)}`;

    info.append(titulo, meta);

    const acoes = document.createElement("div");
    acoes.className = "finalizados__item-acoes";

    const ver = document.createElement("button");
    ver.type = "button";
    ver.className = "finalizados__acao";
    ver.textContent = "Ver";
    ver.addEventListener("click", () => {
      janela.close();
      detalhe.abrir(chamado);
    });

    const reabrir = document.createElement("button");
    reabrir.type = "button";
    reabrir.className = "finalizados__acao";
    reabrir.textContent = "Reabrir";
    reabrir.addEventListener("click", () => reabrirChamado(chamado));

    acoes.append(ver, reabrir);
    item.append(info, acoes);

    return item;
  }

  async function reabrirChamado(chamado) {
    const { error } = await supabase
      .from("chamados")
      .update({ fechamento_em: null })
      .eq("id", chamado.id);

    if (error) {
      window.alert("Não foi possível reabrir o chamado. Tente de novo.");
      return;
    }

    chamado.fechamento_em = null;
    desenhar();
    atualizarResumo(chamados, filas.length);

    const coluna = quadro.querySelector(`[data-fila="${chamado.fila_id}"]`);
    if (coluna) {
      coluna.querySelector(".fila__cards").appendChild(montarCard(chamado));
      sincronizarColuna(coluna);
    }
  }

  document.querySelector("[data-finalizados-fechar]")
    .addEventListener("click", () => janela.close());
  janela.addEventListener("click", (evento) => {
    if (evento.target === janela) janela.close();
  });

  // A lista e recalculada toda vez que o painel abre, para refletir quem
  // acabou de ser fechado ou reaberto pelo modal do card.
  document.querySelector("[data-acao-finalizados]")
    .addEventListener("click", desenhar);
}

//PLANO DE FUNDO: FOTO PROPRIA DO USUARIO, SALVA NO BUCKET PRIVADO
//"fundos-portal". Sem fundo salvo, o quadro mantem o degrade laranja.
function ligarFundo() {
  const janela = document.querySelector("[data-fundo-modal]");
  const campoArquivo = document.querySelector("[data-fundo-arquivo]");
  const botaoRestaurar = document.querySelector("[data-fundo-restaurar]");
  const aviso = document.querySelector("[data-fundo-aviso]");
  const TAMANHO_MAXIMO = 5 * 1024 * 1024;

  let usuarioId = null;

  function avisar(texto, erro = false) {
    aviso.textContent = texto;
    aviso.classList.toggle("fundo-modal__aviso--erro", erro);
  }

  async function aplicarFundoSalvo() {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return;

    usuarioId = user.id;

    const { data } = await supabase
      .from("usuarios")
      .select("fundo_path")
      .eq("id", user.id)
      .single();

    if (!data?.fundo_path) return;

    // Bucket privado: precisa de URL assinada, diferente do avatar (publico).
    const { data: assinada } = await supabase.storage
      .from("fundos-portal")
      .createSignedUrl(data.fundo_path, 3600);

    if (assinada?.signedUrl) {
      const painelPortal = document.querySelector(".portal");
      painelPortal.style.backgroundImage = `url("${assinada.signedUrl}")`;
      // O tamanho/animacao do degrade nao serve para foto: distorceria.
      painelPortal.classList.add("portal--fundo-proprio");
    }
  }

  campoArquivo.addEventListener("change", async () => {
    const arquivo = campoArquivo.files[0];

    if (!arquivo || !usuarioId) return;

    if (arquivo.size > TAMANHO_MAXIMO) {
      avisar("A imagem precisa ter até 5 MB.", true);
      campoArquivo.value = "";
      return;
    }

    avisar("Enviando…");

    const extensao = arquivo.name.split(".").pop().toLowerCase();
    const caminho = `${usuarioId}.${extensao}`;

    const { error: erroUpload } = await supabase.storage
      .from("fundos-portal")
      .upload(caminho, arquivo, { upsert: true });

    if (erroUpload) {
      avisar("Não foi possível enviar a imagem.", true);
      campoArquivo.value = "";
      return;
    }

    const { error: erroPerfil } = await supabase
      .from("usuarios")
      .update({ fundo_path: caminho })
      .eq("id", usuarioId);

    if (erroPerfil) {
      avisar("A imagem subiu, mas não foi possível salvá-la.", true);
      return;
    }

    await aplicarFundoSalvo();
    campoArquivo.value = "";
    avisar("Fundo atualizado");
  });

  botaoRestaurar.addEventListener("click", async () => {
    if (!usuarioId) return;

    const { error } = await supabase
      .from("usuarios")
      .update({ fundo_path: null })
      .eq("id", usuarioId);

    if (error) {
      avisar("Não foi possível restaurar o fundo padrão.", true);
      return;
    }

    const painelPortal = document.querySelector(".portal");
    painelPortal.style.backgroundImage = "";
    painelPortal.classList.remove("portal--fundo-proprio");
    avisar("Fundo padrão restaurado");
  });

  document.querySelector("[data-fundo-fechar]")
    .addEventListener("click", () => janela.close());
  janela.addEventListener("click", (evento) => {
    if (evento.target === janela) janela.close();
  });

  aplicarFundoSalvo();
}

//RESUMO NO CABECALHO: SO CONTA O QUE ESTA ABERTO. Chamado fechado nao
//esta escondido por engano — foi fechado por decisao de quem atende.
function atualizarResumo(chamados, totalFilas) {
  const abertos = chamados.filter((chamado) => !chamado.fechamento_em).length;
  resumo.textContent =
    `${abertos} ${abertos === 1 ? "chamado aberto" : "chamados abertos"} em ${totalFilas} filas`;
}

async function montarQuadro() {
  const atendente = await quemEstaAtendendo();

  if (!atendente) {
    window.location.href = "index.html";
    return;
  }

  const [filas, chamados, equipe, cores] = await Promise.all([
    supabase.from("filas").select("id, nome").eq("ativo", true).order("ordem"),
    supabase
      .from("chamados")
      .select(`
        id, numero, titulo, fila_id, solicitante_id, descricao,
        eh_urgente, eh_prioridade, fechamento_em, abertura_em,
        acesso_remoto, cliente_na_loja, sistema_lento_ou_fora,
        categorias(nome),
        unidades(nome),
        usuarios!chamados_solicitante_id_fkey(nome, sobrenome, email),
        chamado_membros(usuario_id, usuarios(id, nome, sobrenome, foto_path)),
        comentarios(id, autor_id, texto, visibilidade, tipo, criado_em, usuarios(nome, sobrenome, foto_path)),
        anexos(id, nome_arquivo, storage_path, criado_em)
      `)
      .order("abertura_em", { ascending: false }),
    // Quem pode ser posto num chamado: a propria equipe de TI.
    supabase
      .from("usuarios")
      .select("id, nome, sobrenome, foto_path")
      .neq("perfil", "solicitante")
      .eq("ativo", true)
      .order("nome"),
    // Cor de destaque em consulta separada, de proposito: se a coluna ainda
    // nao existir no banco (migration nao aplicada), so esta falha — dentro
    // da consulta dos chamados, derrubaria o quadro inteiro.
    supabase.from("usuarios").select("id, cor_destaque"),
  ]);

  if (filas.error || chamados.error) {
    console.error("Erro ao carregar o quadro:", filas.error ?? chamados.error);
    resumo.textContent = "";
    mostrarErro("Não foi possível carregar o quadro. Recarregue a página.");
    return;
  }

  //COR DE DESTAQUE: SE A CONSULTA FALHOU, O QUADRO SEGUE SEM ANEL
  if (cores.error) {
    console.warn("Cor de destaque indisponível (a migration foi aplicada?):", cores.error);
  } else {
    const corDe = new Map(cores.data.map((pessoa) => [pessoa.id, pessoa.cor_destaque]));

    (equipe.data ?? []).forEach((pessoa) => {
      pessoa.cor_destaque = corDe.get(pessoa.id) ?? null;
    });

    chamados.data.forEach((chamado) => {
      chamado.chamado_membros.forEach((membro) => {
        if (membro.usuarios) membro.usuarios.cor_destaque = corDe.get(membro.usuario_id) ?? null;
      });
    });
  }

  //FECHADO NAO APARECE NO QUADRO: vive em Tickets finalizados. O array
  //chamados.data continua com todos — o quadro so filtra na hora de montar.
  filas.data.forEach((fila) => {
    const daFila = chamados.data.filter(
      (chamado) => chamado.fila_id === fila.id && !chamado.fechamento_em,
    );
    quadro.appendChild(montarFila(fila, daFila));
  });

  atualizarResumo(chamados.data, filas.data.length);

  ligarArrastar();
  ligarArrastoDoFundo();
  ligarBarra();
  const detalhe = ligarDetalhe(chamados.data, filas.data, equipe.data ?? [], atendente);
  // A busca abre o modal (via detalhe.abrir) quando o achado e um chamado
  // finalizado — esse nao tem card no quadro para rolar ate.
  ligarBusca(chamados.data, filas.data, detalhe);
  ligarQuadroMenu();
  ligarFinalizados(chamados.data, filas.data, detalhe);
  ligarFundo();
}

montarQuadro();
