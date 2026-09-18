// Solicitações: os chamados de quem está logado, com a conversa.
//
// O status é derivado do mesmo jeito que no Portal e na home — quem falou
// por último —, mas com o vocabulário do solicitante:
//   Portal "Aberto"             -> aqui "Aberto"
//   Portal "Usuário respondeu"  -> aqui "Em andamento" (a bola é da equipe)
//   Portal "Aguardando retorno" -> aqui "Aguardando você"
//   Portal "Fechado"            -> aqui "Fechado"

import { supabase } from "../config/supabase-config.js";
import { pintarFoto } from "../componentes/avatar.js";

const lista = document.querySelector("[data-lista]");
const vazioEl = document.querySelector("[data-vazio]");
const resumoEl = document.querySelector("[data-resumo]");
const erroEl = document.querySelector("[data-erro]");
const campoBusca = document.querySelector("[data-busca]");
const botoesFiltro = document.querySelectorAll("[data-filtro]");

const janela = document.querySelector("[data-detalhe]");
const detalheNumero = document.querySelector("[data-detalhe-numero]");
const detalheTitulo = document.querySelector("[data-detalhe-titulo]");
const detalheMeta = document.querySelector("[data-detalhe-meta]");
const conversaEl = document.querySelector("[data-conversa]");
const formResponder = document.querySelector("[data-responder]");
const campoResposta = document.querySelector("[data-responder-campo]");
const avisoResposta = document.querySelector("[data-responder-aviso]");
const avisoFechado = document.querySelector("[data-detalhe-fechado]");
const botaoReabrir = document.querySelector("[data-detalhe-reabrir]");
const avisoReabrir = document.querySelector("[data-detalhe-reabrir-aviso]");

const STATUS = {
  aberto: { chave: "aberto", rotulo: "Aberto" },
  andamento: { chave: "andamento", rotulo: "Em andamento" },
  aguardando: { chave: "aguardando", rotulo: "Aguardando você" },
  fechado: { chave: "fechado", rotulo: "Fechado" },
};

let chamados = [];
let usuarioId = null;
let filtroAtivo = "";
let aberto = null;

//MESMA CONSULTA NA CARGA E NO TEMPO REAL: um caminho só para montar o
//chamado, igual o Portal faz com CAMPOS_CHAMADO.
const CAMPOS_CHAMADO = `
  id, numero, titulo, descricao, abertura_em, fechamento_em, solicitante_id,
  categorias(nome),
  comentarios(id, autor_id, texto, visibilidade, tipo, criado_em, artigo_id,
              artigos(titulo, ativo), usuarios(nome, sobrenome, foto_path))
`;

function mostrarErro(texto) {
  erroEl.textContent = texto;
  erroEl.classList.add("solicitacoes__erro--visivel");
}

//NOTIFICACOES DO NAVEGADOR (WEB PUSH DE VERDADE): quando um atendente
//responde o chamado. Mesma mecanica do Portal (ligarNotificacoes em
//portal.js) — Service Worker compartilhado (sw.js, na raiz de public/),
//mesma tabela push_subscriptions, mesma preferencia
//usuarios.notificacoes_ativas. Copiada aqui porque as duas telas nao
//compartilham modulo.
const VAPID_CHAVE_PUBLICA = "BIGSZJ5WgPPZ4QiousUz386eNLUY-GKuKmne3VzyZfL9RLx-kUNHOMa3nD1KzxmNy2njaxw4URNqE7A_1934ho8";

function chaveVapidParaUint8Array(chaveBase64) {
  const preenchimento = "=".repeat((4 - (chaveBase64.length % 4)) % 4);
  const base64 = (chaveBase64 + preenchimento).replace(/-/g, "+").replace(/_/g, "/");
  const bruto = window.atob(base64);

  return Uint8Array.from([...bruto].map((caractere) => caractere.charCodeAt(0)));
}

