// Solicitações: os chamados de quem está logado, com a conversa.
//
// O status é derivado do mesmo jeito que no Portal e na home — quem falou
// por último —, mas com o vocabulário do solicitante:
//   Portal "Aberto"             -> aqui "Aberto"
//   Portal "Usuário respondeu"  -> aqui "Em andamento" (a bola é da equipe)
//   Portal "Aguardando retorno" -> aqui "Aguardando você"
//   Portal "Fechado"            -> aqui "Fechado"

import { supabase } from "../config/supabase-config.js";

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
  comentarios(id, autor_id, texto, visibilidade, tipo, criado_em,
              usuarios(nome, sobrenome, foto_path))
`;

function mostrarErro(texto) {
  erroEl.textContent = texto;
  erroEl.classList.add("solicitacoes__erro--visivel");
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
  const letras = iniciais(pessoa?.nome, pessoa?.sobrenome);

  const avatar = document.createElement("span");
  avatar.className = "mensagem__avatar";
  avatar.textContent = letras;
  // No balão vai só o primeiro nome; o completo fica no title, ao passar o mouse.
  avatar.title = nomeCompleto(pessoa) ?? "Alguém";

  if (!pessoa?.foto_path) return avatar;

  const { data } = supabase.storage.from("avatares").getPublicUrl(pessoa.foto_path);

  const foto = document.createElement("img");
  foto.src = data.publicUrl;
  foto.alt = "";
  foto.loading = "lazy";
  //Se o arquivo sumiu, a imagem sai e as iniciais voltam. Repor o texto e
  //necessario: o 'load' limpa o textContent para a foto nao ficar por cima
  //das letras, entao sem isso o circulo ficaria vazio numa falha tardia.
  foto.addEventListener("error", () => { foto.remove(); avatar.textContent = letras; });
  foto.addEventListener("load", () => { avatar.textContent = ""; avatar.appendChild(foto); });

  avatar.appendChild(foto);

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

function montarCartao(chamado) {
  const status = derivarStatus(chamado);

  const item = document.createElement("li");

  const cartao = document.createElement("button");
  cartao.type = "button";
  cartao.className = `chamado chamado--${status.chave}`;

  const barra = document.createElement("span");
  barra.className = "chamado__barra";
  barra.setAttribute("aria-hidden", "true");

  const conteudo = document.createElement("span");
  conteudo.className = "chamado__conteudo";

  const assunto = document.createElement("span");
  assunto.className = "chamado__assunto";
  assunto.textContent = tituloDoChamado(chamado);

  const meta = document.createElement("span");
  meta.className = "chamado__meta";

  const numero = document.createElement("span");
  numero.className = "chamado__numero";
  numero.textContent = `#${chamado.numero}`;

  const resto = document.createTextNode(
    ` · ${chamado.categorias?.nome ?? "Sem categoria"} · Aberto em ${formatarData(chamado.abertura_em)}`,
  );

  meta.append(numero, resto);
  conteudo.append(assunto, meta);

  const lado = document.createElement("span");
  lado.className = "chamado__lado";

  // "Aguardando você" é a única linha que pede ação — e a única que ganha
  // um segundo sinal além da cor, para não depender só dela.
  if (status === STATUS.aguardando) {
    const aviso = document.createElement("span");
    aviso.className = "chamado__aviso";
    aviso.textContent = "Responda";
    lado.appendChild(aviso);
  }

  const selo = document.createElement("span");
  selo.className = "chamado__status";
  selo.textContent = status.rotulo;
  lado.appendChild(selo);

  cartao.append(barra, conteudo, lado);
  cartao.addEventListener("click", () => abrirDetalhe(chamado));

  item.appendChild(cartao);

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

  lista.replaceChildren();

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
  filtrados.forEach((chamado) => lista.appendChild(montarCartao(chamado)));
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

  const texto = document.createElement("p");
  texto.className = "mensagem__texto";
  texto.textContent = comentario.texto;

  balao.append(autor, texto);

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

async function carregar() {
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return;

  usuarioId = user.id;

  // A RLS já limita aos próprios chamados; o filtro explícito deixa a
  // intenção visível na query e evita depender só dela.
  const { data, error } = await supabase
    .from("chamados")
    .select(CAMPOS_CHAMADO)
    .eq("solicitante_id", user.id)
    .order("abertura_em", { ascending: false });

  if (error) {
    resumoEl.textContent = "";
    mostrarErro("Não foi possível carregar suas solicitações. Recarregue a página.");
    return;
  }

  chamados = data ?? [];

  atualizarResumo();
  desenharLista();

  ligarTempoReal();
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
