// Portal de Chamados: quadro kanban da equipe de TI — Fase 4.

import { supabase } from "../config/supabase-config.js";
import { pintarImagemPrivada } from "../componentes/storage-privado.js";
import { inscreverPush, limparPushNoLogout } from "../componentes/push-sessao.js";
// Peças que o Painel também usa: moram em componentes/ para as duas telas
// mostrarem status, nome e avatar pela mesma regra.
import {
  derivarStatus,
  primeiroNome,
  nomeCompleto,
  iniciais,
  tituloDoChamado,
  formatarData,
  montarAvatar,
  aplicarCorDestaque,
  CORES_DESTAQUE,
  CAMPOS_CHAMADO,
} from "../componentes/chamado-comum.js";

const quadro = document.querySelector("[data-quadro]");
const resumo = document.querySelector("[data-resumo]");
const erro = document.querySelector("[data-erro]");

//ICONE DE PREDIO: usado em todo lugar que mostra um TERCEIRO (fornecedor
//sem conta) em vez de uma pessoa — chip do card, chip do detalhe, opcao no
//painel de escolha. Um so lugar pra editar o desenho.
const ICONE_TERCEIRO_SVG = `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none"
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="9.5" width="7" height="10"/><rect x="13" y="4.5" width="7" height="15"/>
  <path d="M6.5 12.5h2M6.5 15.5h2M15.5 8h2M15.5 11h2M15.5 14h2"/>
</svg>`;

//AVATAR DO TERCEIRO: com foto, mostra a foto (bucket proprio "terceiros",
//diferente do "avatares" de pessoa — por isso nao reaproveita pintarFoto de
//avatar.js, que ja vem fixo no bucket de pessoa); sem foto, o icone de
//predio — nunca iniciais, porque o terceirizado nao e uma pessoa com nome
//e sobrenome.
function montarAvatarTerceiro(fornecedor, classe) {
  const elemento = document.createElement("span");
  elemento.className = classe;

  if (fornecedor.foto_path) {
    const img = document.createElement("img");
    pintarImagemPrivada(img, "terceiros", fornecedor.foto_path,
      () => { elemento.innerHTML = ICONE_TERCEIRO_SVG; });
    img.alt = "";
    img.decoding = "async";
    // Foto removida do Storage depois de carregada na tela: volta pro icone
    // padrao em vez de mostrar imagem quebrada — mesmo cuidado de pintarFoto.
    img.addEventListener("error", () => { elemento.innerHTML = ICONE_TERCEIRO_SVG; }, { once: true });
    elemento.replaceChildren(img);
  } else {
    elemento.innerHTML = ICONE_TERCEIRO_SVG;
  }

  return elemento;
}

//TEMA: SO DESTA TELA, POR ISSO MORA AQUI E NAO NO main.js COMPARTILHADO.
//A chave tambem e propria ("tema-portal") para nao ligar o escuro nas
//outras paginas, que continuam so no claro.
function ligarTema() {
  const botao = document.querySelector("[data-tema-alternar]");

  function aplicar(tema) {
    document.documentElement.dataset.tema = tema;
    localStorage.setItem("tema-portal", tema);

    // O item do menu diz para onde vai, nao onde esta: no escuro oferece o
    // claro, e vice-versa. Os icones (sol/lua) sao trocados pelo CSS.
    botao.querySelector("[data-tema-texto]").textContent =
      tema === "escuro" ? "Tema claro" : "Tema escuro";
  }

  botao.addEventListener("click", () => {
    const atual = document.documentElement.dataset.tema;
    aplicar(atual === "escuro" ? "claro" : "escuro");
  });

  // O <head> ja pintou o tema salvo; aqui so acerta o estado do botao.
  aplicar(document.documentElement.dataset.tema ?? "claro");
}

//ZOOM: SO O QUADRO (<main class="portal">), NUNCA O TOPO. O zoom do CSS
//escala tudo que esta dentro dele; a escolha fica salva neste navegador,
//com chave propria, como o tema.
const ZOOM_MINIMO = 0.5;
const ZOOM_MAXIMO = 1.5;
const ZOOM_PASSO_BOTAO = 0.1;
// A roda (e a pinca do touchpad, que chega como Ctrl + roda) vem em muitos
// eventos seguidos: passo menor para o zoom andar suave, sem saltos.
const ZOOM_PASSO_RODA = 0.05;

//Os controles moram no menu de 3 pontinhos (que fica aberto enquanto se mexe
//neles); aqui nao ha painel proprio para abrir ou fechar.
function ligarZoom() {
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

  // input, e nao change: o quadro acompanha a bolinha enquanto ela e arrastada.
  slider.addEventListener("input", () => aplicar(Number(slider.value) / 100));
  menos.addEventListener("click", () => aplicar(atual() - ZOOM_PASSO_BOTAO));
  mais.addEventListener("click", () => aplicar(atual() + ZOOM_PASSO_BOTAO));
  redefinir.addEventListener("click", () => aplicar(1));

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

//AVISO DO SITE: NO LUGAR DO alert() DO NAVEGADOR. Aparece no canto de baixo,
//some sozinho e pode trazer uma acao (ex.: "Desfazer").
//tipo: "info" | "sucesso" | "erro". Erro fica mais tempo na tela.
const avisoSite = document.querySelector("[data-aviso-site]");
const avisoSiteIcone = document.querySelector("[data-aviso-site-icone]");
const avisoSiteTexto = document.querySelector("[data-aviso-site-texto]");
const avisoSiteAcao = document.querySelector("[data-aviso-site-acao]");

const ICONES_AVISO = {
  info: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  sucesso: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m8.5 12.2 2.4 2.4 4.6-4.9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  erro: '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5v5.5M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

let avisoSiteTimer = null;
let avisoSiteDuracao = 0;

function esconderAvisoSite() {
  clearTimeout(avisoSiteTimer);

  if (avisoSite.matches(":popover-open")) avisoSite.hidePopover();
}

function avisarNoSite(texto, { tipo = "info", acao = null } = {}) {
  clearTimeout(avisoSiteTimer);

  avisoSite.dataset.tipo = tipo;
  avisoSiteIcone.innerHTML = ICONES_AVISO[tipo] ?? ICONES_AVISO.info;
  avisoSiteTexto.textContent = texto;

  avisoSiteAcao.hidden = !acao;
  avisoSiteAcao.onclick = null;

  if (acao) {
    avisoSiteAcao.textContent = acao.rotulo;
    avisoSiteAcao.onclick = () => {
      esconderAvisoSite();
      acao.aoClicar();
    };
  }

  // Esconde e mostra de novo: um popover aberto antes de um <dialog> ficaria
  // por baixo dele; reabrir traz o aviso para a frente.
  if (avisoSite.matches(":popover-open")) avisoSite.hidePopover();
  avisoSite.showPopover();

  // Com botao de acao, mais tempo para a pessoa conseguir clicar.
  avisoSiteDuracao = tipo === "erro" ? 7000 : acao ? 6500 : 4000;
  avisoSiteTimer = setTimeout(esconderAvisoSite, avisoSiteDuracao);
}

document.querySelector("[data-aviso-site-fechar]").addEventListener("click", esconderAvisoSite);

// Mouse em cima segura o aviso na tela; saiu, volta a contar.
avisoSite.addEventListener("mouseenter", () => clearTimeout(avisoSiteTimer));
avisoSite.addEventListener("mouseleave", () => {
  if (!avisoSite.matches(":popover-open")) return;

  avisoSiteTimer = setTimeout(esconderAvisoSite, 2500);
});

//CONFIRMACAO DO SITE: NO LUGAR DO confirm() DO NAVEGADOR. Devolve uma
//Promise com true (confirmou) ou false (cancelou, Esc ou clique fora).
//So para o que nao da para desfazer — o que e reversivel usa aviso com
//"Desfazer" em vez de perguntar antes.
const janelaConfirmacao = document.querySelector("[data-confirmacao]");

janelaConfirmacao?.addEventListener("click", (evento) => {
  if (evento.target === janelaConfirmacao) janelaConfirmacao.close("cancelar");
});

function confirmarNoSite({ titulo, mensagem, confirmar = "Confirmar", perigo = false }) {
  document.querySelector("[data-confirmacao-titulo]").textContent = titulo;
  document.querySelector("[data-confirmacao-mensagem]").textContent = mensagem;

  const botao = document.querySelector("[data-confirmacao-confirmar]");
  botao.textContent = confirmar;
  botao.classList.toggle("confirmacao__botao--perigo", perigo);

  janelaConfirmacao.returnValue = "";
  // O foco cai no primeiro botao (Cancelar): Enter sem querer nao apaga nada.
  janelaConfirmacao.showModal();

  return new Promise((resolver) => {
    janelaConfirmacao.addEventListener(
      "close",
      () => resolver(janelaConfirmacao.returnValue === "confirmar"),
      { once: true },
    );
  });
}

//SO A EQUIPE DE TI ATENDE CHAMADOS. O RLS JA PROTEGE OS DADOS; ISSO EVITA
//DEIXAR UM SOLICITANTE OLHANDO UM QUADRO QUE NUNCA VAI TER NADA PRA ELE.
//Devolve o id de quem esta logado se ele atende, ou null se nao — o id e
//usado depois como autor das mensagens.
//
//Analista E admin, mesma lista de is_equipe_ti() no banco e do
//portal-guard.js (que barra a entrada antes desta funcao rodar). Antes aqui
//so passava admin, o que na pratica deixava o Portal restrito a admin
//mesmo com o banco permitindo analista.
async function quemEstaAtendendo() {
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: perfil } = await supabase
    .from("usuarios")
    .select("perfil, notificacoes_ativas")
    .eq("id", user.id)
    .single();

  if (!["analista", "admin"].includes(perfil?.perfil)) return null;

  return { id: user.id, perfil: perfil.perfil, notificacoesAtivas: perfil.notificacoes_ativas };
}

//RODAPE DO CARD: QUEM ESTA ATENDENDO. Foto maior e o primeiro nome ao lado,
//para dar para saber de quem e o ticket sem abrir. Usado ao montar o card e
//ao atualiza-lo depois de uma edicao no detalhe, para os dois sairem iguais.
function desenharMembrosDoCard(container, chamadoMembros, chamadoTerceiros = []) {
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

  // Mesmo chip do detalhe: icone de empresa em vez de foto, pra dar pra ver
  // de relance no card do quadro que um fornecedor esta acionado, sem abrir
  // o chamado.
  chamadoTerceiros.forEach((vinculo) => {
    const fornecedor = vinculo.terceiros;

    if (!fornecedor?.nome) return;

    const chip = document.createElement("span");
    chip.className = "card__membro-chip card__membro-chip--terceiro";

    const icone = montarAvatarTerceiro(fornecedor, "card__membro card__membro--terceiro");

    const nome = document.createElement("span");
    nome.className = "card__membro-nome";
    nome.textContent = fornecedor.nome;

    chip.append(icone, nome);
    container.appendChild(chip);
  });
}

//FILTROS DO QUADRO: MEMBROS, PRIORIDADE, UNIDADE E CATEGORIA.
//Dentro de um grupo vale qualquer opcao marcada (unidade A ou B); entre
//grupos, todas precisam bater (membro X e categoria Y). Grupo sem nada
//marcado nao filtra. Fica salvo neste navegador.
const GRUPOS_FILTRO = ["membros", "prioridade", "unidade", "categoria"];
const SEM_MEMBRO = "__sem-membro";
const CHAVE_FILTROS = "filtros-portal";

function filtrosVazios() {
  return Object.fromEntries(GRUPOS_FILTRO.map((grupo) => [grupo, []]));
}

function lerFiltrosSalvos() {
  const filtros = filtrosVazios();

  try {
    const salvos = JSON.parse(localStorage.getItem(CHAVE_FILTROS) ?? "null");

    GRUPOS_FILTRO.forEach((grupo) => {
      if (Array.isArray(salvos?.[grupo])) {
        filtros[grupo] = salvos[grupo].filter((valor) => typeof valor === "string");
      }
    });
  } catch {
    // Salvo corrompido ou localStorage bloqueado: comeca sem filtro.
  }

  return filtros;
}

let filtrosDoQuadro = lerFiltrosSalvos();

function totalDeFiltros() {
  return GRUPOS_FILTRO.reduce((soma, grupo) => soma + filtrosDoQuadro[grupo].length, 0);
}

// Mesma regra das etiquetas do card: sem flag marcada, e Normal.
function prioridadesDoChamado(chamado) {
  const marcadas = [
    chamado.eh_urgente && "urgente",
    chamado.eh_prioridade && "prioridade",
  ].filter(Boolean);

  return marcadas.length ? marcadas : ["normal"];
}

function unidadeDoChamado(chamado) {
  return chamado.unidades?.nome ?? "Sem unidade";
}

function categoriaDoChamado(chamado) {
  return chamado.categorias?.nome ?? "Sem categoria";
}

function chamadoPassaNosFiltros(chamado) {
  const { membros, prioridade, unidade, categoria } = filtrosDoQuadro;

  if (membros.length) {
    const ids = chamado.chamado_membros.map((membro) => membro.usuario_id);
    const bate = membros.some((id) => (id === SEM_MEMBRO ? ids.length === 0 : ids.includes(id)));

    if (!bate) return false;
  }

  if (prioridade.length && !prioridadesDoChamado(chamado).some((chave) => prioridade.includes(chave))) {
    return false;
  }

  if (unidade.length && !unidade.includes(unidadeDoChamado(chamado))) return false;
  if (categoria.length && !categoria.includes(categoriaDoChamado(chamado))) return false;

  return true;
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

  //MEMBROS: antes do status no DOM porque o status agora e uma faixa
  //full-width que fecha o card embaixo — precisa ser o ultimo filho.
  const membros = document.createElement("div");
  membros.className = "card__membros";
  desenharMembrosDoCard(membros, chamado.chamado_membros, chamado.chamado_terceiros);
  card.appendChild(membros);

  //STATUS: faixa full-width na base do card — a cor do status vive so
  //aqui agora, sem duplicar num contorno lateral.
  const status = derivarStatus(chamado);
  const selo = document.createElement("span");
  selo.className = `card__status card__status--${status.chave}`;
  selo.textContent = status.rotulo;
  card.appendChild(selo);

  // Ja nasce escondido se nao passa no filtro: vale para a carga, para o
  // chamado que chega pelo tempo real e para o reaberto.
  card.classList.toggle("card--filtrado", !chamadoPassaNosFiltros(chamado));

  return card;
}

//ORDENACAO DOS CARDS DENTRO DE UMA LISTA: escolha por lista, so deste
//navegador (nao mexe no banco — pedido explicito do usuario, "frontend
//localstorage"). "inclusao" e a ordem natural que ja vem do banco
//(abertura_em desc, mais novo primeiro); as outras reordenam por cima.
const CHAVE_ORDEM_LISTAS = "ordem-listas-portal";

function lerOrdensSalvas() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_ORDEM_LISTAS)) ?? {};
  } catch {
    return {};
  }
}

function ordemSalvaDaLista(filaId) {
  return lerOrdensSalvas()[filaId] ?? "inclusao";
}

function salvarOrdemDaLista(filaId, criterio) {
  const todas = lerOrdensSalvas();

  todas[filaId] = criterio;
  localStorage.setItem(CHAVE_ORDEM_LISTAS, JSON.stringify(todas));
}

//eh_urgente E eh_urgente+eh_prioridade contam mais que so eh_prioridade —
//mesma hierarquia visual que as etiquetas do card ja usam.
function pesoDePrioridade(chamado) {
  if (chamado.eh_urgente && chamado.eh_prioridade) return 3;
  if (chamado.eh_urgente) return 2;
  if (chamado.eh_prioridade) return 1;
  return 0;
}

function ordenarChamados(chamados, criterio) {
  const lista = [...chamados];

  if (criterio === "prioridade") {
    // Empate de prioridade mantem a ordem de inclusao (sort estavel).
    return lista.sort((a, b) => pesoDePrioridade(b) - pesoDePrioridade(a));
  }

  if (criterio === "numero") {
    return lista.sort((a, b) => a.numero - b.numero);
  }

  // "inclusao": e a ordem que ja chega (abertura_em desc) — nao mexe.
  return lista;
}

const ROTULOS_ORDEM = { inclusao: "Data de inclusão", prioridade: "Prioridade", numero: "Número do ticket" };

//MENU DE 3 PONTINHOS DA LISTA: ordenar (3 opcoes, marca a atual) + arquivar.
//So monta o HTML — abrir/fechar/clicar e tudo delegado em ligarArrastarLista,
//que ja escuta o quadro inteiro (mesmo motivo do ligarArrastar de cards:
//um listener so, em vez de um por coluna, porque colunas nascem e somem).
function montarMenuDaLista(fila) {
  const menu = document.createElement("div");
  menu.className = "fila__menu";

  const botao = document.createElement("button");
  botao.type = "button";
  botao.className = "fila__menu-botao";
  botao.dataset.filaMenuAbrir = fila.id;
  botao.setAttribute("aria-haspopup", "true");
  botao.setAttribute("aria-expanded", "false");
  botao.setAttribute("aria-label", `Opções da lista ${fila.nome}`);
  botao.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">'
    + '<circle cx="12" cy="5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>'
    + '<circle cx="12" cy="19" r="1.5" fill="currentColor"/></svg>';

  const painel = document.createElement("div");
  painel.className = "fila__menu-painel";
  painel.hidden = true;

  const titulo = document.createElement("p");
  titulo.className = "fila__menu-titulo";
  titulo.textContent = "Ordenar cartões por";
  painel.appendChild(titulo);

  const ordemAtual = ordemSalvaDaLista(fila.id);

  Object.entries(ROTULOS_ORDEM).forEach(([criterio, rotulo]) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "fila__menu-item";
    item.classList.toggle("fila__menu-item--marcado", criterio === ordemAtual);
    item.dataset.filaMenuOrdenar = criterio;

    const texto = document.createElement("span");
    texto.textContent = rotulo;

    const marca = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    marca.setAttribute("viewBox", "0 0 24 24");
    marca.setAttribute("width", "14");
    marca.setAttribute("height", "14");
    marca.setAttribute("aria-hidden", "true");
    marca.innerHTML = '<path d="m5 12.5 4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

    item.append(texto, marca);
    painel.appendChild(item);
  });

  const divisor = document.createElement("span");
  divisor.className = "fila__menu-divisor";
  painel.appendChild(divisor);

  const arquivar = document.createElement("button");
  arquivar.type = "button";
  arquivar.className = "fila__menu-item fila__menu-item--perigo";
  arquivar.dataset.filaMenuArquivar = fila.id;
  arquivar.textContent = "Arquivar esta lista";
  painel.appendChild(arquivar);

  menu.append(botao, painel);

  return menu;
}