function ligarNotificacoes(idUsuario, ativasNoCadastro) {
  const item = document.querySelector("[data-acao-notificacoes]");

  if (!item) return;

  const suportado = "serviceWorker" in navigator && "PushManager" in window;

  let ativas = Boolean(ativasNoCadastro) && suportado && Notification.permission === "granted";

  function desenhar() {
    item.setAttribute("aria-checked", String(ativas));
  }

  desenhar();

  if (ativasNoCadastro && suportado && Notification.permission !== "granted") {
    supabase.from("usuarios").update({ notificacoes_ativas: false }).eq("id", idUsuario);
  }

  async function inscrever() {
    const registro = await navigator.serviceWorker.register("/sw.js");
    const existente = await registro.pushManager.getSubscription();
    const subscription = existente ?? await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: chaveVapidParaUint8Array(VAPID_CHAVE_PUBLICA),
    });

    const json = subscription.toJSON();

    await supabase.from("push_subscriptions").upsert({
      usuario_id: idUsuario,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    }, { onConflict: "endpoint" });
  }

  async function desinscrever() {
    if (!("serviceWorker" in navigator)) return;

    const registro = await navigator.serviceWorker.getRegistration("/sw.js");
    const subscription = await registro?.pushManager.getSubscription();

    if (!subscription) return;

    await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
    await subscription.unsubscribe();
  }

  item.addEventListener("click", async () => {
    if (ativas) {
      ativas = false;
      desenhar();
      await supabase.from("usuarios").update({ notificacoes_ativas: false }).eq("id", idUsuario);
      await desinscrever();
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

    ativas = true;
    desenhar();
    await supabase.from("usuarios").update({ notificacoes_ativas: true }).eq("id", idUsuario);
  });

  if (ativas) {
    inscrever().catch((erro) => console.warn("Não foi possível confirmar a inscrição de notificações:", erro));
  }
}

//SO CONVERSA DE VERDADE MUDA O STATUS: mensagem automatica de abertura
//(tipo 'sistema') nao conta, senao todo chamado nasceria "em andamento".
function comentariosHumanos(chamado) {
  return (chamado.comentarios ?? [])
    .filter((c) => c.visibilidade === "publico" && c.tipo === "humano")
    .sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));
}

function derivarStatus(chamado) {
  if (chamado.fechamento_em) return STATUS.fechado;

  const ultimo = comentariosHumanos(chamado).at(-1);

  if (!ultimo) return STATUS.aberto;

  return ultimo.autor_id === usuarioId ? STATUS.andamento : STATUS.aguardando;
}

//O titulo do banco nasce como "Categoria | Ticket-N" (convencao do Portal,
//onde o analista precisa do numero no titulo). Aqui o numero ja aparece
//sozinho na linha de apoio, entao o sufixo sai — repetido, vira ruido.
function tituloDoChamado(chamado) {
  const bruto = chamado.titulo
    ?? `${chamado.categorias?.nome ?? "Sem categoria"} | Ticket-${chamado.numero}`;

  // O sufixo sai mesmo que alguem tenha editado o titulo e deixado algo
  // depois do numero ("... | Ticket-103 d") — o corte e do "|" em diante.
  return bruto.replace(/\s*\|\s*Ticket-\d+\b.*$/i, "").trim() || bruto;
}

function iniciais(nome, sobrenome) {
  const primeira = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  const ultima = (sobrenome ?? "").trim().split(/\s+/).pop() ?? "";

  return (primeira[0] ?? "").concat(ultima[0] ?? "").toUpperCase();
}

function nomeCompleto(pessoa) {
  if (!pessoa) return null;

  return [pessoa.nome, pessoa.sobrenome].filter(Boolean).join(" ");
}

//AVATAR DA CONVERSA: MESMA FOTO DO PORTAL E DE "Dados pessoais" — a que a
//pessoa enviou para o bucket 'avatares'. Sem foto, ficam as iniciais.
function montarAvatar(pessoa) {
  const avatar = document.createElement("span");
  avatar.className = "mensagem__avatar";
  // No balão vai só o primeiro nome; o completo fica no title, ao passar o mouse.
  avatar.title = nomeCompleto(pessoa) ?? "Alguém";

  // Com foto, as iniciais não aparecem antes dela (era a troca que piscava).
  pintarFoto(avatar, pessoa?.foto_path, iniciais(pessoa?.nome, pessoa?.sobrenome));

  return avatar;
}

function formatarData(iso) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function formatarDataHora(iso) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

/* ==========================================================================
   LISTA
   ========================================================================== */

//ICONES DAS ETIQUETAS DO CARTAO (mesmo traço dos cards da Base de Soluções)
const ICONE_CATEGORIA = '<path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3H4a1 1 0 0 0-1 1v5.59a2 2 0 0 0 .59 1.41l9.58 9.58a2 2 0 0 0 2.83 0l4.59-4.59a2 2 0 0 0 0-2.83z"/><circle cx="7.5" cy="7.5" r="1"/>';
const ICONE_CONVERSA = '<path d="M20 4.5H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3v3.5l4-3.5h9a1 1 0 0 0 1-1v-10a1 1 0 0 0-1-1Z"/>';
const ICONE_RELOGIO = '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>';

function montarIcone(caminhos, classe) {
  const icone = document.createElementNS("http://www.w3.org/2000/svg", "svg");

  icone.setAttribute("class", classe);
  icone.setAttribute("viewBox", "0 0 24 24");
  icone.setAttribute("fill", "none");
  icone.setAttribute("stroke", "currentColor");
  icone.setAttribute("stroke-width", "1.8");
  icone.setAttribute("stroke-linecap", "round");
  icone.setAttribute("stroke-linejoin", "round");
  icone.setAttribute("aria-hidden", "true");
  icone.innerHTML = caminhos;

  return icone;
}

function montarEtiqueta(caminhos, texto) {
  const etiqueta = document.createElement("span");
  etiqueta.className = "chamado__tag";
  etiqueta.append(montarIcone(caminhos, "chamado__tag-icone"), document.createTextNode(texto));

  return etiqueta;
}

//QUEM DA EQUIPE CONVERSOU COM A PESSOA: autores das mensagens que nao sao
//dela, sem repetir, do que respondeu por ultimo para o primeiro. Vem da
//conversa, e nao de chamado_membros: o chamado pode ter varios membros
//atribuidos, mas para o solicitante so importa quem de fato falou com ele.
function pessoasQueResponderam(humanos) {
  const porAutor = new Map();

  [...humanos].reverse().forEach((comentario) => {
    if (comentario.autor_id === usuarioId || porAutor.has(comentario.autor_id)) return;

    porAutor.set(comentario.autor_id, comentario.usuarios);
  });

  return [...porAutor.values()];
}

// "João" · "João e Paulo" · "João, Paulo e Enzo" · "João, Paulo e mais 2"
function juntarNomes(nomes) {
  if (nomes.length <= 1) return nomes[0] ?? "";
  if (nomes.length === 2) return `${nomes[0]} e ${nomes[1]}`;
  if (nomes.length === 3) return `${nomes[0]}, ${nomes[1]} e ${nomes[2]}`;

  return `${nomes[0]}, ${nomes[1]} e mais ${nomes.length - 2}`;
}