function montarFila(fila, chamados) {
  const coluna = document.createElement("section");
  coluna.className = "fila";
  coluna.dataset.fila = fila.id;
  // draggable fica na COLUNA inteira, mas o listener de dragstart (em
  // ligarArrastarLista) so aceita comecar pelo .fila__topo — arrastar um
  // card nao pode also mover a lista inteira.
  coluna.draggable = true;

  const topo = document.createElement("header");
  topo.className = "fila__topo";

  const nome = document.createElement("h2");
  nome.className = "fila__nome";
  nome.textContent = fila.nome;

  const acoes = document.createElement("div");
  acoes.className = "fila__topo-acoes";

  const contador = document.createElement("span");
  contador.className = "fila__contador";
  contador.textContent = chamados.length;

  const menu = montarMenuDaLista(fila);

  acoes.append(contador, menu);
  // A COLUNA TEM cursor:grab NO TOPO INTEIRO; o clique no botao/menu nao
  // pode iniciar um arrasto — impede propagar ate o listener de dragstart
  // do quadro (ligarArrastarLista so aceita comecar de fora do .fila__menu).
  topo.append(nome, acoes);
  coluna.appendChild(topo);

  const lista = document.createElement("ul");
  lista.className = "fila__cards";

  const ordenados = ordenarChamados(chamados, ordemSalvaDaLista(fila.id));

  if (ordenados.length) {
    ordenados.forEach((chamado) => lista.appendChild(montarCard(chamado)));
  } else {
    const vazia = document.createElement("li");
    vazia.className = "fila__vazia";
    vazia.textContent = "Nenhum chamado";
    lista.appendChild(vazia);
  }

  coluna.appendChild(lista);

  // Contador e aviso de vazio ja levando em conta o filtro salvo.
  sincronizarColuna(coluna);

  return coluna;
}

//REDESENHA SO OS CARDS DE UMA COLUNA JA NA TELA, na nova ordem — usado
//quando a pessoa troca o criterio no menu (sem precisar recarregar tudo
//nem buscar de novo no banco). `chamados` e a lista completa do quadro;
//filtra so os desta coluna, reordena, e so troca a posicao dos <li> —
//os elementos card em si nao sao recriados.
function reordenarColunaNaTela(coluna, chamados, criterio) {
  const filaId = coluna.dataset.fila;
  const lista = coluna.querySelector(".fila__cards");

  const daFila = chamados.filter(
    (chamado) => chamado.fila_id === filaId && !chamado.fechamento_em,
  );

  if (!daFila.length) return;

  const porId = new Map(
    [...lista.querySelectorAll(".card")].map((card) => [card.dataset.chamado, card]),
  );

  ordenarChamados(daFila, criterio).forEach((chamado) => {
    const card = porId.get(chamado.id);
    if (card) lista.appendChild(card);
  });
}

//FLIP (First, Last, Invert, Play): anima um elemento que "pulou" de lugar
//no DOM. Mede a posicao ANTES de mexer, deixa o mexer acontecer, mede a
//posicao DEPOIS, e anima so a diferenca via transform — o navegador so
//faz layout uma vez, o "movimento" e uma ilusao de transform recuando ate
//zero. Usado no drop de card e de lista, pra nao "pular" direto pro lugar
//novo.
const RESPEITA_MOVIMENTO_REDUZIDO =
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function comAnimacaoFlip(elementos, mudarDom) {
  if (RESPEITA_MOVIMENTO_REDUZIDO) {
    mudarDom();
    return;
  }

  const antes = new Map(
    elementos.map((elemento) => [elemento, elemento.getBoundingClientRect()])
  );

  mudarDom();

  for (const elemento of elementos) {
    const rectAntes = antes.get(elemento);
    if (!rectAntes) continue;

    const rectDepois = elemento.getBoundingClientRect();
    const deltaX = rectAntes.left - rectDepois.left;
    const deltaY = rectAntes.top - rectDepois.top;

    if (!deltaX && !deltaY) continue;

    elemento.style.transition = "none";
    elemento.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

    requestAnimationFrame(() => {
      elemento.style.transition = "";
      elemento.style.transform = "";
    });
  }
}

//ATUALIZA O CONTADOR E O AVISO DE VAZIO DE UMA COLUNA DEPOIS DE MOVER UM
//CARD. Conta so o que esta aparecendo: com filtro ligado, o numero bate com
//os cards que a pessoa ve.
function sincronizarColuna(coluna) {
  const lista = coluna.querySelector(".fila__cards");
  const cards = lista.querySelectorAll(".card");
  const visiveis = lista.querySelectorAll(".card:not(.card--filtrado)");
  const vazia = lista.querySelector(".fila__vazia");

  coluna.querySelector(".fila__contador").textContent = visiveis.length;

  if (visiveis.length) {
    vazia?.remove();
    return;
  }

  // Coluna sem nada na tela: diz se esta vazia de verdade ou se foi o filtro.
  const texto = cards.length ? "Nenhum chamado com esses filtros" : "Nenhum chamado";

  if (vazia) {
    vazia.textContent = texto;
    return;
  }

  const aviso = document.createElement("li");
  aviso.className = "fila__vazia";
  aviso.textContent = texto;
  lista.appendChild(aviso);
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
    const cardsAfetados = [
      card,
      ...coluna.querySelectorAll(".card"),
      ...colunaOrigem.querySelectorAll(".card"),
    ];

    // Move na hora: a tela responde antes do banco confirmar.
    comAnimacaoFlip(cardsAfetados, () => {
      coluna.querySelector(".fila__cards").appendChild(card);
      card.dataset.fila = filaDestino;
    });
    sincronizarColuna(coluna);
    sincronizarColuna(colunaOrigem);

    const { error } = await supabase
      .from("chamados")
      .update({ fila_id: filaDestino, fila_anterior_id: filaOrigem })
      .eq("id", card.dataset.chamado);

    if (!error) return;

    // Banco recusou: devolve o card para onde estava.
    comAnimacaoFlip(cardsAfetados, () => {
      colunaOrigem.querySelector(".fila__cards").appendChild(card);
      card.dataset.fila = filaOrigem;
    });
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
    // .fila__topo arrasta a LISTA (ligarArrastarLista, HTML5 drag nativo);
    // sem essa exclusao os dois arrastos comecavam juntos e brigavam.
    if (evento.target.closest(".fila__topo")) return;
    // .fila-nova e o botao/formulario de "Adicionar outra lista": sem esta
    // exclusao, o pointerdown chamava setPointerCapture no quadro ANTES do
    // clique no botao completar, e o clique nunca chegava no listener dele
    // (achado testando de verdade — um clique simulado via elemento.click()
    // funcionava, mas o clique de mouse real do Playwright nao).
    if (evento.target.closest(".fila-nova")) return;

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

//ARRASTAR LISTA: MUDA A ORDEM DAS COLUNAS. Mesma ideia do arrastar de card
//(ligarArrastar) — move na tela na hora, grava `ordem` no banco, desfaz se
//der erro. Um listener so no quadro (delegado), porque colunas nascem e
//somem (arquivar, adicionar).
//
//O MESMO listener tambem cuida do menu de 3 pontinhos de cada lista (abrir/
//fechar/clicar em ordenar ou arquivar) — nao e arrasto, mas mora aqui
//porque os dois vivem no cabecalho da coluna (.fila__topo) e um so
//addEventListener("click") no quadro cobre os dois.
function ligarArrastarLista(filas, chamados) {
  let colunaArrastada = null;

  // O NAVEGADOR NAO PRESERVA ONDE DENTRO DA COLUNA O MOUSE FOI PRESSIONADO:
  // draggable="true" esta na SECTION.fila inteira (tem que estar — e ela
  // que se move), mas o dragstart sempre reporta evento.target = a propria
  // SECTION, nunca um descendente como .fila__topo, nao importa em qual
  // pixel dentro dela o arrasto comecou. Descoberto testando um arrasto de
  // verdade (Playwright dragTo, nao um DragEvent sintetico — o sintetico
  // deixa escolher o target a mao e escondia esse comportamento): olhar
  // evento.target.closest(".fila__topo") no dragstart sempre falhava, e o
  // arrasto nunca comecava.
  //
  // A saida e nao depender do target do dragstart: um mousedown (que SIM
  // reporta o elemento exato pressionado) guarda se foi no cabecalho, e o
  // dragstart so consulta essa flag.
  let mousedownNoTopo = false;

  quadro.addEventListener("mousedown", (evento) => {
    mousedownNoTopo = Boolean(evento.target.closest(".fila__topo"));
  });

  quadro.addEventListener("dragstart", (evento) => {
    // Um card tambem e draggable e fica DENTRO da coluna — sem essa
    // checagem, arrastar um card tambem contaria como arrastar a lista
    // (o dragstart do card nao sobe ate aqui, mas o mousedown sim: se o
    // botao foi pressionado num card dentro do topo por engano nunca
    // aconteceria, .fila__topo nao contem card nenhum).
    if (!mousedownNoTopo) return;

    const coluna = evento.target.closest(".fila");

    if (!coluna) return;

    colunaArrastada = coluna;
    colunaArrastada.classList.add("fila--arrastando");
    evento.dataTransfer.effectAllowed = "move";
  });

  // Coluna sobre a qual o mouse esta agora, durante o arrasto — so uma
  // referencia visual (classe fila--alvo-lista), NADA e movido no DOM
  // aqui. So mesmo move no drop, nunca no dragover — mesmo padrao que
  // ligarArrastar (o dos cards) ja usava antes desta feature existir.
  let colunaAlvo = null;

  quadro.addEventListener("dragend", () => {
    colunaArrastada?.classList.remove("fila--arrastando");
    quadro.querySelectorAll(".fila--alvo-lista")
      .forEach((coluna) => coluna.classList.remove("fila--alvo-lista"));
    colunaArrastada = null;
    mousedownNoTopo = false;
    colunaAlvo = null;
    pararAutoScroll();
  });

  quadro.addEventListener("dragover", (evento) => {
    if (!colunaArrastada) return;

    evento.preventDefault();
    evento.dataTransfer.dropEffect = "move";
    avaliarAutoScroll(evento.clientX);

    const alvo = evento.target.closest(".fila");

    if (!alvo || alvo === colunaArrastada) return;

    if (alvo !== colunaAlvo) {
      quadro.querySelectorAll(".fila--alvo-lista")
        .forEach((outra) => outra.classList.remove("fila--alvo-lista"));
      alvo.classList.add("fila--alvo-lista");
      colunaAlvo = alvo;
    }
  });

  quadro.addEventListener("drop", async (evento) => {
    if (!colunaArrastada) return;

    evento.preventDefault();
    pararAutoScroll();

    // SO AGORA move no DOM, ja com o gesto de arrastar encerrado (drop e
    // o ultimo evento antes do dragend) — nao ha mais sessao de arrasto
    // pra perder.
    if (colunaAlvo && colunaAlvo !== colunaArrastada) {
      const todasAsColunas = [...quadro.querySelectorAll(".fila")];
      const antes = todasAsColunas.indexOf(colunaArrastada) < todasAsColunas.indexOf(colunaAlvo);

      comAnimacaoFlip(todasAsColunas, () => {
        colunaAlvo.insertAdjacentElement(antes ? "afterend" : "beforebegin", colunaArrastada);
      });
    }

    // `ordem` vira o indice, de 10 em 10: deixa espaco pra alguem soltar
    // entre duas sem precisar renumerar tudo depois (nao e usado ainda,
    // mas custa nada deixar a folga).
    const novaOrdem = [...quadro.querySelectorAll(".fila")].map((coluna, indice) => ({
      id: coluna.dataset.fila,
      ordem: (indice + 1) * 10,
    }));

    // Atualiza local primeiro (os objetos que ligarFiltros/ligarBusca etc.
    // ja tem referencia) para o proximo recarregamento de filtro nao
    // reordenar errado antes do banco confirmar.
    novaOrdem.forEach(({ id, ordem }) => {
      const fila = filas.find((outra) => outra.id === id);
      if (fila) fila.ordem = ordem;
    });

    const resultados = await Promise.all(
      novaOrdem.map(({ id, ordem }) => supabase.from("filas").update({ ordem }).eq("id", id)),
    );

    if (resultados.some((resultado) => resultado.error)) {
      mostrarErro("Não foi possível salvar a nova ordem das listas. Recarregue a página.");
    }
  });

  /* ----------------------------------------------------------------------
     MENU DE 3 PONTINHOS: abrir/fechar, ordenar, arquivar.
     ---------------------------------------------------------------------- */

  function fecharTodosOsMenus() {
    quadro.querySelectorAll(".fila__menu-painel").forEach((painel) => { painel.hidden = true; });
    quadro.querySelectorAll("[data-fila-menu-abrir]")
      .forEach((botao) => botao.setAttribute("aria-expanded", "false"));
  }

  quadro.addEventListener("click", async (evento) => {
    const botaoAbrir = evento.target.closest("[data-fila-menu-abrir]");

    if (botaoAbrir) {
      const painel = botaoAbrir.parentElement.querySelector(".fila__menu-painel");
      const abrindo = painel.hidden;

      fecharTodosOsMenus();
      painel.hidden = !abrindo;
      botaoAbrir.setAttribute("aria-expanded", String(abrindo));
      return;
    }

    const itemOrdenar = evento.target.closest("[data-fila-menu-ordenar]");

    if (itemOrdenar) {
      const coluna = itemOrdenar.closest(".fila");
      const criterio = itemOrdenar.dataset.filaMenuOrdenar;

      salvarOrdemDaLista(coluna.dataset.fila, criterio);

      coluna.querySelectorAll(".fila__menu-item[data-fila-menu-ordenar]").forEach((item) => {
        item.classList.toggle("fila__menu-item--marcado", item.dataset.filaMenuOrdenar === criterio);
      });

      reordenarColunaNaTela(coluna, chamados, criterio);
      fecharTodosOsMenus();
      return;
    }

    const botaoArquivar = evento.target.closest("[data-fila-menu-arquivar]");

    if (botaoArquivar) {
      fecharTodosOsMenus();

      const filaId = botaoArquivar.dataset.filaMenuArquivar;
      const coluna = quadro.querySelector(`.fila[data-fila="${filaId}"]`);
      const fila = filas.find((outra) => outra.id === filaId);
      const temChamado = coluna?.querySelectorAll(".card").length > 0;

      if (temChamado) {
        avisarNoSite(
          `"${fila?.nome ?? "Esta lista"}" tem chamado dentro. Mova os chamados antes de arquivar.`,
          { tipo: "erro" },
        );
        return;
      }

      const confirmou = await confirmarNoSite({
        titulo: "Arquivar lista?",
        mensagem: `"${fila?.nome ?? "Esta lista"}" some do quadro. Reative pelo Painel > Listas quando precisar dela de volta.`,
        confirmar: "Arquivar",
        perigo: true,
      });

      if (!confirmou) return;

      const { error } = await supabase.from("filas").update({ ativo: false }).eq("id", filaId);

      if (error) {
        avisarNoSite("Não foi possível arquivar a lista. Tente de novo.", { tipo: "erro" });
        return;
      }

      coluna?.remove();
      window.dispatchEvent(new Event("resize")); // a barra de rolagem propria recalcula
      avisarNoSite(`"${fila?.nome ?? "Lista"}" foi arquivada.`, { tipo: "sucesso" });
    }
  });

  // FECHA O MENU CLICANDO FORA OU COM ESC — mesma regra do menu de 3
  // pontinhos do quadro (ligarQuadroMenu).
  document.addEventListener("click", (evento) => {
    if (evento.target.closest(".fila__menu")) return;
    fecharTodosOsMenus();
  });

  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape") fecharTodosOsMenus();
  });
}