//CARTAO EM GRADE, NO ESTILO DOS CARDS DA BASE DE SOLUCOES: status e numero no
//topo, titulo, descricao curta, etiquetas e, no rodape, quem da equipe
//respondeu por ultimo e quando o chamado foi aberto. O cartao inteiro e o
//botao: a area de clique e o que o olho entende como "um chamado".
function montarCartao(chamado) {
  const status = derivarStatus(chamado);
  const humanos = comentariosHumanos(chamado);

  const item = document.createElement("li");

  const cartao = document.createElement("button");
  cartao.type = "button";
  cartao.className = `chamado chamado--${status.chave}`;

  //TOPO: STATUS (+ "Responda") E NUMERO
  const topo = document.createElement("span");
  topo.className = "chamado__topo";

  const selos = document.createElement("span");
  selos.className = "chamado__selos";

  const selo = document.createElement("span");
  selo.className = "chamado__status";
  selo.textContent = status.rotulo;
  selos.appendChild(selo);

  // "Aguardando você" é o único estado que pede ação — e o único que ganha
  // um segundo sinal além da cor, para não depender só dela.
  if (status === STATUS.aguardando) {
    const aviso = document.createElement("span");
    aviso.className = "chamado__aviso";
    aviso.textContent = "Responda";
    selos.appendChild(aviso);
  }

  const numero = document.createElement("span");
  numero.className = "chamado__numero";
  numero.textContent = `#${chamado.numero}`;

  topo.append(selos, numero);

  //TITULO E DESCRICAO
  const assunto = document.createElement("span");
  assunto.className = "chamado__assunto";
  assunto.textContent = tituloDoChamado(chamado);

  const descricao = document.createElement("span");
  descricao.className = "chamado__descricao";
  descricao.textContent = chamado.descricao?.trim() || "Sem descrição.";
  descricao.classList.toggle("chamado__descricao--vazia", !chamado.descricao?.trim());

  //ETIQUETAS: CATEGORIA E TAMANHO DA CONVERSA
  const etiquetas = document.createElement("span");
  etiquetas.className = "chamado__tags";
  etiquetas.appendChild(montarEtiqueta(ICONE_CATEGORIA, chamado.categorias?.nome ?? "Sem categoria"));

  if (humanos.length) {
    etiquetas.appendChild(montarEtiqueta(
      ICONE_CONVERSA,
      `${humanos.length} ${humanos.length === 1 ? "mensagem" : "mensagens"}`,
    ));
  }

  //RODAPE: SO QUEM DA EQUIPE CONVERSOU COM A PESSOA (nao todos os membros
  //do chamado) — ou, se ninguem respondeu, que ainda ninguem pegou.
  const rodape = document.createElement("span");
  rodape.className = "chamado__rodape";

  const quemConversou = pessoasQueResponderam(humanos);
  const quem = document.createElement("span");
  quem.className = "chamado__quem";

  if (quemConversou.length) {
    // Fotos empilhadas, no maximo 3; o texto diz o resto.
    const avatares = document.createElement("span");
    avatares.className = "chamado__avatares";

    quemConversou.slice(0, 3).forEach((pessoa) => {
      // Mesma foto da conversa; só troca a classe para o tamanho do cartão.
      const avatar = montarAvatar(pessoa);
      avatar.className = "chamado__avatar";
      avatares.appendChild(avatar);
    });

    // So os nomes: "Respondido por" na mesma linha empurrava o segundo nome
    // para fora do cartao. O contexto fica nas fotos e no title.
    quem.textContent = juntarNomes(quemConversou.map((pessoa) => pessoa?.nome ?? "Equipe de TI"));
    // Nomes completos ao passar o mouse, inclusive os que ficaram no "mais N".
    quem.title = `Respondido por ${quemConversou.map((pessoa) => nomeCompleto(pessoa) || "Equipe de TI").join(", ")}`;

    rodape.appendChild(avatares);
  } else {
    const semResposta = document.createElement("span");
    semResposta.className = "chamado__avatar chamado__avatar--vazio";
    semResposta.appendChild(montarIcone(ICONE_RELOGIO, "chamado__avatar-icone"));

    quem.classList.add("chamado__quem--vazio");
    quem.textContent = chamado.fechamento_em ? "Sem resposta da equipe" : "Aguardando atendimento";
    rodape.appendChild(semResposta);
  }

  // Nomes em cima, data embaixo: o nome ganha a largura toda do cartao em vez
  // de dividir a linha com a data.
  const quando = document.createElement("span");
  quando.className = "chamado__quando";
  quando.textContent = `Aberto em ${formatarData(chamado.abertura_em)}`;

  const textoRodape = document.createElement("span");
  textoRodape.className = "chamado__rodape-texto";
  textoRodape.append(quem, quando);

  rodape.appendChild(textoRodape);

  cartao.append(topo, assunto, descricao, etiquetas, rodape);
  // O cartao e reaproveitado entre redesenhos (cartaoDoChamado), e o tempo
  // real troca o objeto do chamado: abre sempre a versao atual pela id.
  cartao.addEventListener("click", () => {
    abrirDetalhe(chamados.find((atual) => atual.id === chamado.id) ?? chamado);
  });

  item.appendChild(cartao);

  return item;
}

//CARTOES JA MONTADOS, POR CHAMADO. A busca e os filtros redesenham a lista a
//cada tecla: recriar todos os cartoes recriava as fotos junto, e a lista
//piscava. Agora o cartao so e remontado quando algo que ele mostra mudou
//(a assinatura); nos outros casos o mesmo elemento volta para a lista.
const cartoesMontados = new Map(); // id do chamado -> { assinatura, item }

function assinaturaDoCartao(chamado) {
  return JSON.stringify([
    chamado.numero,
    chamado.titulo,
    chamado.descricao,
    chamado.abertura_em,
    chamado.fechamento_em,
    chamado.categorias?.nome,
    (chamado.comentarios ?? []).map((comentario) => [
      comentario.id,
      comentario.visibilidade,
      comentario.tipo,
      comentario.usuarios?.nome,
      comentario.usuarios?.sobrenome,
      comentario.usuarios?.foto_path,
    ]),
  ]);
}

function cartaoDoChamado(chamado) {
  const assinatura = assinaturaDoCartao(chamado);
  const guardado = cartoesMontados.get(chamado.id);

  if (guardado?.assinatura === assinatura) return guardado.item;

  const item = montarCartao(chamado);
  cartoesMontados.set(chamado.id, { assinatura, item });

  return item;
}

function desenharLista() {
  const termo = campoBusca.value.trim().toLowerCase();

  const filtrados = chamados.filter((chamado) => {
    if (filtroAtivo && derivarStatus(chamado).chave !== filtroAtivo) return false;

    if (!termo) return true;

    return [
      `#${chamado.numero}`,
      String(chamado.numero),
      tituloDoChamado(chamado),
      chamado.categorias?.nome,
      chamado.descricao,
    ].some((campo) => campo?.toLowerCase().includes(termo));
  });

  // Uma troca so, com os cartoes reaproveitados: mover um elemento que ja
  // existe nao recarrega a foto dele.
  lista.replaceChildren(...filtrados.map(cartaoDoChamado));

  if (!filtrados.length) {
    // A tela inteira continua de pé (busca, filtros, cabeçalho): só a
    // lista fica vazia, e o texto diz por que está vazia agora.
    vazioEl.hidden = false;
    vazioEl.textContent = chamados.length === 0
      ? "Você ainda não abriu nenhuma solicitação."
      : "Nenhuma solicitação com esse filtro.";
    return;
  }

  vazioEl.hidden = true;
}

function atualizarResumo() {
  const abertos = chamados.filter((c) => !c.fechamento_em);
  const aguardando = abertos.filter((c) => derivarStatus(c) === STATUS.aguardando).length;

  if (!chamados.length) {
    resumoEl.textContent = "Nenhuma solicitação por aqui ainda.";
    return;
  }

  const partes = [`${abertos.length} em aberto`];

  if (aguardando > 0) partes.push(`${aguardando} esperando você`);

  resumoEl.textContent = partes.join(" · ");
}

/* ==========================================================================
   DETALHE E CONVERSA
   ========================================================================== */