//ADICIONAR NOVA LISTA: botao vira formulario, cria em filas e monta a
//coluna na tela — sempre antes do proprio botao (que continua por ultimo).
function ligarListaNova(filas) {
  const caixa = document.querySelector("[data-fila-nova]");
  const botaoAbrir = document.querySelector("[data-fila-nova-abrir]");
  const formulario = document.querySelector("[data-fila-nova-form]");
  const campo = document.querySelector("[data-fila-nova-campo]");
  const botaoCancelar = document.querySelector("[data-fila-nova-cancelar]");

  function abrirForm() {
    botaoAbrir.hidden = true;
    formulario.hidden = false;
    campo.value = "";
    campo.focus();
  }

  function fecharForm() {
    formulario.hidden = true;
    botaoAbrir.hidden = false;
  }

  botaoAbrir.addEventListener("click", abrirForm);
  botaoCancelar.addEventListener("click", fecharForm);

  campo.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape") fecharForm();
  });

  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();

    const nome = campo.value.trim();

    if (!nome) return;

    const botaoSalvar = formulario.querySelector(".fila-nova__salvar");
    botaoSalvar.disabled = true;

    const proximaOrdem = Math.max(0, ...filas.map((fila) => fila.ordem ?? 0)) + 10;

    const { data, error } = await supabase
      .from("filas")
      .insert({ nome, ordem: proximaOrdem, ativo: true })
      .select("id, nome, ordem")
      .single();

    botaoSalvar.disabled = false;

    if (error || !data) {
      mostrarErro("Não foi possível criar a lista. Tente de novo.");
      return;
    }

    filas.push(data);
    caixa.parentElement.insertBefore(montarFila(data, []), caixa);
    window.dispatchEvent(new Event("resize"));
    fecharForm();
  });

  document.addEventListener("click", (evento) => {
    if (formulario.hidden) return;
    if (evento.target.closest("[data-fila-nova]")) return;
    fecharForm();
  });
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
    const fechado = Boolean(chamado.fechamento_em);
    const item = document.createElement("button");
    item.className = "busca__item";
    // Fechado aparece tambem, mas em outra cor: da para achar um ticket
    // antigo sem confundir com o que ainda esta em atendimento.
    item.classList.toggle("busca__item--fechado", fechado);
    item.type = "button";

    const icone = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icone.setAttribute("class", "busca__item-icone");
    icone.setAttribute("viewBox", "0 0 24 24");
    icone.setAttribute("width", "13");
    icone.setAttribute("height", "13");
    icone.innerHTML = '<rect x="3.5" y="5" width="17" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7.5 9.5h9M7.5 13h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>';

    const texto = document.createElement("span");
    texto.className = "busca__item-texto";

    const linhaTitulo = document.createElement("span");
    linhaTitulo.className = "busca__item-linha";

    const titulo = document.createElement("span");
    titulo.className = "busca__item-titulo";
    // O mesmo titulo do card, para a pessoa reconhecer o que esta procurando.
    titulo.textContent = tituloDoChamado(chamado);

    linhaTitulo.appendChild(titulo);

    if (fechado) {
      const selo = document.createElement("span");
      selo.className = "busca__item-selo";
      selo.textContent = "Finalizado";
      linhaTitulo.appendChild(selo);
    }

    const contexto = document.createElement("span");
    contexto.className = "busca__item-contexto";
    contexto.textContent = [
      fechado
        ? `Fechado em ${formatarData(chamado.fechamento_em)}`
        : nomeDaFila.get(chamado.fila_id),
      nomeCompleto(chamado.usuarios),
      chamado.unidades?.nome,
    ].filter(Boolean).join(" • ");

    texto.append(linhaTitulo, contexto);
    item.append(icone, texto);

    //CLICAR ABRE O CHAMADO, IGUAL A CLICAR NO CARD. Se ele esta no quadro, o
    //card tambem e destacado por tras, para quem fechar o detalhe ver onde ele fica.
    item.addEventListener("click", () => {
      fechar();
      campo.value = "";

      if (!fechado) irAteOCard(chamado);

      detalhe.abrir(chamado);
    });

    return item;
  }

  //ACHADOS EM MEMORIA: os abertos, que estao todos carregados.
  function acharEmMemoria(busca) {
    return chamados.filter((chamado) => [
      `ticket-${chamado.numero}`,
      String(chamado.numero),
      // O titulo pode ter sido editado ("SJC SR VALTER - Equipamentos"):
      // procurar pelo que aparece no card tem de achar.
      chamado.titulo,
      chamado.categorias?.nome,
      // Busca pelo nome completo: procurar pelo sobrenome tem de achar.
      nomeCompleto(chamado.usuarios),
      chamado.unidades?.nome,
      chamado.descricao,
    ].some((campo) => campo?.toLowerCase().includes(busca)));
  }

  //ACHADOS NO BANCO: os fechados, que NAO estao em memoria. Vai ao servidor
  //em vez de baixar o historico inteiro — com ~14 mil chamados, carregar tudo
  //so para filtrar no navegador seria desperdicio a cada busca.
  //
  //Procura no titulo e na descricao; digitando so numeros, tambem pelo numero
  //do ticket. Menos campos que a busca em memoria (nome do solicitante,
  //unidade e categoria estao em outras tabelas e exigiriam junção), mas cobre
  //o caso real de procurar um ticket antigo pelo numero ou pelo assunto.
  async function acharNoBanco(busca) {
    const escapado = busca.replace(/[%_,()]/g, " ").trim();

    if (!escapado) return [];

    const condicoes = [`titulo.ilike.%${escapado}%`, `descricao.ilike.%${escapado}%`];

    if (/^\d+$/.test(escapado)) condicoes.push(`numero.eq.${escapado}`);

    const { data, error } = await supabase
      .from("chamados")
      .select(CAMPOS_CHAMADO)
      .not("fechamento_em", "is", null)
      .or(condicoes.join(","))
      .order("fechamento_em", { ascending: false })
      .limit(8);

    if (error) {
      console.warn("Busca: não foi possível procurar nos finalizados", error);
      return [];
    }

    return data ?? [];
  }

  // Cada tecla dispara uma busca; sem isto uma resposta lenta poderia chegar
  // depois de uma mais nova e sobrescrever a tela com o resultado antigo.
  let buscaAtual = 0;

  async function buscar(termo) {
    const busca = termo.trim().toLowerCase();

    if (!busca) {
      fechar();
      return;
    }

    const minhaBusca = ++buscaAtual;
    const emMemoria = acharEmMemoria(busca);

    // Desenha já o que temos em memória e completa com os fechados quando a
    // consulta volta: quem procura um chamado do quadro vê o resultado na
    // hora, sem esperar a rede. Sem nada em memória não desenha ainda —
    // mostrar "Nenhum chamado encontrado" para depois trocar pelos
    // finalizados faria a resposta piscar.
    if (emMemoria.length) desenhar(emMemoria);

    const doBanco = await acharNoBanco(busca);

    if (minhaBusca !== buscaAtual) return;

    const conhecidos = new Set(emMemoria.map((chamado) => chamado.id));

    desenhar([...emMemoria, ...doBanco.filter((chamado) => !conhecidos.has(chamado.id))]);
  }

  function desenhar(achados) {
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

    // Em atendimento primeiro, finalizados depois; a busca continua
    // mostrando no maximo 8.
    [...achados]
      .sort((a, b) => Boolean(a.fechamento_em) - Boolean(b.fechamento_em))
      .slice(0, 8)
      .forEach((chamado) => painel.appendChild(montarResultado(chamado)));
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
//quadroApi: o que fazer no quadro quando algo muda no detalhe. O Portal passa
//as funcoes do quadro; o Painel (que nao tem quadro) passa um redesenho da
//tabela dele. Assim o mesmo modal serve as duas telas sem duplicar as ~950
//linhas de conversa, anexos, membros e aprovacao.
function ligarDetalhe(chamados, filas, equipe, atendente, quadroApi = {}, perfilAtendente = null, terceiros = []) {
  const {
    // Sem quadro, procurar card sempre devolve nada: cada uso ja trata isso.
    acharCard = (id) => quadro?.querySelector(`[data-chamado="${id}"]`) ?? null,
    aoMudarCard = () => {},
    aoMudarFechamento = () => {},
    // Sem o resumo do quadro na tela (Painel), nao ha o que recontar aqui:
    // quem mostra o total e a propria tela, pelo aoContarChamados dela.
    aoContarChamados = () => { if (resumo) atualizarResumo(chamados, filas.length); },
  } = quadroApi;

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
  const campoPendentes = document.querySelector("[data-conversa-pendentes]");
  const botaoEnviar = document.querySelector("[data-conversa-enviar]");
  const aviso = document.querySelector("[data-detalhe-aviso]");
  const botaoFecharChamado = document.querySelector("[data-detalhe-fechar-chamado]");
  const nomeDaFila = new Map(filas.map((fila) => [fila.id, fila.nome]));

  //APROVACAO DE ACESSO: elementos do painel alternativo (ver comentario
  //no HTML). So existe para o chamado nascido do cadastro.
  const conteudoPadrao = document.querySelector("[data-detalhe-conteudo-padrao]");
  const painelAprovacao = document.querySelector("[data-aprovacao]");
  const campoAprovacaoDados = document.querySelector("[data-aprovacao-dados]");
  const campoAprovacaoSetor = document.querySelector("[data-aprovacao-setor]");
  const campoAprovacaoPerfil = document.querySelector("[data-aprovacao-perfil]");
  const dicaAprovacaoPerfil = document.querySelector("[data-aprovacao-perfil-dica]");
  const avisoAprovacao = document.querySelector("[data-aprovacao-aviso]");
  const botaoAprovar = document.querySelector("[data-aprovacao-aprovar]");
  const botaoRejeitar = document.querySelector("[data-aprovacao-rejeitar]");
  let setoresDisponiveis = [];
  // Enquanto false, trocar o setor re-sugere o perfil; depois que quem
  // aprova escolhe um perfil na mao, a sugestao para de sobrescrever.
  let perfilEscolhidoNaMao = false;

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

  //QUEM RESPONDE ASSUME O CHAMADO: responder ja vincula a pessoa como membro,
  //sem precisar passar pelo +. Quem ja e membro nao muda nada.
  async function vincularComoMembro(chamado) {
    if (chamado.chamado_membros.some((membro) => membro.usuario_id === atendente)) return;

    const { error } = await supabase
      .from("chamado_membros")
      .insert({ chamado_id: chamado.id, usuario_id: atendente });

    // 23505 (chave duplicada): outra aba ja vinculou no meio tempo — o
    // resultado e o mesmo, segue em frente.
    if (error && error.code !== "23505") {
      console.error("Não foi possível vincular quem respondeu como membro:", error);
      return;
    }

    if (!chamado.chamado_membros.some((membro) => membro.usuario_id === atendente)) {
      const eu = equipe.find((pessoa) => pessoa.id === atendente);

      chamado.chamado_membros.push({
        usuario_id: atendente,
        usuarios: {
          id: atendente,
          nome: eu?.nome,
          sobrenome: eu?.sobrenome,
          foto_path: eu?.foto_path,
          cor_destaque: eu?.cor_destaque ?? null,
        },
      });
    }

    if (aberto === chamado) {
      desenharMembros();
      atualizarCard();
      return;
    }

    // Ja trocou de ticket: atualiza so o rodape do card deste.
    const card = acharCard(chamado.id);

    if (card) desenharMembrosDoCard(card.querySelector(".card__membros"), chamado.chamado_membros, chamado.chamado_terceiros);
    aoMudarCard(chamado);
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

  //TERCEIRO ACIONADO: mesma mecanica do membro humano, so que grava em
  //chamado_terceiros (o fornecedor nunca tem conta no sistema).
  async function removerTerceiro(terceiroId) {
    const { error } = await supabase
      .from("chamado_terceiros")
      .delete()
      .eq("chamado_id", aberto.id)
      .eq("terceiro_id", terceiroId);

    if (error) {
      avisar("Não foi possível remover o terceiro.", true);
      return;
    }

    aberto.chamado_terceiros = aberto.chamado_terceiros
      .filter((outro) => outro.terceiro_id !== terceiroId);
    avisar("Salvo");
    desenharMembros();
    atualizarCard();
  }

  async function adicionarTerceiro(fornecedor) {
    const { error } = await supabase
      .from("chamado_terceiros")
      .insert({ chamado_id: aberto.id, terceiro_id: fornecedor.id });

    if (error) {
      avisar("Não foi possível acionar o terceiro.", true);
      return;
    }

    aberto.chamado_terceiros.push({
      terceiro_id: fornecedor.id,
      terceiros: { id: fornecedor.id, nome: fornecedor.nome, foto_path: fornecedor.foto_path },
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

  //PAINEL DO TERCEIRO: mesma estrutura do painel de adicionar membro, so
  //que lista fornecedores (sem foto — usa o mesmo icone de empresa do chip).
  function montarPainelTerceiro(disponiveis) {
    const painel = document.createElement("div");
    painel.className = "detalhe__escolher";

    const titulo = document.createElement("p");
    titulo.className = "detalhe__escolher-titulo";
    titulo.textContent = "Terceiro atendendo";

    const opcoes = document.createElement("div");
    opcoes.className = "detalhe__escolher-opcoes";

    disponiveis.forEach((fornecedor) => {
      const opcao = document.createElement("button");
      opcao.type = "button";
      opcao.className = "detalhe__membro";

      const icone = montarAvatarTerceiro(fornecedor, "detalhe__membro-avatar detalhe__membro-avatar--terceiro");

      opcao.append(icone, document.createTextNode(fornecedor.nome));
      opcao.addEventListener("click", () => {
        painelMembros = null;
        adicionarTerceiro(fornecedor);
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

    // Chip do terceiro: mesmo desenho do membro humano (nome + x), so que
    // com um icone generico de empresa no lugar da foto — nao tem foto
    // porque nao e uma pessoa com conta.
    aberto.chamado_terceiros.forEach((vinculo) => {
      const fornecedor = vinculo.terceiros;

      if (!fornecedor?.nome) return;

      const chip = document.createElement("span");
      chip.className = "detalhe__membro detalhe__membro--fixo detalhe__membro--terceiro";
      chip.title = fornecedor.nome;

      const icone = montarAvatarTerceiro(fornecedor, "detalhe__membro-avatar detalhe__membro-avatar--terceiro");

      const remover = document.createElement("button");
      remover.type = "button";
      remover.className = "detalhe__membro-remover";
      remover.textContent = "×";
      remover.title = `Remover ${fornecedor.nome} do chamado`;
      remover.setAttribute("aria-label", remover.title);
      remover.addEventListener("click", () => removerTerceiro(fornecedor.id));

      chip.append(icone, document.createTextNode(fornecedor.nome), remover);
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

    const terceirosDisponiveis = terceiros.filter((fornecedor) =>
      !aberto.chamado_terceiros.some((vinculo) => vinculo.terceiro_id === fornecedor.id));

    if (painelAberto("terceiro") && !terceirosDisponiveis.length) painelMembros = null;

    campoMembros.appendChild(montarBotaoMembros({
      tipo: "terceiro",
      rotulo: terceirosDisponiveis.length ? "Acionar terceiro" : "Todos os terceiros já estão no chamado",
      desativado: !terceirosDisponiveis.length,
      icone: ICONE_TERCEIRO_SVG,
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
    if (painelAberto("terceiro")) campoMembros.appendChild(montarPainelTerceiro(terceirosDisponiveis));
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

      topo.append(autor, quando);
      balao.append(topo);

      if (comentario.tipo === "solucao") {
        balao.appendChild(montarCardDeSolucao(comentario));
      } else {
        const texto = document.createElement("p");
        texto.className = "comentario__texto";
        texto.textContent = comentario.texto;
        balao.appendChild(texto);
      }

      // Imagens que foram junto com esta mensagem aparecem dentro do balao.
      const imagens = (aberto.anexos ?? [])
        .filter((anexo) => anexo.comentario_id === comentario.id && ehImagem(anexo.nome_arquivo));

      if (imagens.length) balao.appendChild(montarImagensDoComentario(imagens));

      bloco.appendChild(balao);
      campoConversa.appendChild(bloco);
    });

    // A conversa comeca no comentario mais recente. As miniaturas tem
    // tamanho fixo, entao a rolagem nao pula quando as imagens carregam.
    campoConversa.scrollTop = campoConversa.scrollHeight;

    const imagensDaConversa = [...campoConversa.querySelectorAll("img[data-caminho]")];

    if (imagensDaConversa.length) preencherImagens(imagensDaConversa);
  }

  //IMAGEM DENTRO DO BALAO DO CHAT: o anexo que foi junto com uma mensagem
  //aparece nela, e nao so na coluna da direita. O bucket e privado, entao a
  //<img> precisa de URL assinada: pede todas de uma vez (createSignedUrls) e
  //guarda por uma hora — o tempo real redesenha a conversa a cada evento, e
  //sem o cache cada redesenho pediria as URLs de novo.
  const EXTENSOES_IMAGEM = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
  const VALIDADE_URL_IMAGEM = 60 * 60; // segundos
  const urlsDeImagem = new Map(); // storage_path -> { url, expiraEm }

  function ehImagem(nomeArquivo) {
    return EXTENSOES_IMAGEM.test(nomeArquivo ?? "");
  }

  function urlGuardada(caminho) {
    const guardada = urlsDeImagem.get(caminho);

    // Margem de um minuto: URL quase vencendo e tratada como vencida.
    return guardada && guardada.expiraEm > Date.now() + 60_000 ? guardada.url : null;
  }

  async function preencherImagens(imagens) {
    const faltam = [...new Set(imagens.map((imagem) => imagem.dataset.caminho))]
      .filter((caminho) => !urlGuardada(caminho));

    if (faltam.length) {
      const { data, error } = await supabase.storage
        .from("anexos")
        .createSignedUrls(faltam, VALIDADE_URL_IMAGEM);

      if (error) console.warn("Não foi possível carregar as imagens da conversa:", error);

      const expiraEm = Date.now() + VALIDADE_URL_IMAGEM * 1000;

      (data ?? []).forEach((item) => {
        if (item.signedUrl && item.path) urlsDeImagem.set(item.path, { url: item.signedUrl, expiraEm });
      });
    }

    imagens.forEach((imagem) => {
      const url = urlGuardada(imagem.dataset.caminho);

      if (url) {
        imagem.src = url;
      } else {
        imagem.closest(".comentario__imagem")?.classList.add("comentario__imagem--falhou");
      }
    });
  }

  //VISUALIZADOR: A IMAGEM ABRE NA PROPRIA TELA, POR CIMA DO CHAMADO, e nao
  //numa aba nova. Clicar fora dela (ou no x, ou Esc) fecha e volta para o
  //chamado, que continua aberto por baixo.
  const visualizador = document.querySelector("[data-visualizador]");
  const imagemDoVisualizador = document.querySelector("[data-visualizador-imagem]");
  const nomeDoVisualizador = document.querySelector("[data-visualizador-nome]");

  async function abrirImagemNaTela(anexo) {
    let url = urlGuardada(anexo.storage_path);

    if (!url) {
      const { data, error } = await supabase.storage
        .from("anexos")
        .createSignedUrl(anexo.storage_path, VALIDADE_URL_IMAGEM);

      if (error) {
        avisar("Não foi possível abrir a imagem.", true);
        return;
      }

      url = data.signedUrl;
      urlsDeImagem.set(anexo.storage_path, { url, expiraEm: Date.now() + VALIDADE_URL_IMAGEM * 1000 });
    }

    imagemDoVisualizador.src = url;
    imagemDoVisualizador.alt = anexo.nome_arquivo;
    nomeDoVisualizador.textContent = anexo.nome_arquivo;
    visualizador.showModal();
  }

  // Qualquer clique que nao seja na propria imagem fecha: o fundo escuro, o
  // espaco em volta, o nome e o x.
  visualizador.addEventListener("click", (evento) => {
    if (evento.target !== imagemDoVisualizador) visualizador.close();
  });

  // Sem a imagem anterior presa: a proxima abre limpa, sem piscar a antiga.
  visualizador.addEventListener("close", () => {
    imagemDoVisualizador.removeAttribute("src");
  });

  function montarImagensDoComentario(anexos) {
    const galeria = document.createElement("div");
    galeria.className = "comentario__imagens";

    anexos.forEach((anexo) => {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "comentario__imagem";
      botao.title = anexo.nome_arquivo;
      botao.setAttribute("aria-label", `Abrir ${anexo.nome_arquivo}`);

      const imagem = document.createElement("img");
      imagem.alt = anexo.nome_arquivo;
      imagem.loading = "lazy";
      imagem.dataset.caminho = anexo.storage_path;
      imagem.addEventListener("error", () => botao.classList.add("comentario__imagem--falhou"));

      botao.appendChild(imagem);
      botao.addEventListener("click", () => abrirImagemNaTela(anexo));
      galeria.appendChild(botao);
    });

    return galeria;
  }

  //CARD DE SOLUCAO NO CHAT: em vez de um link cru, mostra o titulo do
  //artigo com um botao "Acessar" que abre a Base de Solucoes na solucao
  //certa. Se o artigo foi excluido depois (artigo_id fica null), o card
  //avisa em vez de linkar para lugar nenhum.
  function montarCardDeSolucao(comentario) {
    const artigo = comentario.artigos;
    const disponivel = comentario.artigo_id && artigo?.ativo;

    const card = document.createElement("div");
    card.className = "comentario__solucao";

    const icone = document.createElement("span");
    icone.className = "comentario__solucao-icone";
    icone.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M12 3.5 4.5 7.5v9L12 20.5l7.5-4v-9L12 3.5Z" fill="none"
            stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
      <path d="M12 12v8.5M4.5 7.5 12 12l7.5-4.5" fill="none"
            stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
    </svg>`;

    const titulo = document.createElement("span");
    titulo.className = "comentario__solucao-titulo";
    titulo.textContent = disponivel ? artigo.titulo : `${comentario.texto} (solução removida)`;

    card.append(icone, titulo);

    if (disponivel) {
      const acessar = document.createElement("a");
      acessar.className = "comentario__solucao-botao";
      acessar.href = `base.html?id=${comentario.artigo_id}`;
      acessar.target = "_blank";
      acessar.rel = "noopener";
      acessar.textContent = "Acessar";
      card.appendChild(acessar);
    }

    return card;
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

    // As imagens pedem a URL assinada antes de aparecer; junta todas e
    // busca numa unica chamada (preencherImagens ja faz isso em lote),
    // em vez de uma assinatura por anexo.
    const imagensParaCarregar = [];

    [...aberto.anexos]
      .sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em))
      .forEach((anexo) => {
        const botao = document.createElement("button");
        botao.type = "button";
        botao.title = anexo.nome_arquivo;

        const nome = document.createElement("span");
        nome.className = "anexo__nome";
        nome.textContent = anexo.nome_arquivo;

        const quando = document.createElement("span");
        quando.className = "anexo__quando";
        quando.textContent = formatarData(anexo.criado_em);

        //IMAGEM: CARD VERTICAL COM PREVIA EM CIMA, NOME E DATA EMBAIXO —
        //bate o olho no que e antes de precisar abrir.
        if (ehImagem(anexo.nome_arquivo)) {
          botao.className = "anexo anexo--imagem";

          const previa = document.createElement("img");
          previa.className = "anexo__previa";
          previa.alt = "";
          previa.loading = "lazy";
          previa.dataset.caminho = anexo.storage_path;
          // Sem preview, cai para o card de arquivo comum — melhor um
          // icone generico do que um quadrado quebrado.
          previa.addEventListener("error", () => botao.classList.add("anexo--imagem-falhou"));

          const texto = document.createElement("span");
          texto.className = "anexo__texto";
          texto.append(nome, quando);

          botao.append(previa, texto);
          imagensParaCarregar.push(previa);
        } else {
          botao.className = "anexo";

          const icone = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          icone.setAttribute("class", "anexo__icone");
          icone.setAttribute("viewBox", "0 0 24 24");
          icone.setAttribute("width", "14");
          icone.setAttribute("height", "14");
          icone.innerHTML = '<path d="M13.5 3.5H7a1.8 1.8 0 0 0-1.8 1.8v13.4A1.8 1.8 0 0 0 7 20.5h10a1.8 1.8 0 0 0 1.8-1.8V8.8Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M13.5 3.5v5.3h5.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>';

          const texto = document.createElement("span");
          texto.className = "anexo__texto";
          texto.append(nome, quando);

          botao.append(icone, texto);
        }

        botao.addEventListener("click", async () => {
          // Imagem abre no visualizador, na propria tela. PDF e o resto
          // continuam numa aba nova, que e onde o navegador sabe mostrar.
          if (ehImagem(anexo.nome_arquivo)) {
            abrirImagemNaTela(anexo);
            return;
          }

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

    if (imagensParaCarregar.length) preencherImagens(imagensParaCarregar);
  }

  //RESPONDER AO SOLICITANTE. Tudo que se escreve aqui e conversa com ele —
  //nota interna nao existe nesta tela.
  async function responder() {
    const texto = campoMensagem.value.trim();
    const arquivos = anexosPendentes.map((pendente) => pendente.arquivo);

    if (!texto && !arquivos.length) return;

    // O envio leva alguns segundos com varias imagens: se a pessoa abrir
    // outro ticket no meio, tudo continua indo para este chamado.
    const chamado = aberto;

    botaoEnviar.disabled = true;
    botaoEnviar.textContent = arquivos.length ? "Enviando anexos…" : "Enviando…";

    const textoPadrao = arquivos.length === 1
      ? `Enviou o anexo ${arquivos[0].name}`
      : `Enviou ${arquivos.length} anexos`;

    const { data: comentario, error: erroComentario } = await supabase
      .from("comentarios")
      .insert({
        chamado_id: chamado.id,
        autor_id: atendente,
        texto: texto || textoPadrao,
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

    chamado.comentarios.push(comentario);

    // Respondeu, assumiu: entra como membro antes mesmo dos anexos subirem.
    await vincularComoMembro(chamado);

    if (arquivos.length) {
      const inicio = Date.now();

      // Sobe todos ao mesmo tempo. O caminho comeca pelo id do chamado: e
      // assim que a policy do bucket amarra a permissao do arquivo a do
      // chamado. O indice no nome evita dois arquivos no mesmo caminho.
      const enviados = await Promise.all(arquivos.map(async (arquivo, indice) => {
        const caminho = `${chamado.id}/${inicio}-${indice + 1}-${arquivo.name}`;
        const { error } = await supabase.storage.from("anexos").upload(caminho, arquivo);

        if (error) {
          console.error("Falha ao enviar anexo:", arquivo.name, error);
          return null;
        }

        return {
          chamado_id: chamado.id,
          comentario_id: comentario.id,
          usuario_id: atendente,
          storage_path: caminho,
          nome_arquivo: arquivo.name,
        };
      }));

      const linhas = enviados.filter(Boolean);
      let gravados = [];

      // Uma ida so ao banco para registrar todos os que subiram.
      if (linhas.length) {
        const { data, error } = await supabase
          .from("anexos")
          .insert(linhas)
          .select("id, comentario_id, nome_arquivo, storage_path, criado_em");

        if (error) console.error("Falha ao registrar anexos:", error);

        gravados = data ?? [];
      }

      if (gravados.length) {
        chamado.anexos = [...(chamado.anexos ?? []), ...gravados];
        if (aberto === chamado) desenharAnexos();
      }

      const falharam = arquivos.length - gravados.length;

      if (falharam) {
        avisar(
          falharam === arquivos.length
            ? "A mensagem foi enviada, mas os anexos falharam."
            : `A mensagem foi enviada, mas ${falharam} de ${arquivos.length} anexos falharam.`,
          true,
        );
      }
    }

    botaoEnviar.disabled = false;
    botaoEnviar.textContent = "Responder";

    // Se a pessoa ja esta em outro ticket, nao apaga o que ela esta escrevendo la.
    if (aberto !== chamado) return;

    campoMensagem.value = "";
    limparPendentes();
    desenharConversa();
    // O status do card vem de quem falou por ultimo: agora fomos nos.
    atualizarStatusDoCard();
  }

  //O SELO DO CARD ACOMPANHA A CONVERSA
  function atualizarStatusDoCard() {
    // O Painel redesenha a linha da tabela; o Portal, o selo do card.
    aoMudarCard(aberto);

    const card = acharCard(aberto.id);

    if (!card) return;

    const status = derivarStatus(aberto);
    const selo = card.querySelector(".card__status");
    selo.className = `card__status card__status--${status.chave}`;
    selo.textContent = status.rotulo;
  }

  //ANEXOS PENDENTES: O QUE VAI JUNTO COM A PROXIMA RESPOSTA. Entra pelo
  //botao Anexar (varios de uma vez) ou colando imagem no campo (Ctrl+V),
  //quantas a pessoa quiser. Cada um tem miniatura e um x para tirar.
  let anexosPendentes = []; // { arquivo, previa: URL local da imagem, ou null }

  function desenharPendentes() {
    campoPendentes.replaceChildren();
    campoPendentes.hidden = !anexosPendentes.length;

    anexosPendentes.forEach((pendente, indice) => {
      const item = document.createElement("div");
      item.className = "conversa__pendente";
      item.title = pendente.arquivo.name;

      if (pendente.previa) {
        const imagem = document.createElement("img");
        imagem.src = pendente.previa;
        imagem.alt = pendente.arquivo.name;
        item.appendChild(imagem);
      } else {
        // PDF e afins: sem miniatura, mostra o nome.
        item.classList.add("conversa__pendente--arquivo");

        const nome = document.createElement("span");
        nome.className = "conversa__pendente-nome";
        nome.textContent = pendente.arquivo.name;
        item.appendChild(nome);
      }

      const remover = document.createElement("button");
      remover.type = "button";
      remover.className = "conversa__pendente-remover";
      remover.textContent = "×";
      remover.setAttribute("aria-label", `Remover ${pendente.arquivo.name}`);
      remover.addEventListener("click", () => {
        if (pendente.previa) URL.revokeObjectURL(pendente.previa);

        anexosPendentes.splice(indice, 1);
        desenharPendentes();
        campoMensagem.focus();
      });

      item.appendChild(remover);
      campoPendentes.appendChild(item);
    });

    const total = anexosPendentes.length;

    nomeDoArquivo.textContent = total ? `${total} ${total === 1 ? "anexo" : "anexos"}` : "Anexar";
    nomeDoArquivo.parentElement.classList.toggle("conversa__anexar--escolhido", total > 0);
  }

  function adicionarPendentes(arquivos) {
    arquivos.forEach((arquivo) => {
      anexosPendentes.push({
        arquivo,
        previa: arquivo.type.startsWith("image/") ? URL.createObjectURL(arquivo) : null,
      });
    });

    desenharPendentes();
  }

  function limparPendentes() {
    // Libera a memoria das miniaturas.
    anexosPendentes.forEach((pendente) => {
      if (pendente.previa) URL.revokeObjectURL(pendente.previa);
    });

    anexosPendentes = [];
    campoArquivo.value = "";
    desenharPendentes();
  }

  campoArquivo.addEventListener("change", () => {
    adicionarPendentes([...campoArquivo.files]);
    // Limpa o input: escolher o mesmo arquivo de novo tambem precisa disparar.
    campoArquivo.value = "";
  });

  //CTRL+V NO CAMPO: imagem colada (print, recorte de tela) vira anexo, quantas
  //vezes quiser. Texto continua colando normal.
  campoMensagem.addEventListener("paste", (evento) => {
    const itens = [...(evento.clipboardData?.items ?? [])];
    const imagens = itens
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter(Boolean);

    if (!imagens.length) return;

    // So imagem na area de transferencia: segura o colar, que no campo de
    // texto nao faria nada. Veio texto junto (planilha, por exemplo): deixa
    // o texto entrar e so adiciona as imagens.
    const temTexto = itens.some((item) => item.kind === "string" && item.type === "text/plain");

    if (!temTexto) evento.preventDefault();

    // Print colado chega sempre como "image.png": nome unico para nao virar
    // uma lista de anexos todos iguais.
    const agora = Date.now();

    adicionarPendentes(imagens.map((imagem, indice) => {
      const extensao = (imagem.type.split("/")[1] ?? "png").replace("jpeg", "jpg");

      return new File([imagem], `imagem-colada-${agora}-${indice + 1}.${extensao}`, { type: imagem.type });
    }));
  });

  botaoEnviar.addEventListener("click", responder);

  //ENTER ENVIA; SHIFT+ENTER PULA LINHA, como nos chats. isComposing: no meio
  //de um acento (´ + a) o Enter pertence ao teclado, nao ao envio. Com um
  //envio em andamento o botao esta desativado, e o Enter tambem nao manda de novo.
  campoMensagem.addEventListener("keydown", (evento) => {
    if (evento.key !== "Enter" || evento.shiftKey || evento.isComposing) return;

    evento.preventDefault();

    if (!botaoEnviar.disabled) responder();
  });

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
      const confirmou = await confirmarNoSite({
        titulo: "Excluir texto rápido?",
        mensagem: `"${texto.titulo}" sai da lista de textos rápidos de toda a equipe.`,
        confirmar: "Excluir",
        perigo: true,
      });

      if (!confirmou) return;

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

  //PAINEL DE SOLUCOES: manda o link de um artigo da base direto no chat, em
  //vez do atendente colar a URL crua. Mesma mecanica de abrir/fechar dos
  //Textos Rapidos; a busca e o ranking sao os mesmos da Base de Solucoes
  //(base.js), copiados aqui porque as duas telas nao compartilham modulo.
  function ligarSolucoes() {
    const painel = document.querySelector("[data-solucoes]");
    const botaoAbrir = document.querySelector("[data-solucoes-abrir]");
    const lista = document.querySelector("[data-solucoes-lista]");
    const busca = document.querySelector("[data-solucoes-busca]");

    const TAMANHO_MINIMO_TERMO = 3;

    let artigos = [];
    let carregados = false;

    function normalizar(texto) {
      return (texto || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    }

    function pontuar(artigo, termos, termoCompleto) {
      const nome = normalizar(artigo.titulo);
      const descricao = normalizar(artigo.conteudo);

      let pontuacao = 0;

      termos.forEach((termo) => {
        if (nome.includes(termo)) pontuacao += 3;
        if (descricao.includes(termo)) pontuacao += 2;
      });

      if (pontuacao === 0) return 0;

      if (nome === termoCompleto) pontuacao += 1000;
      else if (nome.startsWith(termoCompleto)) pontuacao += 500;
      else if (nome.includes(termoCompleto)) pontuacao += 100;

      return pontuacao;
    }

    async function carregar() {
      const { data, error } = await supabase
        .from("artigos")
        .select("id, titulo, conteudo, setores, unidades")
        .eq("ativo", true)
        .order("titulo");

      if (error) {
        avisar("Não foi possível carregar as soluções.", true);
        return;
      }

      artigos = data;
      carregados = true;
      desenhar();
    }

    //SO OFERECE O QUE O SOLICITANTE VAI CONSEGUIR ABRIR. A mesma regra da
    //policy de leitura de artigos (artigos_leitura): quem escreve na base
    //(contribuinte pra cima) ve tudo; um solicitante comum so ve o que bate
    //setor E unidade dele. Sem isto, a equipe manda um artigo fora do
    //alcance do solicitante e o link vira "solução removida" pra ele — nao
    //porque o artigo sumiu, mas porque o RLS nunca deixou ele ver.
    function artigosVisiveisPeloSolicitante() {
      const solicitante = aberto?.usuarios;
      const escritor = ["contribuinte", "analista", "admin"].includes(solicitante?.perfil);

      if (!solicitante || escritor) return artigos;

      return artigos.filter((artigo) =>
        (artigo.setores ?? []).includes(solicitante.setor_id)
        && (artigo.unidades ?? []).includes(solicitante.unidade_id));
    }

    function desenhar() {
      const termo = busca.value.trim();
      const termoNormalizado = normalizar(termo);
      const termos = termoNormalizado.split(/\s+/).filter((t) => t.length >= TAMANHO_MINIMO_TERMO);
      const disponiveis = artigosVisiveisPeloSolicitante();

      const achados = !termo
        ? disponiveis.slice().sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR"))
        : (termos.length === 0 ? [] : disponiveis
            .map((artigo) => ({ artigo, pontuacao: pontuar(artigo, termos, termoNormalizado) }))
            .filter((item) => item.pontuacao > 0)
            .sort((a, b) => b.pontuacao - a.pontuacao)
            .map((item) => item.artigo));

      lista.replaceChildren();

      if (!achados.length) {
        const vazio = document.createElement("p");
        vazio.className = "rapidos__vazio";
        vazio.textContent = !carregados
          ? "Carregando…"
          : termo
            ? "Nenhuma solução encontrada"
            : (artigos.length && !disponiveis.length
                ? "Nenhuma solução do setor deste solicitante"
                : "Nenhuma solução cadastrada ainda");
        lista.appendChild(vazio);
        return;
      }

      achados.forEach((artigo) => lista.appendChild(montarItem(artigo)));
    }

    function montarItem(artigo) {
      const item = document.createElement("div");
      item.className = "rapidos__item";
      item.tabIndex = 0;
      item.role = "button";

      const titulo = document.createElement("span");
      titulo.className = "rapidos__item-titulo";
      titulo.textContent = artigo.titulo;

      item.append(titulo);

      item.addEventListener("click", () => enviar(artigo));
      item.addEventListener("keydown", (evento) => {
        if (evento.key !== "Enter" && evento.key !== " ") return;
        evento.preventDefault();
        enviar(artigo);
      });

      return item;
    }

    async function enviar(artigo) {
      const chamado = aberto;

      const { data: comentario, error } = await supabase
        .from("comentarios")
        .insert({
          chamado_id: chamado.id,
          autor_id: atendente,
          texto: artigo.titulo,
          visibilidade: "publico",
          tipo: "solucao",
          artigo_id: artigo.id,
        })
        .select("id, autor_id, texto, visibilidade, tipo, artigo_id, criado_em, usuarios(nome, sobrenome, foto_path)")
        .single();

      if (error) {
        avisar("Não foi possível enviar a solução.", true);
        return;
      }

      chamado.comentarios.push(comentario);
      await vincularComoMembro(chamado);

      if (aberto === chamado) {
        desenharConversa();
        atualizarStatusDoCard();
      }

      fechar();
      avisar("Solução enviada");
    }

    function abrir() {
      painel.hidden = false;
      botaoAbrir.setAttribute("aria-expanded", "true");
      if (!carregados) carregar(); else desenhar();
      busca.focus();
    }

    function fechar() {
      painel.hidden = true;
      botaoAbrir.setAttribute("aria-expanded", "false");
      busca.value = "";
    }

    botaoAbrir.addEventListener("click", () => {
      if (painel.hidden) abrir(); else fechar();
    });

    document.querySelector("[data-solucoes-fechar]")
      .addEventListener("click", fechar);
    busca.addEventListener("input", desenhar);

    painel.addEventListener("keydown", (evento) => {
      if (evento.key !== "Escape") return;
      evento.stopPropagation();
      fechar();
    });

    document.addEventListener("click", (evento) => {
      if (painel.hidden) return;
      if (evento.target.closest(".rapidos, [data-solucoes-abrir]")) return;
      fechar();
    });

    return { fechar };
  }

  const solucoes = ligarSolucoes();

  //O CARD NO QUADRO REFLETE O QUE MUDOU NO DETALHE
  function atualizarCard() {
    // O Painel nao tem card: redesenha a linha da tabela e para por aqui.
    aoMudarCard(aberto);

    const card = acharCard(aberto.id);

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

    desenharMembrosDoCard(card.querySelector(".card__membros"), aberto.chamado_membros, aberto.chamado_terceiros);

    // Mudou etiqueta ou membro: o card pode ter entrado ou saido do filtro.
    card.classList.toggle("card--filtrado", !chamadoPassaNosFiltros(aberto));
    sincronizarColuna(card.closest(".fila"));
    aoContarChamados();
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
      { rotulo: "E-mail", valor: aberto.usuarios?.email },
      { rotulo: "Setor", valor: aberto.usuarios?.setores?.nome },
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

  //E O CHAMADO QUE handle_new_user() ABRE SOZINHO NO CADASTRO — identifica
  //pela categoria, que e o mesmo dado que a fila 'Internet, Conexão e
  //Telefonia' usa para rotear (ver chamados_rotear_por_categoria no banco).
  function ehAprovacaoDeAcesso(chamado) {
    return chamado.categorias?.nome === "Aprovação de Acesso";
  }

  async function carregarSetores() {
    if (setoresDisponiveis.length) return;

    const { data } = await supabase.from("setores")
      .select("id, nome").eq("ativo", true).order("nome");

    setoresDisponiveis = data ?? [];

    campoAprovacaoSetor.replaceChildren();
    setoresDisponiveis.forEach((setor) => {
      const opcao = document.createElement("option");
      opcao.value = setor.id;
      opcao.textContent = setor.nome;
      campoAprovacaoSetor.appendChild(opcao);
    });
  }

  //PERFIL SUGERIDO PELO SETOR: quem escolheu "Administrador" no cadastro
  //quase sempre vai virar admin, entao o campo ja vem preenchido assim —
  //mas e so sugestao, quem aprova confirma ou troca. O perfil NAO e gravado
  //no cadastro justamente para ninguem se auto-promover pelo formulario.
  const NOME_SETOR_ADMIN = "Administrador";

  const ROTULO_STATUS_CADASTRO = {
    pendente: "Pendente",
    aprovado: "Aprovado",
    rejeitado: "Rejeitado",
  };

  function perfilSugeridoPeloSetor(setorId) {
    const setor = setoresDisponiveis.find((s) => s.id === setorId);

    return setor?.nome === NOME_SETOR_ADMIN ? "admin" : "solicitante";
  }

  function aplicarPerfilSugerido() {
    if (perfilEscolhidoNaMao) return;

    const sugerido = perfilSugeridoPeloSetor(campoAprovacaoSetor.value);

    campoAprovacaoPerfil.value = sugerido;
    dicaAprovacaoPerfil.textContent = sugerido === "admin"
      ? "Sugerido pelo setor Administrador — confirme antes de aprovar."
      : "";
  }

  campoAprovacaoSetor.addEventListener("change", aplicarPerfilSugerido);

  campoAprovacaoPerfil.addEventListener("change", () => {
    perfilEscolhidoNaMao = true;
    dicaAprovacaoPerfil.textContent = "";
  });

  //FICHA ENXUTA DA APROVACAO: so os campos que decidem se a conta e
  //liberada. Setor e perfil vem de <select> porque sao os editaveis — os
  //outros sao so conferencia (o que a pessoa preencheu no cadastro).
  async function desenharAprovacao() {
    await carregarSetores();

    const solicitante = aberto.usuarios;
    const aberturaEm = aberto.abertura_em
      ? new Date(aberto.abertura_em).toLocaleString("pt-BR", {
          day: "2-digit", month: "2-digit", year: "numeric",
          hour: "2-digit", minute: "2-digit",
        })
      : null;

    campoAprovacaoDados.replaceChildren();

    [
      // Mesma grade de duas colunas da ficha comum (desenharDados): os pares
      // ficam lado a lado e o campo longo fecha a linha inteira no fim. Sem
      // um número par de células duplas sobra um buraco na grade — era o que
      // acontecia com o e-mail largo no meio e cinco campos em volta.
      { rotulo: "Solicitante", valor: nomeCompleto(solicitante) },
      { rotulo: "Aberto em", valor: aberturaEm },
      { rotulo: "Unidade", valor: aberto.unidades?.nome },
      { rotulo: "Categoria", valor: aberto.categorias?.nome },
      // O setor que a PESSOA escolheu no cadastro — é o que sugere o perfil
      // no campo abaixo. Aparece aqui como conferência porque o <select> de
      // setor pode ser trocado por quem aprova, e aí some a informação
      // original de onde ela disse que trabalha.
      { rotulo: "Setor informado", valor: solicitante?.setores?.nome },
      { rotulo: "Cadastro", valor: ROTULO_STATUS_CADASTRO[solicitante?.status_aprovacao] },
      { rotulo: "E-mail", valor: solicitante?.email, largo: true },
    ].forEach(({ rotulo, valor, largo }) => {
      const item = document.createElement("div");
      item.className = "dados__item";
      if (largo) item.classList.add("dados__item--largo");

      const termo = document.createElement("dt");
      termo.className = "dados__rotulo";
      termo.textContent = rotulo;

      const definicao = document.createElement("dd");
      definicao.className = "dados__valor";
      if (!valor) definicao.classList.add("dados__valor--vazio");
      definicao.textContent = valor || "Não informado";

      item.append(termo, definicao);
      campoAprovacaoDados.appendChild(item);
    });

    campoAprovacaoSetor.value = solicitante?.setor_id ?? "";

    // Cadastro novo entra sempre como solicitante/pendente — ninguem se
    // auto-promove no formulario. Quem ja tem um perfil definido (reabriu a
    // ficha de alguem ja decidido) aparece com o dele; os demais recebem a
    // sugestao vinda do setor.
    const jaTemPerfil = solicitante?.status_aprovacao
      && solicitante.status_aprovacao !== "pendente";

    perfilEscolhidoNaMao = false;

    if (jaTemPerfil && solicitante?.perfil) {
      campoAprovacaoPerfil.value = solicitante.perfil;
      dicaAprovacaoPerfil.textContent = "";
    } else {
      aplicarPerfilSugerido();
    }

    //O AVISO E SO INFORMATIVO: aprovar/rejeitar fica sempre clicavel, mesmo
    //com uma decisao anterior — quem revisa pode mudar de ideia (aprovou
    //errado, ou quer rejeitar de novo depois de reabrir), sem travar o
    //botao a espera de outra acao primeiro.
    const jaDecidido = solicitante?.status_aprovacao && solicitante.status_aprovacao !== "pendente";

    avisoAprovacao.textContent = jaDecidido
      ? `Cadastro já ${solicitante.status_aprovacao === "aprovado" ? "aprovado" : "rejeitado"} — pode alterar se precisar.`
      : "";
    avisoAprovacao.classList.toggle("aprovacao__aviso--feito", Boolean(jaDecidido));

    //SO ADMIN DECIDE ACESSO. O analista abre o chamado e ve os dados (ele
    //atende no Portal), mas quem libera conta e define perfil e o admin —
    //e o banco concorda: trocar perfil passa pelo trigger
    //protege_perfil_usuario, que so aceita admin. Sem isto o analista
    //clicaria em Aprovar e receberia um erro seco vindo do banco.
    const podeDecidir = perfilAtendente === "admin";

    botaoAprovar.hidden = !podeDecidir;
    botaoRejeitar.hidden = !podeDecidir;
    campoAprovacaoSetor.disabled = !podeDecidir;
    campoAprovacaoPerfil.disabled = !podeDecidir;

    if (!podeDecidir) {
      avisoAprovacao.textContent = "Somente um administrador pode aprovar ou rejeitar cadastros.";
      avisoAprovacao.classList.add("aprovacao__aviso--feito");
    }
  }

  //APROVAR/REJEITAR: grava em usuarios (nao em chamados) — o trigger do
  //banco (notificar_aprovacao_cadastro) reage a mudanca de status_aprovacao
  //e cuida do resto: mensagem automatica pro solicitante, o analista vira
  //membro do chamado, e aprovar fecha o chamado. Aqui so falta recarregar
  //a tela pra refletir o que o trigger ja fez no banco.
  async function decidirAprovacao(aprovar) {
    const solicitante = aberto.usuarios;

    if (!solicitante?.id) return;

    botaoAprovar.disabled = true;
    botaoRejeitar.disabled = true;

    const mudancas = { status_aprovacao: aprovar ? "aprovado" : "rejeitado" };
    const setorEscolhido = campoAprovacaoSetor.value;

    // So grava o setor se ele mudou — nao pisa em nada se o campo ficou
    // no valor original.
    if (setorEscolhido && setorEscolhido !== (solicitante.setor_id ?? "")) {
      mudancas.setor_id = setorEscolhido;
    }

    // O perfil so vai junto ao APROVAR: rejeitar nao concede acesso nenhum,
    // entao mudar o perfil de quem foi recusado nao faria sentido. Como
    // trocar perfil e exclusividade do admin (trigger protege_perfil_usuario
    // no banco), so mandamos o campo quando ele realmente mudou — assim o
    // analista continua aprovando cadastro sem esbarrar na regra.
    const perfilEscolhido = campoAprovacaoPerfil.value;

    if (aprovar && perfilEscolhido && perfilEscolhido !== (solicitante.perfil ?? "")) {
      mudancas.perfil = perfilEscolhido;
    }

    const { error } = await supabase.from("usuarios").update(mudancas).eq("id", solicitante.id);

    if (error) {
      avisoAprovacao.textContent = "Não foi possível salvar. Tente de novo.";
      avisoAprovacao.classList.add("aprovacao__aviso--erro");
      botaoAprovar.disabled = false;
      botaoRejeitar.disabled = false;
      return;
    }

    avisarNoSite(
      aprovar
        ? `Cadastro de ${nomeCompleto(solicitante)} aprovado.`
        : `Cadastro de ${nomeCompleto(solicitante)} rejeitado.`,
      { tipo: "sucesso" },
    );

    janela.close();
  }

  botaoAprovar.addEventListener("click", () => decidirAprovacao(true));
  botaoRejeitar.addEventListener("click", () => decidirAprovacao(false));

  function abrir(chamado) {
    aberto = chamado;

    campoFila.textContent = nomeDaFila.get(chamado.fila_id) ?? "Sem fila";

    //APROVACAO DE ACESSO NAO USA O CARD PADRAO: ficha diferente, sem
    //titulo/prioridade/membros/descricao/chat visiveis. O botao Fechar/
    //Reabrir do topo continua igual a qualquer chamado — Aprovar/Rejeitar
    //fecham automaticamente (o trigger do banco cuida disso), mas o
    //solicitante pode reabrir pelo dele, e a equipe pode fechar/reabrir
    //manualmente por aqui tambem, sem depender so da decisao de aprovacao.
    const aprovacao = ehAprovacaoDeAcesso(chamado);
    painelAprovacao.hidden = !aprovacao;
    conteudoPadrao.hidden = aprovacao;
    atualizarBotaoFechar();

    if (aprovacao) {
      desenharAprovacao();
      desenharAnexos();
      janela.showModal();
      return;
    }

    campoTitulo.textContent = tituloDoChamado(chamado);
    campoDescricao.textContent = chamado.descricao ?? "";
    campoMensagem.value = "";
    // Anexo colado num ticket nao pode ir parar na resposta de outro.
    limparPendentes();
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
  //Recebe o chamado, e nao usa `aberto`: o "Desfazer" do aviso roda quando o
  //detalhe ja foi fechado. Tickets finalizados usa a mesma funcao.
  async function definirFechamento(chamado, fechar) {
    const fechamentoEm = fechar ? new Date().toISOString() : null;

    const { error } = await supabase
      .from("chamados")
      .update({ fechamento_em: fechamentoEm })
      .eq("id", chamado.id);

    if (error) {
      avisarNoSite(
        fechar ? "Não foi possível fechar o chamado. Tente de novo." : "Não foi possível reabrir o chamado. Tente de novo.",
        { tipo: "erro" },
      );
      return false;
    }

    chamado.fechamento_em = fechamentoEm;

    const cardAtual = acharCard(chamado.id);
    const colunaDoCard = cardAtual?.closest(".fila");

    cardAtual?.remove();
    if (colunaDoCard) sincronizarColuna(colunaDoCard);

    // Reabriu: o card volta para a coluna da fila dele. Sem quadro (Painel),
    // quem cuida de mostrar a mudanca e o aoMudarFechamento.
    if (!fechar && quadro) {
      const coluna = quadro.querySelector(`.fila[data-fila="${chamado.fila_id}"]`);

      if (coluna) {
        coluna.querySelector(".fila__cards").appendChild(montarCard(chamado));
        sincronizarColuna(coluna);
      }
    }

    aoMudarFechamento(chamado, fechar);
    aoContarChamados();

    if (janela.open && aberto?.id === chamado.id) atualizarBotaoFechar();

    return true;
  }

  //SEM PERGUNTA ANTES: fechar e reabrir sao reversiveis, e o aviso que
  //aparece depois ja traz o "Desfazer".
  async function alternarFechamento() {
    const chamado = aberto;
    const fechando = !chamado.fechamento_em;

    if (!(await definirFechamento(chamado, fechando))) return;

    janela.close();

    avisarNoSite(
      fechando
        ? `${tituloDoChamado(chamado)} foi fechado e está em Tickets finalizados.`
        : `${tituloDoChamado(chamado)} foi reaberto e voltou para o quadro.`,
      {
        tipo: "sucesso",
        acao: { rotulo: "Desfazer", aoClicar: () => definirFechamento(chamado, !fechando) },
      },
    );
  }

  botaoFecharChamado.addEventListener("click", alternarFechamento);

  //CLICAR NO CARD ABRE; ARRASTAR NAO DEVE ABRIR
  //So no Portal: no Painel quem abre o modal e o clique na linha da tabela.
  let arrastou = false;

  quadro?.addEventListener("dragstart", () => { arrastou = true; });
  quadro?.addEventListener("dragend", () => {
    setTimeout(() => { arrastou = false; }, 0);
  });

  quadro?.addEventListener("click", (evento) => {
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

  //TEMPO REAL: ALGUEM MUDOU O CHAMADO QUE ESTA ABERTO NA TELA. O objeto em
  //memoria ja foi atualizado (e o mesmo que `aberto`); aqui so redesenha.
  //Nao atrapalha quem esta digitando: titulo e descricao em edicao nao sao
  //sobrescritos, e a mensagem sendo escrita nunca e tocada.
  function atualizarSeAberto(chamado) {
    if (!janela.open || aberto?.id !== chamado.id) return;

    campoFila.textContent = nomeDaFila.get(aberto.fila_id) ?? "Sem fila";

    if (document.activeElement !== campoTitulo) {
      campoTitulo.textContent = tituloDoChamado(aberto);
    }

    if (document.activeElement !== campoDescricao) {
      campoDescricao.textContent = aberto.descricao ?? "";
    }

    atualizarBotaoFechar();
    desenharDados();
    desenharEtiquetas();
    desenharMembros();

    // A conversa so desce sozinha se a pessoa ja estava no fim dela; quem
    // esta lendo mensagens antigas continua onde estava.
    const noFim = campoConversa.scrollHeight - campoConversa.scrollTop - campoConversa.clientHeight < 40;
    const posicao = campoConversa.scrollTop;

    desenharConversa();

    if (!noFim) campoConversa.scrollTop = posicao;

    desenharAnexos();
  }

  //TEMPO REAL: O CHAMADO ABERTO SUMIU (apagado, ou deixou de ser visivel).
  function fecharSeRemovido(id) {
    if (janela.open && aberto?.id === id) janela.close();
  }

  // abrir: Tickets finalizados e a busca abrem o mesmo modal.
  // atualizarSeAberto / fecharSeRemovido: usados pelo tempo real.
  // definirFechamento: Tickets finalizados reabre pelo mesmo caminho.
  return { abrir, atualizarSeAberto, fecharSeRemovido, definirFechamento };
}

//PAINEL DE FILTROS: MONTA AS OPCOES COM O QUE EXISTE AGORA NOS CHAMADOS
//(unidades e categorias que aparecem, a equipe para membros) e esconde os
//cards que nao passam. Refeito toda vez que abre, para incluir o que chegou
//pelo tempo real.
function ligarFiltros(chamados, equipe, filas) {
  const caixa = document.querySelector("[data-quadro-filtro]");
  const botao = document.querySelector("[data-filtros-abrir]");
  const painel = document.querySelector("[data-filtros-painel]");
  const grupos = document.querySelector("[data-filtros-grupos]");
  const contador = document.querySelector("[data-filtros-contador]");
  const limpar = document.querySelector("[data-filtros-limpar]");

  const TITULOS = {
    membros: "Membros",
    prioridade: "Prioridade",
    unidade: "Unidade",
    categoria: "Categoria",
  };

  function salvar() {
    try {
      localStorage.setItem(CHAVE_FILTROS, JSON.stringify(filtrosDoQuadro));
    } catch {
      // Sem localStorage o filtro so nao sobrevive ao recarregar.
    }
  }

  //ESCONDE/MOSTRA OS CARDS E ACERTA CONTADORES, RESUMO E O BOTAO
  function aplicar() {
    quadro.querySelectorAll(".card").forEach((card) => {
      const chamado = chamados.find((item) => item.id === card.dataset.chamado);

      card.classList.toggle("card--filtrado", Boolean(chamado) && !chamadoPassaNosFiltros(chamado));
    });

    quadro.querySelectorAll(".fila").forEach(sincronizarColuna);
    atualizarResumo(chamados, filas.length);

    const total = totalDeFiltros();

    contador.hidden = !total;
    contador.textContent = total;
    botao.classList.toggle("quadro-filtro__botao--ativo", total > 0);
    botao.setAttribute("aria-label", total ? `Filtrar chamados (${total} ativos)` : "Filtrar chamados");
    limpar.disabled = !total;
  }

  function opcoesDisponiveis() {
    const unicos = (lista) => [...new Set(lista)].sort((a, b) => a.localeCompare(b, "pt-BR"));

    return {
      membros: [
        { valor: SEM_MEMBRO, rotulo: "Sem membro" },
        // Nome completo: aqui da para confundir dois "João".
        ...equipe.map((pessoa) => ({ valor: pessoa.id, rotulo: nomeCompleto(pessoa) ?? "Alguém", pessoa })),
      ],
      prioridade: [
        { valor: "urgente", rotulo: "Urgente" },
        { valor: "prioridade", rotulo: "Prioridade" },
        { valor: "normal", rotulo: "Normal" },
      ],
      unidade: unicos(chamados.map(unidadeDoChamado)).map((nome) => ({ valor: nome, rotulo: nome })),
      categoria: unicos(chamados.map(categoriaDoChamado)).map((nome) => ({ valor: nome, rotulo: nome })),
    };
  }

  //UNIDADE EM DROPDOWN: sao muitas lojas e CDs, e como botoes elas ocupavam o
  //painel inteiro. Tem busca e caixa de marcar. Marcar nao redesenha o painel
  //(senao a busca perderia o foco a cada clique); so aplica e atualiza o resumo.
  let dropdownUnidadeAberto = false;
  let fecharDropdownUnidade = null;

  function resumoDasUnidades() {
    const marcadas = filtrosDoQuadro.unidade;

    if (!marcadas.length) return "Todas as unidades";
    if (marcadas.length === 1) return marcadas[0];

    return `${marcadas.length} unidades`;
  }

  function montarDropdownUnidade(opcoes) {
    const dropdown = document.createElement("div");
    dropdown.className = "quadro-filtro__dropdown";

    const gatilho = document.createElement("button");
    gatilho.type = "button";
    gatilho.className = "quadro-filtro__dropdown-botao";
    gatilho.setAttribute("aria-expanded", String(dropdownUnidadeAberto));

    const textoGatilho = document.createElement("span");
    textoGatilho.className = "quadro-filtro__dropdown-texto";

    const seta = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    seta.setAttribute("class", "quadro-filtro__dropdown-seta");
    seta.setAttribute("viewBox", "0 0 24 24");
    seta.setAttribute("width", "14");
    seta.setAttribute("height", "14");
    seta.setAttribute("aria-hidden", "true");
    seta.innerHTML = '<path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

    gatilho.append(textoGatilho, seta);

    function atualizarGatilho() {
      textoGatilho.textContent = resumoDasUnidades();
      gatilho.classList.toggle("quadro-filtro__dropdown-botao--marcado", filtrosDoQuadro.unidade.length > 0);
    }

    const conteudo = document.createElement("div");
    conteudo.className = "quadro-filtro__dropdown-painel";
    conteudo.hidden = !dropdownUnidadeAberto;

    const busca = document.createElement("input");
    busca.type = "search";
    busca.className = "quadro-filtro__dropdown-busca";
    busca.placeholder = "Buscar unidade…";
    busca.autocomplete = "off";
    busca.setAttribute("aria-label", "Buscar unidade");

    const lista = document.createElement("div");
    lista.className = "quadro-filtro__dropdown-lista";

    const vazio = document.createElement("p");
    vazio.className = "quadro-filtro__dropdown-vazio";
    vazio.textContent = "Nenhuma unidade encontrada";
    vazio.hidden = true;

    opcoes.forEach((opcao) => {
      const item = document.createElement("label");
      item.className = "quadro-filtro__dropdown-item";
      item.dataset.nome = opcao.rotulo.toLowerCase();

      const caixaMarcar = document.createElement("input");
      caixaMarcar.type = "checkbox";
      caixaMarcar.checked = filtrosDoQuadro.unidade.includes(opcao.valor);

      caixaMarcar.addEventListener("change", () => {
        const atuais = filtrosDoQuadro.unidade.filter((valor) => valor !== opcao.valor);

        filtrosDoQuadro.unidade = caixaMarcar.checked ? [...atuais, opcao.valor] : atuais;

        salvar();
        aplicar();
        atualizarGatilho();
      });

      const nome = document.createElement("span");
      nome.textContent = opcao.rotulo;

      item.append(caixaMarcar, nome);
      lista.appendChild(item);
    });

    busca.addEventListener("input", () => {
      const termo = busca.value.trim().toLowerCase();
      let algumaAparece = false;

      lista.querySelectorAll(".quadro-filtro__dropdown-item").forEach((item) => {
        const aparece = item.dataset.nome.includes(termo);

        item.hidden = !aparece;
        if (aparece) algumaAparece = true;
      });

      vazio.hidden = algumaAparece;
    });

    function mostrarDropdown(aberto) {
      dropdownUnidadeAberto = aberto;
      conteudo.hidden = !aberto;
      gatilho.setAttribute("aria-expanded", String(aberto));

      if (aberto) busca.focus();
    }

    gatilho.addEventListener("click", () => mostrarDropdown(!dropdownUnidadeAberto));

    // O Esc do painel fecha primeiro o dropdown, e so depois o painel.
    fecharDropdownUnidade = () => {
      mostrarDropdown(false);
      gatilho.focus();
    };

    conteudo.append(busca, lista, vazio);
    dropdown.append(gatilho, conteudo);
    atualizarGatilho();

    return dropdown;
  }

  function desenharPainel(focarEm = null) {
    grupos.replaceChildren();

    const todas = opcoesDisponiveis();

    GRUPOS_FILTRO.forEach((grupo) => {
      const opcoes = [...todas[grupo]];

      // Filtro salvo que nao existe mais nos chamados (unidade sem chamado,
      // pessoa que saiu da equipe) continua listado para dar para desmarcar.
      filtrosDoQuadro[grupo].forEach((valor) => {
        if (opcoes.some((opcao) => opcao.valor === valor)) return;

        opcoes.push({ valor, rotulo: grupo === "membros" ? "Pessoa fora da equipe" : valor });
      });

      if (!opcoes.length) return;

      const secao = document.createElement("section");
      secao.className = "quadro-filtro__grupo";

      const titulo = document.createElement("h3");
      titulo.className = "quadro-filtro__titulo";
      titulo.textContent = TITULOS[grupo];

      if (grupo === "unidade") {
        secao.append(titulo, montarDropdownUnidade(opcoes));
        grupos.appendChild(secao);
        return;
      }

      const lista = document.createElement("div");
      lista.className = "quadro-filtro__opcoes";

      opcoes.forEach((opcao) => {
        const marcada = filtrosDoQuadro[grupo].includes(opcao.valor);
        const chip = document.createElement("button");

        chip.type = "button";
        chip.className = "quadro-filtro__opcao";
        chip.classList.toggle("quadro-filtro__opcao--marcada", marcada);
        chip.dataset.grupo = grupo;
        chip.dataset.valor = opcao.valor;
        chip.setAttribute("aria-pressed", String(marcada));

        if (grupo === "prioridade") chip.classList.add(`quadro-filtro__opcao--${opcao.valor}`);

        if (opcao.pessoa) {
          chip.appendChild(montarAvatar(opcao.pessoa, opcao.pessoa.foto_path, "quadro-filtro__avatar"));
        }

        chip.append(document.createTextNode(opcao.rotulo));

        chip.addEventListener("click", () => {
          const atuais = filtrosDoQuadro[grupo];

          filtrosDoQuadro[grupo] = marcada
            ? atuais.filter((valor) => valor !== opcao.valor)
            : [...atuais, opcao.valor];

          salvar();
          aplicar();
          // Redesenhar troca os botoes: devolve o foco para quem foi clicado.
          desenharPainel({ grupo, valor: opcao.valor });
        });

        lista.appendChild(chip);
      });

      secao.append(titulo, lista);
      grupos.appendChild(secao);
    });

    if (focarEm) {
      [...grupos.querySelectorAll(".quadro-filtro__opcao")]
        .find((chip) => chip.dataset.grupo === focarEm.grupo && chip.dataset.valor === focarEm.valor)
        ?.focus();
    }
  }

  function mostrarPainel(aberto) {
    painel.hidden = !aberto;
    botao.setAttribute("aria-expanded", String(aberto));

    // Reabrir o painel mostra o dropdown de unidade fechado de novo.
    if (!aberto) dropdownUnidadeAberto = false;

    if (aberto) desenharPainel();
  }

  botao.addEventListener("click", () => mostrarPainel(painel.hidden));

  limpar.addEventListener("click", () => {
    filtrosDoQuadro = filtrosVazios();
    salvar();
    aplicar();
    desenharPainel();
  });

  // Clique fora fecha, como o menu de 3 pontinhos. composedPath, e nao
  // caixa.contains(target): clicar numa opcao redesenha o painel e tira o
  // botao clicado da pagina antes deste listener rodar — contains daria
  // falso e o painel fecharia a cada clique. O caminho e guardado no inicio
  // do clique, com o botao ainda dentro da caixa.
  document.addEventListener("click", (evento) => {
    if (!painel.hidden && !evento.composedPath().includes(caixa)) mostrarPainel(false);
  });

  document.addEventListener("keydown", (evento) => {
    if (evento.key !== "Escape" || painel.hidden) return;

    if (dropdownUnidadeAberto && fecharDropdownUnidade) {
      fecharDropdownUnidade();
      return;
    }

    mostrarPainel(false);
    botao.focus();
  });

  // Os cards ja nasceram filtrados; aqui acerta botao, contador e resumo.
  aplicar();
}

//MENU DO QUADRO: BOTAO DE 3 PONTINHOS. EXPORTAR, FUNDO, FINALIZADOS.
function ligarQuadroMenu(exportar) {
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

  //EXPORTAR: ABRE A JANELA DE PERIODO (ligarExportar monta o CSV).
  document.querySelector("[data-acao-exportar]").addEventListener("click", () => {
    fechar();
    exportar.abrir();
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

//NOTIFICACOES DO NAVEGADOR (WEB PUSH DE VERDADE): resposta do solicitante
//num chamado onde a pessoa e atendente, e chamado novo na fila de
//entrada. Diferente de uma primeira tentativa com a Notification API
//pura (que so disparava com a aba do Portal em primeiro plano, porque o
//navegador suspende o WebSocket do tempo real com a aba em segundo
//plano), aqui quem detecta a novidade e envia o aviso e o SERVIDOR
//(trigger no banco -> Edge Function notificar-portal -> Web Push) — o
//Service Worker (sw.js) recebe e mostra a notificacao mesmo com a aba
//minimizada ou em outra aba. So nao funciona com o navegador inteiro
//fechado.
//
//Um interruptor so, liga tudo junto — a preferencia mora em
//usuarios.notificacoes_ativas, mas o que realmente decide se a pessoa
//recebe e ter uma inscricao de push valida em push_subscriptions (a
//Edge Function so manda pra quem tem uma).
const VAPID_CHAVE_PUBLICA = "BIGSZJ5WgPPZ4QiousUz386eNLUY-GKuKmne3VzyZfL9RLx-kUNHOMa3nD1KzxmNy2njaxw4URNqE7A_1934ho8";

//O NAVEGADOR EXIGE A CHAVE PUBLICA COMO Uint8Array (URL-safe base64 ->
//bytes), nao a string direto.
function chaveVapidParaUint8Array(chaveBase64) {
  const preenchimento = "=".repeat((4 - (chaveBase64.length % 4)) % 4);
  const base64 = (chaveBase64 + preenchimento).replace(/-/g, "+").replace(/_/g, "/");
  const bruto = window.atob(base64);

  return Uint8Array.from([...bruto].map((caractere) => caractere.charCodeAt(0)));
}

function ligarNotificacoes(atendente, ativasNoCadastro) {
  const item = document.querySelector("[data-acao-notificacoes]");
  const suportado = "serviceWorker" in navigator && "PushManager" in window;

  let ativas = Boolean(ativasNoCadastro) && suportado && Notification.permission === "granted";

  function desenhar() {
    item.setAttribute("aria-checked", String(ativas));
  }

  desenhar();

  // Preferencia dizia "ligado" mas a permissao do navegador nao existe (ou
  // foi revogada depois) — sem isto o interruptor mentiria "ligado" sem
  // nenhuma notificacao nunca aparecer.
  if (ativasNoCadastro && suportado && Notification.permission !== "granted") {
    supabase.from("usuarios").update({ notificacoes_ativas: false }).eq("id", atendente);
  }

  async function inscrever() {
    await inscreverPush(supabase, atendente, chaveVapidParaUint8Array(VAPID_CHAVE_PUBLICA));
  }

  async function desinscrever() {
    await limparPushNoLogout(supabase);
  }

  item.addEventListener("click", async () => {
    if (ativas) {
      ativas = false;
      desenhar();
      const { error: erroPreferencia } = await supabase.from("usuarios")
        .update({ notificacoes_ativas: false }).eq("id", atendente);
      let erroInscricao = null;
      try { await desinscrever(); } catch (erro) { erroInscricao = erro; }
      if (erroPreferencia || erroInscricao) alert("Notificações desativadas neste navegador; confirme a preferência ao reconectar.");
      return;
    }

    if (!suportado) {
      alert("Este navegador não suporta notificações.");
      return;
    }

    const permissao = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();

    if (permissao !== "granted") {
      alert("Notificações bloqueadas no navegador. Permita o site nas configurações do navegador para ativar.");
      return;
    }

    try {
      await inscrever();
    } catch (erro) {
      console.error("Não foi possível ativar as notificações:", erro);
      alert("Não foi possível ativar as notificações. Tente de novo.");
      return;
    }

    const { error: erroPreferencia } = await supabase.from("usuarios")
      .update({ notificacoes_ativas: true }).eq("id", atendente);
    if (erroPreferencia) {
      await desinscrever().catch(() => {});
      alert("Não foi possível salvar a preferência de notificações.");
      return;
    }
    ativas = true;
    desenhar();
  });

  // Preferencia ja estava ligada ao carregar a pagina (outra sessao, ou
  // recarregou): garante que a inscricao deste navegador tambem existe —
  // o navegador pode ter perdido a subscription (ex.: dados do site
  // limpos) sem a preferencia no banco saber disso.
  if (ativas) {
    inscrever().catch((erro) => console.warn("Não foi possível confirmar a inscrição de notificações:", erro));
  }
}

//EXPORTAR: PLANILHA CSV COM OS CHAMADOS CRIADOS NUM PERIODO (em aberto e
//finalizados). Usa os chamados que ja estao em memoria — os mesmos do
//quadro, atualizados pelo tempo real —, sem ir de novo ao banco.
//O periodo e pela data de criacao (abertura_em), no fuso do computador.
function ligarExportar(chamados, filas, carregarFechados) {
  const janela = document.querySelector("[data-exportar]");
  const campoDe = document.querySelector("[data-exportar-de]");
  const campoAte = document.querySelector("[data-exportar-ate]");
  const resumoPeriodo = document.querySelector("[data-exportar-resumo]");
  const botaoBaixar = document.querySelector("[data-exportar-baixar]");
  const atalhos = document.querySelectorAll("[data-periodo]");
  const nomeDaFila = new Map(filas.map((fila) => [fila.id, fila.nome]));

  const ROTULOS_PRIORIDADE = { urgente: "Urgente", prioridade: "Prioridade", normal: "Normal" };

  // "14/09/2026 10:30" — o toLocaleString poe uma virgula entre data e hora.
  function dataHoraPlanilha(iso) {
    if (!iso) return "";

    return new Date(iso)
      .toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
      .replace(",", "");
  }

  //AS COLUNAS, NA ORDEM DA PLANILHA: titulo e como tirar o valor do chamado.
  const COLUNAS = [
    ["Nome do Ticket", (chamado) => tituloDoChamado(chamado)],
    ["Lista", (chamado) => nomeDaFila.get(chamado.fila_id) ?? ""],
    ["Número do Ticket", (chamado) => chamado.numero],
    ["Solicitante", (chamado) => nomeCompleto(chamado.usuarios) ?? ""],
    ["E-mail", (chamado) => chamado.usuarios?.email ?? ""],
    ["Unidade", (chamado) => chamado.unidades?.nome ?? ""],
    ["Categoria", (chamado) => chamado.categorias?.nome ?? ""],
    ["Prioridade", (chamado) => prioridadesDoChamado(chamado).map((chave) => ROTULOS_PRIORIDADE[chave]).join(", ")],
    ["Descrição", (chamado) => chamado.descricao ?? ""],
    ["Data de Criação", (chamado) => dataHoraPlanilha(chamado.abertura_em)],
    ["Data de Fechamento", (chamado) => dataHoraPlanilha(chamado.fechamento_em)],
    ["Atendentes", (chamado) => chamado.chamado_membros
      .map((membro) => nomeCompleto(membro.usuarios))
      .filter(Boolean)
      .join(", ")],
    ["Respostas", (chamado) => respostasDoChamado(chamado)],
  ];

  // O Excel nao aceita mais que 32.767 caracteres numa celula: conversa maior
  // que isso quebraria as colunas seguintes. Corta com aviso.
  const LIMITE_CELULA_EXCEL = 32767;
  const AVISO_CORTE = "\n… (conversa cortada: limite de caracteres do Excel)";

  //RESPOSTAS: AS MENSAGENS TROCADAS NO CHAMADO, DA MAIS ANTIGA PARA A MAIS
  //NOVA, UMA POR LINHA DENTRO DA MESMA CELULA — "[14/09/2026 10:30] Nome: texto".
  //A mensagem automatica (de abertura) fica de fora: nao e conversa.
  function respostasDoChamado(chamado) {
    const texto = (chamado.comentarios ?? [])
      .filter((comentario) => comentario.tipo !== "sistema")
      .sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em))
      .map((comentario) => {
        const autor = nomeCompleto(comentario.usuarios) ?? "Alguém";

        return `[${dataHoraPlanilha(comentario.criado_em)}] ${autor}: ${comentario.texto ?? ""}`;
      })
      .join("\n");

    if (texto.length <= LIMITE_CELULA_EXCEL) return texto;

    return texto.slice(0, LIMITE_CELULA_EXCEL - AVISO_CORTE.length) + AVISO_CORTE;
  }

  // Date -> "aaaa-mm-dd" no fuso local (toISOString usaria UTC e, a noite,
  // mostraria o dia seguinte).
  function paraCampo(data) {
    const mes = String(data.getMonth() + 1).padStart(2, "0");
    const dia = String(data.getDate()).padStart(2, "0");

    return `${data.getFullYear()}-${mes}-${dia}`;
  }

  function doCampo(valor, fimDoDia) {
    const [ano, mes, dia] = valor.split("-").map(Number);

    return fimDoDia
      ? new Date(ano, mes - 1, dia, 23, 59, 59, 999)
      : new Date(ano, mes - 1, dia, 0, 0, 0, 0);
  }

  // Chamados do periodo, do mais antigo para o mais novo; null se as datas
  // estao incompletas ou invertidas.
  function chamadosDoPeriodo() {
    if (!campoDe.value || !campoAte.value) return null;

    const de = doCampo(campoDe.value, false);
    const ate = doCampo(campoAte.value, true);

    if (de > ate) return null;

    return chamados
      .filter((chamado) => {
        const criadoEm = new Date(chamado.abertura_em);

        return criadoEm >= de && criadoEm <= ate;
      })
      .sort((a, b) => new Date(a.abertura_em) - new Date(b.abertura_em));
  }

  //CONTAGEM AO VIVO: a pessoa ve quantos vao sair antes de baixar.
  function atualizarContagem() {
    const lista = chamadosDoPeriodo();

    resumoPeriodo.classList.toggle("exportar__resumo--erro", lista === null);

    if (lista === null) {
      resumoPeriodo.textContent = campoDe.value && campoAte.value
        ? "A data inicial precisa ser anterior ou igual à final."
        : "Escolha a data inicial e a final.";
      botaoBaixar.disabled = true;
      return;
    }

    const finalizados = lista.filter((chamado) => chamado.fechamento_em).length;

    resumoPeriodo.textContent = lista.length
      ? `${lista.length} ${lista.length === 1 ? "chamado" : "chamados"} no período `
        + `(${lista.length - finalizados} em aberto, ${finalizados} ${finalizados === 1 ? "finalizado" : "finalizados"})`
      : "Nenhum chamado criado nesse período.";

    botaoBaixar.disabled = !lista.length;
  }

  function aplicarPeriodo(periodo) {
    const hoje = new Date();
    let de = new Date(hoje);

    if (periodo === "7") de.setDate(hoje.getDate() - 6);
    if (periodo === "30") de.setDate(hoje.getDate() - 29);
    if (periodo === "mes") de = new Date(hoje.getFullYear(), hoje.getMonth(), 1);

    if (periodo === "tudo") {
      // Desde o chamado mais antigo que existe.
      const maisAntigo = chamados.reduce(
        (menor, chamado) => Math.min(menor, new Date(chamado.abertura_em).getTime()),
        hoje.getTime(),
      );
      de = new Date(maisAntigo);
    }

    campoDe.value = paraCampo(de);
    campoAte.value = paraCampo(hoje);

    atalhos.forEach((atalho) => {
      atalho.classList.toggle("exportar__atalho--ativo", atalho.dataset.periodo === periodo);
    });

    atualizarContagem();
  }

  //UMA CELULA DO CSV. Texto com ; aspas ou quebra de linha vai entre aspas
  //(aspas internas dobradas). Texto que comeca com = + - @ ganha um apostrofo
  //na frente: sem isso uma descricao escrita pelo solicitante poderia virar
  //formula executada ao abrir a planilha no Excel.
  function celula(valor) {
    let texto = String(valor ?? "");

    if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;

    return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  }

  function baixar() {
    const lista = chamadosDoPeriodo();

    if (!lista?.length) return;

    // Separador ; — e o que o Excel em portugues espera para abrir ja em colunas.
    const linhas = [
      COLUNAS.map(([titulo]) => celula(titulo)).join(";"),
      ...lista.map((chamado) => COLUNAS.map(([, valorDe]) => celula(valorDe(chamado))).join(";")),
    ];

    // \uFEFF no inicio (BOM): sem ele o Excel le o arquivo em outra
    // codificacao e os acentos viram simbolos estranhos.
    const arquivo = new Blob([`\uFEFF${linhas.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(arquivo);
    const link = document.createElement("a");

    link.href = url;
    link.download = `chamados_${campoDe.value}_a_${campoAte.value}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();

    // Da tempo do navegador comecar o download antes de liberar a memoria.
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    janela.close();
    avisarNoSite(`${lista.length} ${lista.length === 1 ? "chamado exportado" : "chamados exportados"}.`, { tipo: "sucesso" });
  }

  atalhos.forEach((atalho) => {
    atalho.addEventListener("click", () => aplicarPeriodo(atalho.dataset.periodo));
  });

  // Data digitada a mao: nenhum atalho fica marcado.
  [campoDe, campoAte].forEach((campo) => {
    campo.addEventListener("input", () => {
      atalhos.forEach((atalho) => atalho.classList.remove("exportar__atalho--ativo"));
      atualizarContagem();
    });
  });

  botaoBaixar.addEventListener("click", baixar);
  document.querySelector("[data-exportar-cancelar]").addEventListener("click", () => janela.close());
  document.querySelector("[data-exportar-fechar]").addEventListener("click", () => janela.close());
  janela.addEventListener("click", (evento) => {
    if (evento.target === janela) janela.close();
  });

  return {
    // Primeira vez: ultimos 30 dias. Depois, mantem o periodo escolhido e so
    // recalcula a contagem (chegaram chamados novos pelo tempo real).
    async abrir() {
      if (!campoDe.value || !campoAte.value) {
        aplicarPeriodo("30");
      } else {
        atualizarContagem();
      }

      janela.showModal();

      // A planilha cobre "em aberto e finalizados", então precisa do
      // histórico completo — que só entra em memória sob demanda. Recalcula a
      // contagem depois, senão o resumo mostraria só os abertos do período.
      await carregarFechados();
      atualizarContagem();
    },
  };
}

//TICKETS FINALIZADOS: LISTA OS CHAMADOS COM fechamento_em PREENCHIDO.
//Reabrir devolve o card ao quadro, na mesma fila de onde saiu — fila_id
//nunca muda ao fechar, entao nao ha ambiguidade de para onde ele volta.
function ligarFinalizados(chamados, filas, detalhe, carregarFechados) {
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

  //REABRIR PELA LISTA: mesmo caminho do botao do detalhe (grava, devolve o
  //card ao quadro e atualiza o resumo). Sem pergunta — o aviso traz "Desfazer";
  //o erro, se houver, ja aparece como aviso do site.
  async function reabrirChamado(chamado) {
    if (!(await detalhe.definirFechamento(chamado, false))) return;

    desenhar();

    avisarNoSite(`${tituloDoChamado(chamado)} foi reaberto e voltou para o quadro.`, {
      tipo: "sucesso",
      acao: {
        rotulo: "Desfazer",
        aoClicar: async () => {
          if (await detalhe.definirFechamento(chamado, true) && janela.open) desenhar();
        },
      },
    });
  }

  document.querySelector("[data-finalizados-fechar]")
    .addEventListener("click", () => janela.close());
  janela.addEventListener("click", (evento) => {
    if (evento.target === janela) janela.close();
  });

  // A lista e recalculada toda vez que o painel abre, para refletir quem
  // acabou de ser fechado ou reaberto pelo modal do card.
  //
  // Na PRIMEIRA abertura os fechados ainda nao estao em memoria (a carga da
  // pagina traz so os abertos): mostra "Carregando" enquanto busca e desenha
  // de novo quando chegam. Da segunda vez em diante ja estao la e a consulta
  // nao se repete.
  document.querySelector("[data-acao-finalizados]")
    .addEventListener("click", async () => {
      desenhar();

      const aviso = document.createElement("p");
      aviso.className = "finalizados__vazio";
      aviso.textContent = "Carregando chamados finalizados…";

      // Só avisa se ainda não há nada para mostrar — com a lista já
      // preenchida, trocá-la por "Carregando" seria um passo para trás.
      if (!chamados.some((chamado) => chamado.fechamento_em)) {
        lista.replaceChildren(aviso);
      }

      await carregarFechados();
      desenhar();
    });

  // Tempo real: com a lista aberta, quem fecha ou reabre em outra tela
  // aparece (ou some) na hora. Fechada, ela ja se recalcula ao abrir.
  return {
    atualizar() {
      if (janela.open) desenhar();
    },
  };
}

//PLANO DE FUNDO: FOTO PROPRIA DO USUARIO, SALVA NO BUCKET PRIVADO
//"fundos-portal". Sem fundo salvo, o quadro mantem o degrade laranja.
function ligarFundo() {
  const janela = document.querySelector("[data-fundo-modal]");
  const campoArquivo = document.querySelector("[data-fundo-arquivo]");
  const areaSoltar = document.querySelector("[data-fundo-soltar]");
  const previa = document.querySelector("[data-fundo-previa]");
  const seloPrevia = document.querySelector("[data-fundo-previa-selo]");
  const resolucao = document.querySelector("[data-fundo-resolucao]");
  const rodape = document.querySelector("[data-fundo-rodape]");
  const botaoAplicar = document.querySelector("[data-fundo-aplicar]");
  const botaoCancelar = document.querySelector("[data-fundo-cancelar]");
  const botaoRestaurar = document.querySelector("[data-fundo-restaurar]");
  const aviso = document.querySelector("[data-fundo-aviso]");
  const camadaFundo = document.querySelector("[data-portal-fundo]");
  const painelPortal = document.querySelector(".portal");

  // Foto de celular ou print de monitor grande passa facil de 5 MB. O limite
  // antigo obrigava a comprimir antes, e a imagem chegava borrada.
  const TAMANHO_MAXIMO = 15 * 1024 * 1024;

  let usuarioId = null;
  let fundoAtualUrl = null; // URL assinada do fundo salvo; null = degrade padrao
  let escolhido = null; // { arquivo, url, largura, altura } — escolhida, ainda nao aplicada

  function avisar(texto, erro = false) {
    aviso.textContent = texto;
    aviso.classList.toggle("fundo-modal__aviso--erro", erro);
  }

  //APLICA NO QUADRO. So troca depois que a imagem inteira carregou — nunca
  //aparece desenhando em pedacos — e entra com fade. Sem url, volta o degrade.
  function mostrarNoQuadro(url) {
    if (!url) {
      camadaFundo.classList.remove("portal-fundo--visivel");
      painelPortal.classList.remove("portal--fundo-proprio");
      return Promise.resolve(true);
    }

    return new Promise((resolver) => {
      const imagem = new Image();

      imagem.onload = () => {
        camadaFundo.style.backgroundImage = `url("${url}")`;
        camadaFundo.classList.add("portal-fundo--visivel");
        painelPortal.classList.add("portal--fundo-proprio");
        resolver(true);
      };

      imagem.onerror = () => resolver(false);
      imagem.src = url;
    });
  }

  //PREVIA E ESTADO DOS BOTOES: a miniatura mostra a imagem escolhida (se ha),
  //senao o fundo em uso, senao o degrade.
  function desenharPrevia() {
    const url = escolhido?.url ?? fundoAtualUrl;

    previa.style.backgroundImage = url ? `url("${url}")` : "";
    previa.classList.toggle("fundo-modal__previa--padrao", !url);

    seloPrevia.textContent = escolhido ? "Prévia" : fundoAtualUrl ? "Atual" : "Padrão";
    seloPrevia.classList.toggle("fundo-modal__previa-selo--nova", Boolean(escolhido));

    rodape.hidden = !escolhido;

    const padraoEmUso = !fundoAtualUrl && !escolhido;

    botaoRestaurar.disabled = padraoEmUso;
    botaoRestaurar.classList.toggle("fundo-modal__padrao--ativo", padraoEmUso);
  }

  function descartarEscolhido() {
    if (escolhido) URL.revokeObjectURL(escolhido.url);

    escolhido = null;
    resolucao.hidden = true;
    campoArquivo.value = "";
  }

  //RESOLUCAO: compara com os pixels reais da tela (tamanho x densidade — um
  //notebook "1920" com zoom de 150% tem 2880 px de verdade). Como o fundo usa
  //cover, a imagem precisa cobrir as duas dimensoes; se vai ser esticada
  //demais, avisa antes de aplicar que pode ficar desfocada.
  function avaliarResolucao(largura, altura) {
    const densidade = window.devicePixelRatio || 1;
    const larguraTela = Math.round(window.screen.width * densidade);
    const alturaTela = Math.round(window.screen.height * densidade);
    const esticada = Math.max(larguraTela / largura, alturaTela / altura);
    const medidas = `${largura} × ${altura} px`;

    resolucao.hidden = false;

    if (esticada > 1.25) {
      resolucao.textContent =
        `${medidas} — menor que a sua tela (${larguraTela} × ${alturaTela} px). Pode ficar desfocada; prefira uma imagem maior.`;
      resolucao.classList.add("fundo-modal__resolucao--baixa");
      return;
    }

    resolucao.textContent = `${medidas} — fica nítida na sua tela.`;
    resolucao.classList.remove("fundo-modal__resolucao--baixa");
  }

  //ESCOLHER NAO APLICA: vira previa, com Cancelar e Aplicar.
  function escolher(arquivo) {
    if (!arquivo) return;

    if (!arquivo.type.startsWith("image/")) {
      avisar("Escolha um arquivo de imagem (JPG, PNG ou WebP).", true);
      return;
    }

    if (arquivo.size > TAMANHO_MAXIMO) {
      avisar("A imagem precisa ter até 15 MB.", true);
      return;
    }

    descartarEscolhido();

    const url = URL.createObjectURL(arquivo);
    const imagem = new Image();

    imagem.onload = () => {
      escolhido = { arquivo, url, largura: imagem.naturalWidth, altura: imagem.naturalHeight };
      avisar("");
      avaliarResolucao(imagem.naturalWidth, imagem.naturalHeight);
      desenharPrevia();
    };

    imagem.onerror = () => {
      URL.revokeObjectURL(url);
      avisar("Não foi possível ler essa imagem.", true);
    };

    imagem.src = url;
  }

  async function carregarFundoSalvo() {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return null;

    usuarioId = user.id;

    const { data } = await supabase
      .from("usuarios")
      .select("fundo_path")
      .eq("id", user.id)
      .single();

    fundoAtualUrl = null;

    if (data?.fundo_path) {
      // Bucket privado: precisa de URL assinada, diferente do avatar (publico).
      const { data: assinada } = await supabase.storage
        .from("fundos-portal")
        .createSignedUrl(data.fundo_path, 3600);

      fundoAtualUrl = assinada?.signedUrl ?? null;
    }

    const carregou = await mostrarNoQuadro(fundoAtualUrl);

    if (!carregou) {
      fundoAtualUrl = null;
      await mostrarNoQuadro(null);
    }

    desenharPrevia();
  }

  async function aplicar() {
    if (!escolhido || !usuarioId) return;

    botaoAplicar.disabled = true;
    botaoCancelar.disabled = true;
    botaoAplicar.textContent = "Aplicando…";
    avisar("");

    const { arquivo } = escolhido;
    const extensao = (arquivo.name.split(".").pop() || "jpg").toLowerCase();
    const caminho = `${usuarioId}.${extensao}`;

    // Sem compressao nem redimensionar: o arquivo vai exatamente como saiu do
    // computador, na resolucao original. contentType explicito para a imagem
    // colada (Ctrl+V) nao ir como arquivo generico.
    const { error: erroUpload } = await supabase.storage
      .from("fundos-portal")
      .upload(caminho, arquivo, { upsert: true, contentType: arquivo.type, cacheControl: "3600" });

    let erro = erroUpload ? "Não foi possível enviar a imagem." : null;

    if (erroUpload) console.error("Falha ao enviar o plano de fundo:", erroUpload);

    if (!erro) {
      const { error: erroPerfil } = await supabase
        .from("usuarios")
        .update({ fundo_path: caminho })
        .eq("id", usuarioId);

      if (erroPerfil) erro = "A imagem subiu, mas não foi possível salvá-la.";
    }

    botaoAplicar.disabled = false;
    botaoCancelar.disabled = false;
    botaoAplicar.textContent = "Aplicar fundo";

    if (erro) {
      avisar(erro, true);
      return;
    }

    descartarEscolhido();
    await carregarFundoSalvo();
    janela.close();
    avisarNoSite("Plano de fundo aplicado.", { tipo: "sucesso" });
  }

  botaoRestaurar.addEventListener("click", async () => {
    if (!usuarioId) return;

    // Ainda com o degrade salvo, e so havia uma imagem escolhida: o clique
    // so descarta a escolha, sem ir ao banco.
    if (!fundoAtualUrl) {
      descartarEscolhido();
      desenharPrevia();
      return;
    }

    const { error } = await supabase
      .from("usuarios")
      .update({ fundo_path: null })
      .eq("id", usuarioId);

    if (error) {
      avisar("Não foi possível restaurar o fundo padrão.", true);
      return;
    }

    descartarEscolhido();
    fundoAtualUrl = null;
    await mostrarNoQuadro(null);
    desenharPrevia();
    janela.close();
    avisarNoSite("Degradê padrão restaurado.", { tipo: "sucesso" });
  });

  campoArquivo.addEventListener("change", () => escolher(campoArquivo.files[0]));

  //ARRASTAR E SOLTAR NA AREA
  ["dragenter", "dragover"].forEach((tipo) => {
    areaSoltar.addEventListener(tipo, (evento) => {
      evento.preventDefault();
      areaSoltar.classList.add("fundo-modal__soltar--sobre");
    });
  });

  ["dragleave", "drop"].forEach((tipo) => {
    areaSoltar.addEventListener(tipo, (evento) => {
      evento.preventDefault();
      areaSoltar.classList.remove("fundo-modal__soltar--sobre");
    });
  });

  areaSoltar.addEventListener("drop", (evento) => escolher(evento.dataTransfer?.files?.[0]));

  //CTRL+V COM A JANELA ABERTA: um print copiado vira a previa.
  document.addEventListener("paste", (evento) => {
    if (!janela.open) return;

    const imagem = [...(evento.clipboardData?.files ?? [])]
      .find((arquivo) => arquivo.type.startsWith("image/"));

    if (!imagem) return;

    evento.preventDefault();
    escolher(imagem);
  });

  botaoAplicar.addEventListener("click", aplicar);

  botaoCancelar.addEventListener("click", () => {
    descartarEscolhido();
    avisar("");
    desenharPrevia();
  });

  // Fechou sem aplicar (x, Esc, clique fora): a escolha nao fica pendurada.
  janela.addEventListener("close", () => {
    descartarEscolhido();
    avisar("");
    desenharPrevia();
  });

  document.querySelector("[data-fundo-fechar]")
    .addEventListener("click", () => janela.close());
  janela.addEventListener("click", (evento) => {
    if (evento.target === janela) janela.close();
  });

  carregarFundoSalvo();
}

//RESUMO NO CABECALHO: SO CONTA O QUE ESTA ABERTO. Chamado fechado nao
//esta escondido por engano — foi fechado por decisao de quem atende.
function atualizarResumo(chamados, totalFilas) {
  const abertos = chamados.filter((chamado) => !chamado.fechamento_em);
  const texto =
    `${abertos.length} ${abertos.length === 1 ? "chamado aberto" : "chamados abertos"} em ${totalFilas} filas`;

  if (!totalDeFiltros()) {
    resumo.textContent = texto;
    return;
  }

  // Com filtro: quantos aparecem de quantos existem.
  const visiveis = abertos.filter(chamadoPassaNosFiltros).length;
  resumo.textContent = `${visiveis} de ${texto} · com filtro`;
}

//CAMPOS DE UM CHAMADO: A MESMA SELECAO NA CARGA DO QUADRO E NO TEMPO REAL,
//para o chamado que chega por evento ter exatamente o formato dos outros.

//TEMPO REAL (Supabase Realtime): O QUADRO ACOMPANHA O BANCO SEM RECARREGAR.
//Qualquer mudanca em chamados, comentarios, membros ou anexos vira "busque
//de novo este chamado": em vez de remendar o card com o pedaco que veio no
//evento, a tela pede o chamado inteiro com a mesma consulta da carga — um
//caminho so para desenhar, e o RLS continua decidindo o que cada um ve.
//Mudanca em usuarios (cor, foto, nome) atualiza a pessoa onde ela aparece.
//Precisa da migration 20260914160000_realtime_portal.sql aplicada.
function ligarTempoReal({ chamados, filas, equipe, corDe, detalhe, finalizados, terceiros }) {
  const pendentes = new Map(); // chamado_id -> timeout da busca agendada
  let esperaRessincronizar = null;
  let jaConectou = false;

  function aplicarCores(chamado) {
    chamado.chamado_membros.forEach((membro) => {
      if (membro.usuarios) membro.usuarios.cor_destaque = corDe.get(membro.usuario_id) ?? null;
    });
  }

  function colunaDaFila(filaId) {
    return quadro.querySelector(`.fila[data-fila="${filaId}"]`);
  }

  //O CARD NO QUADRO ACOMPANHA O CHAMADO EM MEMORIA: aparece, some, muda de
  //fila ou so se redesenha no mesmo lugar.
  function reconciliarCard(chamado) {
    const atual = quadro.querySelector(`.card[data-chamado="${chamado.id}"]`);

    // Card sendo arrastado agora: trocar o elemento cancelaria o arrasto.
    // Busca de novo daqui a pouco, quando a pessoa ja tiver soltado.
    if (atual?.classList.contains("card--arrastando")) {
      agendar(chamado.id, 600);
      return;
    }

    const colunaAntiga = atual?.closest(".fila") ?? null;

    // Fechado vive em Tickets finalizados, nao no quadro.
    if (chamado.fechamento_em) {
      atual?.remove();
      if (colunaAntiga) sincronizarColuna(colunaAntiga);
      return;
    }

    const colunaNova = colunaDaFila(chamado.fila_id);
    const novo = montarCard(chamado);

    if (atual && colunaAntiga === colunaNova) {
      // Mesma fila: troca por cima, sem mudar a posicao do card.
      atual.replaceWith(novo);
      return;
    }

    atual?.remove();
    if (colunaAntiga) sincronizarColuna(colunaAntiga);

    // Fila que nao esta no quadro (inativa): o chamado fica so em memoria.
    if (!colunaNova) return;

    // A carga ordena do mais novo para o mais antigo; quem chega entra na
    // posicao que teria se a pagina fosse recarregada.
    const lista = colunaNova.querySelector(".fila__cards");
    const antesDe = [...lista.querySelectorAll(".card")].find((card) => {
      const outro = chamados.find((item) => item.id === card.dataset.chamado);

      return outro && new Date(outro.abertura_em) < new Date(chamado.abertura_em);
    });

    lista.insertBefore(novo, antesDe ?? null);
    sincronizarColuna(colunaNova);
  }

  function removerChamado(id) {
    const indice = chamados.findIndex((chamado) => chamado.id === id);

    if (indice === -1) return;

    chamados.splice(indice, 1);

    const card = quadro.querySelector(`.card[data-chamado="${id}"]`);
    const coluna = card?.closest(".fila");

    card?.remove();
    if (coluna) sincronizarColuna(coluna);

    detalhe.fecharSeRemovido(id);
  }

  //O CHAMADO QUE VEIO DO BANCO ENTRA NO ARRAY. Chamado ja conhecido e
  //atualizado no mesmo objeto (Object.assign), e nao trocado: o detalhe
  //aberto e a busca seguram a referencia dele.
  //As notificacoes de "chamado novo"/"solicitante respondeu" nao moram
  //mais aqui — viraram responsabilidade do servidor (trigger + Edge
  //Function notificar-portal, via Web Push), porque o navegador suspende
  //o WebSocket do tempo real com a aba em segundo plano e a versao
  //client-side so avisava quando a pessoa ja tinha voltado pra aba.
  function guardarChamado(dados) {
    aplicarCores(dados);

    const existente = chamados.find((chamado) => chamado.id === dados.id);
    const chamado = existente ? Object.assign(existente, dados) : dados;

    if (!existente) chamados.unshift(chamado);

    reconciliarCard(chamado);
    detalhe.atualizarSeAberto(chamado);
  }

  function depoisDeMudar() {
    atualizarResumo(chamados, filas.length);
    finalizados.atualizar();
  }

  async function recarregarChamado(id) {
    pendentes.delete(id);

    const { data, error } = await supabase
      .from("chamados")
      .select(CAMPOS_CHAMADO)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.warn("Tempo real: não foi possível atualizar o chamado", id, error);
      return;
    }

    // Sem linha: foi apagado, ou o RLS deixou de mostrar para esta pessoa.
    if (data) guardarChamado(data); else removerChamado(id);

    depoisDeMudar();
  }

  //VARIOS EVENTOS DO MESMO CHAMADO EM SEQUENCIA (responder com anexo gera
  //comentario + anexo; abrir um chamado gera o chamado + a mensagem
  //automatica) viram uma busca so.
  function agendar(id, espera = 150) {
    clearTimeout(pendentes.get(id));
    pendentes.set(id, setTimeout(() => recarregarChamado(id), espera));
  }

  //TUDO DE NOVO: depois de uma reconexao, eventos podem ter se perdido.
  function ressincronizar() {
    clearTimeout(esperaRessincronizar);

    esperaRessincronizar = setTimeout(async () => {
      // Mesma regra da carga inicial: so os abertos. Isto roda a cada volta
      // para a aba e a cada evento de tempo real, entao e o ponto que mais
      // pesaria na rede se baixasse a lista inteira.
      const { data, error } = await supabase
        .from("chamados")
        .select(CAMPOS_CHAMADO)
        .is("fechamento_em", null)
        .order("abertura_em", { ascending: false });

      if (error) {
        console.warn("Tempo real: não foi possível ressincronizar o quadro", error);
        return;
      }

      const visiveis = new Set(data.map((chamado) => chamado.id));

      // "Sumiu da resposta" agora tem dois significados: o chamado foi
      // apagado OU foi fechado. Um chamado fechado que ja esta em memoria
      // (porque os fechados foram carregados) nao pode ser removido — ele
      // ainda aparece na janela de finalizados. Some so do quadro, e disso
      // cuida o filtro de cardsDaFila.
      [...chamados]
        .filter((chamado) => !visiveis.has(chamado.id) && !chamado.fechamento_em)
        .forEach((chamado) => removerChamado(chamado.id));

      data.forEach(guardarChamado);
      depoisDeMudar();
    }, 300);
  }

  //DE QUAL CHAMADO E O EVENTO. Em DELETE vem a linha antiga — inteira com a
  //replica identity full da migration. Como reserva, procura em memoria de
  //quem era aquele comentario ou anexo.
  function chamadoDoEvento(tabela, payload) {
    const linha = payload.eventType === "DELETE" ? payload.old : payload.new;

    if (!linha) return null;
    if (tabela === "chamados") return linha.id ?? null;
    if (linha.chamado_id) return linha.chamado_id;
    if (tabela === "chamado_membros") return null;

    return chamados.find((chamado) =>
      (chamado[tabela] ?? []).some((item) => item.id === linha.id))?.id ?? null;
  }

  //PESSOA MUDOU (cor, foto, nome): atualiza onde ela aparece — membro de
  //card, autor de comentario, lista da equipe — e redesenha so o necessario.
  function atualizarPessoa(pessoa) {
    if (!pessoa?.id) return;

    if ("cor_destaque" in pessoa) corDe.set(pessoa.id, pessoa.cor_destaque);

    const campos = Object.fromEntries(
      ["nome", "sobrenome", "foto_path", "cor_destaque"]
        .filter((campo) => campo in pessoa)
        .map((campo) => [campo, pessoa[campo]]),
    );

    equipe.forEach((membro) => {
      if (membro.id === pessoa.id) Object.assign(membro, campos);
    });

    chamados.forEach((chamado) => {
      let aparece = false;

      chamado.chamado_membros.forEach((membro) => {
        if (membro.usuario_id !== pessoa.id || !membro.usuarios) return;

        Object.assign(membro.usuarios, campos);
        aparece = true;
      });

      chamado.comentarios.forEach((comentario) => {
        if (comentario.autor_id !== pessoa.id || !comentario.usuarios) return;

        Object.assign(comentario.usuarios, campos);
        aparece = true;
      });

      if (!aparece) return;

      reconciliarCard(chamado);
      detalhe.atualizarSeAberto(chamado);
    });
  }

  //TERCEIRO MUDOU (nome, foto): mesma ideia de atualizarPessoa, mas so os
  //dois campos que o terceiro tem. Sem isto, trocar a foto de um fornecedor
  //no Painel > Terceirizados nao aparecia em nenhum chamado ja carregado —
  //so depois de recarregar a página, porque o objeto `terceiros` dentro de
  //chamado_terceiros já tinha sido copiado pra memória antes da troca.
  function atualizarTerceiro(fornecedor) {
    if (!fornecedor?.id) return;

    const campos = Object.fromEntries(
      ["nome", "foto_path"]
        .filter((campo) => campo in fornecedor)
        .map((campo) => [campo, fornecedor[campo]]),
    );

    terceiros.forEach((item) => {
      if (item.id === fornecedor.id) Object.assign(item, campos);
    });

    chamados.forEach((chamado) => {
      let aparece = false;

      (chamado.chamado_terceiros ?? []).forEach((vinculo) => {
        if (vinculo.terceiro_id !== fornecedor.id || !vinculo.terceiros) return;

        Object.assign(vinculo.terceiros, campos);
        aparece = true;
      });

      if (!aparece) return;

      reconciliarCard(chamado);
      detalhe.atualizarSeAberto(chamado);
    });
  }

  const canal = supabase.channel("portal-chamados");

  ["chamados", "comentarios", "chamado_membros", "chamado_terceiros", "anexos"].forEach((tabela) => {
    canal.on("postgres_changes", { event: "*", schema: "public", table: tabela }, (payload) => {
      const id = chamadoDoEvento(tabela, payload);

      if (id) agendar(id); else ressincronizar();
    });
  });

  canal.on("postgres_changes", { event: "UPDATE", schema: "public", table: "terceiros" }, (payload) => {
    atualizarTerceiro(payload.new);
  });

  canal.on("postgres_changes", { event: "UPDATE", schema: "public", table: "usuarios" }, (payload) => {
    atualizarPessoa(payload.new);
  });

  canal.subscribe((status, erroCanal) => {
    if (status === "SUBSCRIBED") {
      // Na primeira vez a carga acabou de acontecer. Numa reconexao (rede
      // caiu, computador dormiu), o que mudou nesse meio tempo nao chegou.
      if (jaConectou) ressincronizar();
      jaConectou = true;
      return;
    }

    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      console.warn("Tempo real desconectado; o Supabase tenta reconectar sozinho.", status, erroCanal);
    }
  });

  // Aba que volta a ficar visivel: o navegador pode ter pausado a conexao
  // enquanto ela estava escondida. Confere se nada ficou para tras.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && jaConectou) ressincronizar();
  });
}

//CHAMADOS FECHADOS, SO QUANDO ALGUEM PRECISA DELES.
//
//O quadro vive so dos abertos, mas a janela de finalizados, a exportacao por
//periodo e os contadores precisam do historico inteiro. Em vez de baixar
//tudo sempre (o que com ~14 mil chamados seria varios MB a cada carga da
//pagina), os fechados entram na primeira vez que um desses recursos e usado
//e ficam no mesmo array — as chamadas seguintes nao repetem a consulta.
//
//A promessa e guardada, e nao so um booleano: dois recursos abertos ao mesmo
//tempo (buscar enquanto a janela de finalizados carrega) esperam a MESMA
//consulta em vez de dispararem duas.
function criarCarregadorDeFechados(chamados, aoCarregar) {
  let promessa = null;

  return function carregarFechados() {
    if (promessa) return promessa;

    promessa = (async () => {
      const { data, error } = await supabase
        .from("chamados")
        .select(CAMPOS_CHAMADO)
        .not("fechamento_em", "is", null)
        .order("fechamento_em", { ascending: false });

      if (error) {
        console.warn("Não foi possível carregar os chamados finalizados", error);
        // Zera para uma próxima tentativa poder acontecer: uma falha de rede
        // não pode deixar a janela de finalizados vazia para sempre.
        promessa = null;
        return;
      }

      // Só o que ainda não está em memória: um chamado fechado agora há
      // pouco pode ter chegado pelo tempo real antes desta consulta.
      const conhecidos = new Set(chamados.map((chamado) => chamado.id));

      data.forEach((chamado) => {
        if (!conhecidos.has(chamado.id)) chamados.push(chamado);
      });

      aoCarregar();
    })();

    return promessa;
  };
}

async function montarQuadro() {
  const usuarioAtendendo = await quemEstaAtendendo();

  if (!usuarioAtendendo) {
    window.location.href = "index.html";
    return;
  }

  const atendente = usuarioAtendendo.id;

  const [filas, chamados, equipe, cores, terceiros] = await Promise.all([
    supabase.from("filas").select("id, nome, ordem").eq("ativo", true).order("ordem"),
    // SO OS ABERTOS: o quadro nunca mostra chamado fechado (ver o filtro em
    // cardsDaFila), e a lista completa cresce para sempre — com os ~14 mil da
    // migracao seriam varios MB baixados a cada carga e a cada volta para a
    // aba. Os fechados entram sob demanda, em carregarFechados().
    supabase
      .from("chamados")
      .select(CAMPOS_CHAMADO)
      .is("fechamento_em", null)
      .order("abertura_em", { ascending: false }),
    // Quem pode ser posto num chamado: a propria equipe de TI (mesma regra de
    // is_equipe_ti no banco). Lista explicita, e nao "todo mundo que nao e
    // solicitante": o contribuinte escreve na Base mas nao atende chamado.
    supabase
      .from("usuarios")
      .select("id, nome, sobrenome, foto_path")
      .in("perfil", ["analista", "admin"])
      .eq("ativo", true)
      .order("nome"),
    // Cor de destaque em consulta separada, de proposito: se a coluna ainda
    // nao existir no banco (migration nao aplicada), so esta falha — dentro
    // da consulta dos chamados, derrubaria o quadro inteiro.
    supabase.from("usuarios").select("id, cor_destaque"),
    // FORNECEDORES EXTERNOS (Vivo, Sematec...) que podem ser marcados como
    // "atendendo" um chamado, sem ter conta no sistema — ver Membros >
    // Terceiro no detalhe.
    supabase.from("terceiros").select("id, nome, foto_path").eq("ativo", true).order("nome"),
  ]);

  if (filas.error || chamados.error) {
    console.error("Erro ao carregar o quadro:", filas.error ?? chamados.error);
    resumo.textContent = "";
    mostrarErro("Não foi possível carregar o quadro. Recarregue a página.");
    return;
  }

  //COR DE DESTAQUE: SE A CONSULTA FALHOU, O QUADRO SEGUE SEM COR. O mapa
  //existe nos dois casos: o tempo real guarda nele as cores que mudarem.
  const corDe = new Map();

  if (cores.error) {
    console.warn("Cor de destaque indisponível (a migration foi aplicada?):", cores.error);
  } else {
    cores.data.forEach((pessoa) => corDe.set(pessoa.id, pessoa.cor_destaque));

    (equipe.data ?? []).forEach((pessoa) => {
      pessoa.cor_destaque = corDe.get(pessoa.id) ?? null;
    });

    chamados.data.forEach((chamado) => {
      chamado.chamado_membros.forEach((membro) => {
        if (membro.usuarios) membro.usuarios.cor_destaque = corDe.get(membro.usuario_id) ?? null;
      });
    });
  }

  //O BOTAO DE ADICIONAR LISTA JA ESTA NO HTML, sempre por ultimo — as
  //colunas entram sempre ANTES dele (insertBefore), nunca appendChild no
  //quadro direto, senao a coluna nova nasceria depois do botao.
  const filaNova = document.querySelector("[data-fila-nova]");

  //FECHADO NAO APARECE NO QUADRO: vive em Tickets finalizados. O array
  //chamados.data continua com todos — o quadro so filtra na hora de montar.
  filas.data.forEach((fila) => {
    const daFila = chamados.data.filter(
      (chamado) => chamado.fila_id === fila.id && !chamado.fechamento_em,
    );
    quadro.insertBefore(montarFila(fila, daFila), filaNova);
  });

  atualizarResumo(chamados.data, filas.data.length);

  ligarArrastar();
  ligarArrastoDoFundo();
  ligarBarra();
  const detalhe = ligarDetalhe(
    chamados.data, filas.data, equipe.data ?? [], atendente, {}, usuarioAtendendo.perfil,
    terceiros.data ?? [],
  );
  // Redesenha quem mostra chamado fechado, depois que eles chegam. A função
  // é declarada aqui mas só roda depois do carregamento, quando `finalizados`
  // abaixo já existe.
  // O resumo do topo conta só chamados abertos, então não precisa ser
  // redesenhado aqui — quem depende dos fechados é a janela de finalizados.
  let finalizados = null;
  const carregarFechados = criarCarregadorDeFechados(chamados.data, () => {
    finalizados?.atualizar();
  });

  // A busca abre o modal (via detalhe.abrir) quando o achado e um chamado
  // finalizado — esse nao tem card no quadro para rolar ate.
  ligarBusca(chamados.data, filas.data, detalhe);
  const exportar = ligarExportar(chamados.data, filas.data, carregarFechados);
  ligarQuadroMenu(exportar);
  ligarNotificacoes(atendente, usuarioAtendendo.notificacoesAtivas);
  ligarFiltros(chamados.data, equipe.data ?? [], filas.data);
  finalizados = ligarFinalizados(chamados.data, filas.data, detalhe, carregarFechados);
  ligarFundo();
  ligarListaNova(filas.data);
  ligarArrastarLista(filas.data, chamados.data);

  // Por ultimo: so escuta o banco depois que o quadro inteiro ja esta na tela.
  ligarTempoReal({
    chamados: chamados.data,
    filas: filas.data,
    equipe: equipe.data ?? [],
    corDe,
    detalhe,
    finalizados,
    terceiros: terceiros.data ?? [],
  });
}

//SO MONTA O QUADRO NA TELA QUE TEM QUADRO. O Painel importa este arquivo
//para reusar o modal de detalhe (ligarDetalhe) sem levantar kanban, zoom e
//tema junto — por isso o arranque mora atras deste if.
if (quadro) {
  ligarTema();
  ligarZoom();
  montarQuadro();
}

export { ligarDetalhe, avisarNoSite, confirmarNoSite, quemEstaAtendendo };