function montarMensagem(comentario) {
  const minha = comentario.autor_id === usuarioId;
  const sistema = comentario.tipo === "sistema";

  const bloco = document.createElement("article");
  bloco.className = "mensagem";
  if (minha && !sistema) bloco.classList.add("mensagem--minha");
  if (sistema) bloco.classList.add("mensagem--sistema");

  const balao = document.createElement("div");
  balao.className = "mensagem__balao";

  const autor = document.createElement("span");
  autor.className = "mensagem__autor";
  autor.textContent = sistema
    ? "Mensagem automática"
    : (minha ? "Você" : (comentario.usuarios?.nome ?? "Equipe de TI"));

  balao.append(autor);

  if (comentario.tipo === "solucao") {
    balao.appendChild(montarCardDeSolucao(comentario));
  } else {
    const texto = document.createElement("p");
    texto.className = "mensagem__texto";
    texto.textContent = comentario.texto;
    balao.appendChild(texto);
  }

  const quando = document.createElement("time");
  quando.className = "mensagem__quando";
  quando.dateTime = comentario.criado_em;
  quando.textContent = formatarDataHora(comentario.criado_em);

  // A mensagem automática não é de ninguém: não leva foto.
  if (sistema) {
    bloco.append(balao, quando);
    return bloco;
  }

  // A minha foto fica à direita do balão, a da equipe à esquerda — a ordem
  // no DOM segue a leitura, o CSS só espelha o lado.
  const avatar = montarAvatar(comentario.usuarios);

  if (minha) bloco.append(balao, avatar, quando);
  else bloco.append(avatar, balao, quando);

  return bloco;
}

//CARD DE SOLUCAO NO CHAT: mesma logica do Portal (chamado-comum não é
//compartilhado entre as duas telas, então duplicado aqui).
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

function desenharConversa() {
  const mensagens = [...(aberto.comentarios ?? [])]
    .filter((c) => c.visibilidade === "publico")
    .sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));

  conversaEl.replaceChildren();

  if (!mensagens.length) {
    const vazia = document.createElement("p");
    vazia.className = "conversa__vazia";
    vazia.textContent = "Ainda não há mensagens neste chamado.";
    conversaEl.appendChild(vazia);
    return;
  }

  mensagens.forEach((c) => conversaEl.appendChild(montarMensagem(c)));
  conversaEl.scrollTop = conversaEl.scrollHeight;
}

function abrirDetalhe(chamado) {
  aberto = chamado;

  const status = derivarStatus(chamado);

  detalheNumero.textContent = `Ticket-${chamado.numero}`;
  detalheTitulo.textContent = tituloDoChamado(chamado);
  detalheMeta.textContent =
    `${status.rotulo} · Aberto em ${formatarData(chamado.abertura_em)}`;

  campoResposta.value = "";
  avisoResposta.textContent = "";
  avisoResposta.classList.remove("responder__aviso--erro");

  // Chamado fechado não recebe resposta: o campo sai e uma linha explica.
  const fechado = Boolean(chamado.fechamento_em);
  formResponder.hidden = fechado;
  avisoFechado.hidden = !fechado;

  desenharConversa();
  janela.showModal();
}

function fecharDetalhe() {
  janela.close();
  aberto = null;
}

/* ==========================================================================
   RESPONDER
   ========================================================================== */

formResponder.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  const texto = campoResposta.value.trim();

  if (!texto || !aberto) return;

  const botao = formResponder.querySelector(".responder__enviar");

  botao.disabled = true;
  avisoResposta.textContent = "";
  avisoResposta.classList.remove("responder__aviso--erro");

  // visibilidade 'publico' e tipo 'humano' são exigidos pela policy do
  // solicitante — e é o que faz o status virar "Em andamento" na hora.
  const { data, error } = await supabase
    .from("comentarios")
    .insert({
      chamado_id: aberto.id,
      autor_id: usuarioId,
      texto,
      visibilidade: "publico",
      tipo: "humano",
    })
    .select(`id, autor_id, texto, visibilidade, tipo, criado_em,
             usuarios(nome, sobrenome, foto_path)`)
    .single();

  botao.disabled = false;

  if (error) {
    avisoResposta.textContent = "Não foi possível enviar. Tente de novo.";
    avisoResposta.classList.add("responder__aviso--erro");
    return;
  }

  aberto.comentarios.push(data);
  campoResposta.value = "";
  avisoResposta.textContent = "Resposta enviada";

  desenharConversa();
  // O status do cartão muda junto: a bola passou para a equipe.
  desenharLista();
  atualizarResumo();
});

/* ==========================================================================
   REABRIR
   ========================================================================== */

//REABRIR: chama a mesma RPC reabrir_chamado(p_chamado_id) que a equipe usa
//em Tickets finalizados — ela confere permissão (dono do chamado ou equipe
//TI), devolve para o Inbox, zera o fechamento e grava a mensagem
//automática. O tempo real (ligarTempoReal) já reflete essas mudanças no
//banco sozinho, mas atualiza local aqui também: sem isso a pessoa teria que
//esperar o evento chegar para ver o próprio clique surtir efeito.
botaoReabrir.addEventListener("click", async () => {
  if (!aberto) return;

  botaoReabrir.disabled = true;
  avisoReabrir.textContent = "";

  const { error } = await supabase.rpc("reabrir_chamado", { p_chamado_id: aberto.id });

  botaoReabrir.disabled = false;

  if (error) {
    avisoReabrir.textContent = "Não foi possível reabrir. Tente de novo.";
    return;
  }

  aberto.fechamento_em = null;
  formResponder.hidden = false;
  avisoFechado.hidden = true;

  desenharLista();
  atualizarResumo();
});

/* ==========================================================================
   LIGAÇÕES
   ========================================================================== */

document.querySelector("[data-detalhe-fechar]").addEventListener("click", fecharDetalhe);

janela.addEventListener("click", (evento) => {
  if (evento.target === janela) fecharDetalhe();
});

janela.addEventListener("close", () => { aberto = null; });

campoBusca.addEventListener("input", desenharLista);

botoesFiltro.forEach((botao) => {
  botao.addEventListener("click", () => {
    filtroAtivo = botao.dataset.filtro;

    botoesFiltro.forEach((outro) => {
      outro.classList.toggle("filtro--ativo", outro === botao);
    });

    desenharLista();
  });
});

//A home manda para ca com ?chamado=<numero> ao clicar numa linha de "Suas
//ultimas solicitacoes": abre esse chamado direto, como se a pessoa tivesse
//clicado nele aqui na lista. A URL e limpa depois, senao recarregar a
//pagina abriria a janela de novo sozinha.
function abrirChamadoDaUrl() {
  const numero = new URLSearchParams(window.location.search).get("chamado");

  if (!numero) return;

  window.history.replaceState(null, "", window.location.pathname);

  const chamado = chamados.find((atual) => String(atual.numero) === numero);

  if (chamado) abrirDetalhe(chamado);
}

async function carregar() {
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return;

  usuarioId = user.id;

  // A RLS já limita aos próprios chamados; o filtro explícito deixa a
  // intenção visível na query e evita depender só dela.
  const [{ data, error }, { data: perfil }] = await Promise.all([
    supabase
      .from("chamados")
      .select(CAMPOS_CHAMADO)
      .eq("solicitante_id", user.id)
      .order("abertura_em", { ascending: false }),
    supabase.from("usuarios").select("notificacoes_ativas").eq("id", user.id).maybeSingle(),
  ]);

  if (error) {
    resumoEl.textContent = "";
    mostrarErro("Não foi possível carregar suas solicitações. Recarregue a página.");
    return;
  }

  chamados = data ?? [];

  atualizarResumo();
  desenharLista();

  abrirChamadoDaUrl();

  ligarTempoReal();
  ligarNotificacoes(user.id, perfil?.notificacoes_ativas);
}

//TEMPO REAL: a lista e a conversa acompanham o banco sem recarregar —
//mesmo princípio do Portal (ver ligarTempoReal em portal.js), reduzido ao
//que esta tela precisa: sem quadro, fila ou drag-and-drop, um chamado
//mudando é só "busque de novo esse chamado e redesenhe".
function ligarTempoReal() {
  const pendentes = new Map(); // chamado_id -> timeout da busca agendada
  let esperaRessincronizar = null;
  let jaConectou = false;

  function guardarChamado(dados) {
    const indice = chamados.findIndex((chamado) => chamado.id === dados.id);

    if (indice === -1) chamados.unshift(dados);
    else chamados[indice] = dados;

    // O detalhe aberto segura a mesma referência que `chamados` usa nos
    // outros lugares — trocando aqui, abrirDetalhe/desenharConversa
    // continuam lendo `aberto` sem precisar saber que ele mudou.
    if (aberto?.id === dados.id) {
      aberto = dados;
      detalheMeta.textContent =
        `${derivarStatus(dados).rotulo} · Aberto em ${formatarData(dados.abertura_em)}`;

      const fechado = Boolean(dados.fechamento_em);
      formResponder.hidden = fechado;
      avisoFechado.hidden = !fechado;

      desenharConversa();
    }

    desenharLista();
    atualizarResumo();
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

    // Sem linha: o RLS deixou de mostrar (não deveria acontecer aqui, um
    // solicitante não perde acesso ao próprio chamado, mas a checagem
    // evita guardar `undefined` se algo mudar no banco).
    if (data) guardarChamado(data);
  }

  // Varios eventos do mesmo chamado em sequencia (responder gera o
  // comentario; a equipe fechando gera chamado + mensagem automatica)
  // viram uma busca so.
  function agendar(id, espera = 150) {
    clearTimeout(pendentes.get(id));
    pendentes.set(id, setTimeout(() => recarregarChamado(id), espera));
  }

  function ressincronizar() {
    clearTimeout(esperaRessincronizar);

    esperaRessincronizar = setTimeout(async () => {
      const { data, error } = await supabase
        .from("chamados")
        .select(CAMPOS_CHAMADO)
        .eq("solicitante_id", usuarioId)
        .order("abertura_em", { ascending: false });

      if (error) {
        console.warn("Tempo real: não foi possível ressincronizar", error);
        return;
      }

      chamados = data ?? [];

      if (aberto) {
        const atualizado = chamados.find((chamado) => chamado.id === aberto.id);
        if (atualizado) guardarChamado(atualizado);
      }

      desenharLista();
      atualizarResumo();
    }, 300);
  }

  //DE QUAL CHAMADO E O EVENTO. Em DELETE viria a linha antiga; aqui só
  //escuta INSERT/UPDATE, que é o que muda para o solicitante.
  function chamadoDoEvento(tabela, payload) {
    const linha = payload.new;

    if (!linha) return null;
    if (tabela === "chamados") return linha.id ?? null;
    if (linha.chamado_id) return linha.chamado_id;

    return null;
  }

  // Filtra no próprio canal: só os eventos de chamados deste solicitante
  // chegam (e comentários, sem coluna solicitante_id, filtram no handler).
  const canal = supabase.channel(`solicitacoes-${usuarioId}`);

  canal.on(
    "postgres_changes",
    { event: "*", schema: "public", table: "chamados", filter: `solicitante_id=eq.${usuarioId}` },
    (payload) => {
      const id = chamadoDoEvento("chamados", payload);
      if (id) agendar(id);
    },
  );

  canal.on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "comentarios" },
    (payload) => {
      const id = chamadoDoEvento("comentarios", payload);
      // Comentário de um chamado que não é meu: ignora sem buscar nada.
      if (id && chamados.some((chamado) => chamado.id === id)) agendar(id);
    },
  );

  canal.subscribe((status, erroCanal) => {
    if (status === "SUBSCRIBED") {
      // Na primeira vez a carga acabou de acontecer. Numa reconexão
      // (rede caiu, aba dormiu), o que mudou nesse meio tempo não chegou.
      if (jaConectou) ressincronizar();
      jaConectou = true;
      return;
    }

    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      console.warn("Tempo real desconectado; o Supabase tenta reconectar sozinho.", status, erroCanal);
    }
  });

  // Aba que volta a ficar visível: o navegador pode ter pausado a conexão
  // enquanto ela estava escondida.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && jaConectou) ressincronizar();
  });
}

carregar();
