// Painel: a tela de configuração do Portal de Chamados. Só admin entra
// (painel-guard.js barra na porta; as policies de escrita do banco pedem
// equipe de TI).
//
// Três abas, todas nesta mesma página — trocar de aba não recarrega nada,
// só mostra outra <section>. O ?aba= fica na URL para poder recarregar ou
// voltar na aba em que se estava.
//
// O detalhe do chamado NÃO é reimplementado aqui: importa o ligarDetalhe do
// portal.js, o mesmo componente que o quadro usa. O portal.js só monta o
// kanban quando a página tem [data-quadro] — esta não tem, então ele entra
// como biblioteca.

import { supabase } from "../config/supabase-config.js";
import { ligarDetalhe, confirmarNoSite } from "./portal.js";
import {
  derivarStatus,
  nomeCompleto,
  iniciais,
  tituloDoChamado,
  formatarData,
  CAMPOS_CHAMADO,
} from "../componentes/chamado-comum.js";

const erro = document.querySelector("[data-erro]");

//Quem esta mexendo: o banco grava em criado_por ao criar um texto rapido.
//Preenchido no arranque, antes de qualquer aba ser montada.
let usuarioAtual = null;

function mostrarErro(mensagem) {
  erro.textContent = mensagem;
  erro.hidden = false;
}

//MENU LATERAL: RECOLHER/EXPANDIR. Chave propria (painelSidebarColapsada),
//separada da Base de Solucoes de proposito — recolher aqui nao deve mexer
//la, e vice-versa (perguntado ao usuario antes de escrever isto). O <head>
//ja aplicou o estado salvo antes da 1a pintura; aqui so liga o clique.
function ligarColapsarSidebar() {
  const botao = document.getElementById("painel-sidebar-colapsar");

  if (!botao) return;

  function estaColapsada() {
    return document.documentElement.dataset.painelSidebar === "colapsada";
  }

  function aplicar(colapsada) {
    document.documentElement.dataset.painelSidebar = colapsada ? "colapsada" : "expandida";
    botao.setAttribute("aria-expanded", String(!colapsada));
    botao.setAttribute("aria-label", colapsada ? "Expandir menu" : "Recolher menu");
  }

  aplicar(estaColapsada());

  botao.addEventListener("click", () => {
    const novoEstado = !estaColapsada();

    localStorage.setItem("painelSidebarColapsada", String(novoEstado));
    aplicar(novoEstado);
  });
}

ligarColapsarSidebar();

//NAVEGACAO ENTRE ABAS
const ABA_PADRAO = "tickets";

function ligarAbas() {
  const itens = [...document.querySelectorAll("[data-aba]")];
  const secoes = [...document.querySelectorAll("[data-painel-aba]")];

  function mostrar(aba) {
    const alvo = itens.some((item) => item.dataset.aba === aba) ? aba : ABA_PADRAO;

    itens.forEach((item) => {
      const atual = item.dataset.aba === alvo;
      item.classList.toggle("painel-nav__item--atual", atual);
      item.setAttribute("aria-current", atual ? "page" : "false");
    });

    secoes.forEach((secao) => {
      secao.hidden = secao.dataset.painelAba !== alvo;
    });

    // replaceState, nao pushState: trocar de aba nao enche o botao Voltar.
    const url = new URL(window.location.href);
    url.searchParams.set("aba", alvo);
    window.history.replaceState({}, "", url);
  }

  itens.forEach((item) => {
    item.addEventListener("click", () => mostrar(item.dataset.aba));
  });

  mostrar(new URL(window.location.href).searchParams.get("aba") ?? ABA_PADRAO);
}

//AVATAR DA TABELA: foto de perfil com as iniciais atras, igual ao resto do
//site. Recebe o <span> pronto para nao criar um estilo novo por tela.
function pintarAvatar(elemento, pessoa) {
  const letras = iniciais(pessoa?.nome, pessoa?.sobrenome);
  elemento.textContent = letras;
  elemento.title = nomeCompleto(pessoa) ?? "Alguém";

  if (!pessoa?.foto_path) return;

  const { data } = supabase.storage.from("avatares").getPublicUrl(pessoa.foto_path);
  const foto = document.createElement("img");
  foto.src = data.publicUrl;
  foto.alt = "";
  foto.loading = "lazy";
  // Se o arquivo sumiu, as iniciais voltam — nunca deixar o circulo vazio.
  foto.addEventListener("error", () => {
    foto.remove();
    elemento.textContent = letras;
  });
  foto.addEventListener("load", () => {
    elemento.textContent = "";
    elemento.appendChild(foto);
  });

  elemento.appendChild(foto);
}

/* ==========================================================================
   ABA 1: TODOS OS TICKETS
   ========================================================================== */

function ligarTickets(chamados, filas, equipe, detalhe) {
  const corpo = document.querySelector("[data-tickets-corpo]");
  const campoBusca = document.querySelector("[data-tickets-busca]");
  const resumo = document.querySelector("[data-tickets-resumo]");
  const vazio = document.querySelector("[data-tickets-vazio]");
  const nomeDaFila = new Map(filas.map((fila) => [fila.id, fila.nome]));

  let termo = "";

  //FILTROS: cada grupo guarda uma lista de valores marcados. Vazio == nao
  //filtra por esse grupo (mesma regra do filtro do quadro no Portal). Entre
  //grupos vale E (status E lista E...); dentro do grupo vale OU.
  const filtros = {
    status: [], // "aberto" | "aguardando" | "respondeu" | "fechado"
    lista: [], // fila_id
    prioridade: [], // "urgente" | "prioridade" | "normal"
    solicitante: [], // usuario id
    atendente: [], // usuario id (chamado_membros) ou SEM_ATENDENTE
    de: "", // "aaaa-mm-dd"
    ate: "",
  };

  const SEM_ATENDENTE = "__sem-atendente";

  const ROTULOS_STATUS = {
    aberto: "Aberto", aguardando: "Aguardando retorno",
    respondeu: "Usuário respondeu", fechado: "Fechado",
  };
  const ROTULOS_PRIORIDADE = { urgente: "Urgente", prioridade: "Prioridade", normal: "Normal" };

  //A PRIORIDADE DO CHAMADO PODE SER DUAS COISAS AO MESMO TEMPO (urgente E
  //prioridade); para o filtro, cada marcacao conta como uma chave propria.
  function chavesDePrioridade(chamado) {
    const chaves = [];
    if (chamado.eh_urgente) chaves.push("urgente");
    if (chamado.eh_prioridade) chaves.push("prioridade");
    if (!chaves.length) chaves.push("normal");
    return chaves;
  }

  function passaNoGrupo(valores, testar) {
    return !valores.length || testar();
  }

  function chamadoPassa(chamado) {
    const status = derivarStatus(chamado).chave;
    const prioridades = chavesDePrioridade(chamado);
    const idsAtendentes = chamado.chamado_membros.map((membro) => membro.usuario_id);

    return passaNoGrupo(filtros.status, () => filtros.status.includes(status))
      && passaNoGrupo(filtros.lista, () => filtros.lista.includes(chamado.fila_id))
      && passaNoGrupo(filtros.prioridade, () => prioridades.some((chave) => filtros.prioridade.includes(chave)))
      && passaNoGrupo(filtros.solicitante, () => filtros.solicitante.includes(chamado.solicitante_id))
      && passaNoGrupo(filtros.atendente, () => (
        idsAtendentes.some((id) => filtros.atendente.includes(id))
        || (filtros.atendente.includes(SEM_ATENDENTE) && !idsAtendentes.length)
      ))
      && dentroDoPeriodo(chamado);
  }

  //PERIODO: sem data preenchida, nao filtra por essa ponta. As duas juntas
  //formam um intervalo fechado (o "ate" inclui o dia inteiro).
  function dentroDoPeriodo(chamado) {
    const abertura = new Date(chamado.abertura_em);

    if (filtros.de) {
      const [ano, mes, dia] = filtros.de.split("-").map(Number);
      if (abertura < new Date(ano, mes - 1, dia, 0, 0, 0, 0)) return false;
    }

    if (filtros.ate) {
      const [ano, mes, dia] = filtros.ate.split("-").map(Number);
      if (abertura > new Date(ano, mes - 1, dia, 23, 59, 59, 999)) return false;
    }

    return true;
  }

  //A BUSCA OLHA O QUE A PESSOA VE NA TELA: numero, titulo, quem abriu,
  //unidade, categoria e o texto da descricao.
  function combina(chamado) {
    if (!termo) return true;

    const alvo = [
      chamado.numero,
      tituloDoChamado(chamado),
      nomeCompleto(chamado.usuarios),
      chamado.usuarios?.email,
      chamado.unidades?.nome,
      chamado.categorias?.nome,
      chamado.descricao,
    ].filter(Boolean).join(" ").toLowerCase();

    return alvo.includes(termo);
  }

  function visiveis() {
    return chamados.filter((chamado) => chamadoPassa(chamado) && combina(chamado));
  }

  //PAGINACAO: 15 por pagina, igual ao Hipporello de referencia. A pagina
  //volta para 1 sempre que busca ou filtro mudam a lista (senao a pessoa
  //pode ficar numa pagina 4 que so tem 2 chamados depois de filtrar).
  const TICKETS_POR_PAGINA = 15;
  let paginaAtual = 1;

  function totalDeFiltros() {
    return filtros.status.length + filtros.lista.length + filtros.prioridade.length
      + filtros.solicitante.length + filtros.atendente.length
      + (filtros.de ? 1 : 0) + (filtros.ate ? 1 : 0);
  }

  function montarLinha(chamado) {
    const status = derivarStatus(chamado);
    const linha = document.createElement("tr");
    linha.dataset.chamado = chamado.id;
    linha.tabIndex = 0;

    const ticket = document.createElement("td");
    const numero = document.createElement("span");
    numero.className = "painel-tabela__numero";
    numero.textContent = `#${chamado.numero}`;
    const titulo = document.createElement("span");
    titulo.className = "painel-tabela__titulo";
    titulo.textContent = tituloDoChamado(chamado);
    titulo.title = tituloDoChamado(chamado);
    ticket.append(numero, titulo);

    const celulaStatus = document.createElement("td");
    const selo = document.createElement("span");
    selo.className = `painel-selo painel-selo--${status.chave}`;
    selo.textContent = status.rotulo;
    celulaStatus.appendChild(selo);

    const solicitante = document.createElement("td");
    const pessoa = document.createElement("span");
    pessoa.className = "painel-pessoa";
    const avatar = document.createElement("span");
    avatar.className = "painel-pessoa__avatar";
    pintarAvatar(avatar, chamado.usuarios);
    const nome = document.createElement("span");
    nome.textContent = nomeCompleto(chamado.usuarios) ?? "—";
    pessoa.append(avatar, nome);
    solicitante.appendChild(pessoa);

    const unidade = document.createElement("td");
    unidade.textContent = chamado.unidades?.nome ?? "—";

    const categoria = document.createElement("td");
    categoria.textContent = chamado.categorias?.nome ?? "—";

    const fila = document.createElement("td");
    fila.textContent = nomeDaFila.get(chamado.fila_id) ?? "—";

    const aberto = document.createElement("td");
    aberto.className = "painel-tabela__numero";
    aberto.textContent = formatarData(chamado.abertura_em);

    linha.append(ticket, celulaStatus, solicitante, unidade, categoria, fila, aberto);

    return linha;
  }

  function desenhar() {
    const lista = visiveis();
    const totalPaginas = Math.max(1, Math.ceil(lista.length / TICKETS_POR_PAGINA));

    // A lista encolheu (filtro/exportar removeu chamado da tela) e a pagina
    // atual ficou fora do intervalo: volta para a ultima que ainda existe.
    if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;

    const inicio = (paginaAtual - 1) * TICKETS_POR_PAGINA;
    const daPagina = lista.slice(inicio, inicio + TICKETS_POR_PAGINA);

    corpo.replaceChildren();
    daPagina.forEach((chamado) => corpo.appendChild(montarLinha(chamado)));

    vazio.hidden = lista.length > 0;
    desenharPaginacao(lista.length, totalPaginas);
    atualizarResumo();
  }

  //VAI PARA A PAGINA 1: chamado sempre que busca ou filtro mudam o
  //resultado — ficar numa pagina que pode nao existir mais e pior do que
  //sempre reiniciar.
  function irParaPrimeiraPagina() {
    paginaAtual = 1;
  }

  /* ------------------------------------------------------------------
     PAGINACAO: "‹ 1 2 3 4 5 … 500 ›", igual a referencia do Hipporello.
     Sempre mostra a primeira, a ultima, a atual e uma vizinha de cada
     lado; o resto vira reticencias — senao 500 paginas virariam 500
     botoes.
     ------------------------------------------------------------------ */

  const painelPaginacao = document.querySelector("[data-tickets-paginacao]");
  const numerosPaginacao = document.querySelector("[data-pagina-numeros]");
  const botaoPaginaAnterior = document.querySelector("[data-pagina-anterior]");
  const botaoPaginaProxima = document.querySelector("[data-pagina-proxima]");

  function paginasAMostrar(atual, total) {
    const paginas = new Set([1, total, atual, atual - 1, atual + 1]);

    return [...paginas].filter((pagina) => pagina >= 1 && pagina <= total).sort((a, b) => a - b);
  }

  function irParaPagina(pagina) {
    paginaAtual = pagina;
    desenhar();
    // A tabela pode ter ficado alta (15 linhas); volta o olhar para o topo
    // dela ao trocar de pagina, senao a pessoa continua olhando o rodape.
    document.querySelector("[data-painel-aba=\"tickets\"]")
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function desenharPaginacao(totalChamados, totalPaginas) {
    painelPaginacao.hidden = totalPaginas <= 1;

    if (totalPaginas <= 1) return;

    numerosPaginacao.replaceChildren();

    const mostrar = paginasAMostrar(paginaAtual, totalPaginas);

    mostrar.forEach((pagina, indice) => {
      // Buraco na sequencia (ex.: 1, [pulo], 8, 9, 10): poe as reticencias.
      if (indice > 0 && pagina - mostrar[indice - 1] > 1) {
        const reticencias = document.createElement("span");
        reticencias.className = "painel-paginacao__reticencias";
        reticencias.textContent = "…";
        reticencias.setAttribute("aria-hidden", "true");
        numerosPaginacao.appendChild(reticencias);
      }

      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "painel-paginacao__pagina";
      botao.classList.toggle("painel-paginacao__pagina--atual", pagina === paginaAtual);
      botao.textContent = String(pagina);
      botao.setAttribute("aria-current", pagina === paginaAtual ? "page" : "false");
      botao.setAttribute("aria-label", `Página ${pagina}`);

      if (pagina !== paginaAtual) botao.addEventListener("click", () => irParaPagina(pagina));

      numerosPaginacao.appendChild(botao);
    });

    botaoPaginaAnterior.disabled = paginaAtual <= 1;
    botaoPaginaProxima.disabled = paginaAtual >= totalPaginas;
  }

  botaoPaginaAnterior.addEventListener("click", () => {
    if (paginaAtual > 1) irParaPagina(paginaAtual - 1);
  });

  botaoPaginaProxima.addEventListener("click", () => {
    const totalPaginas = Math.max(1, Math.ceil(visiveis().length / TICKETS_POR_PAGINA));
    if (paginaAtual < totalPaginas) irParaPagina(paginaAtual + 1);
  });

  function atualizarResumo() {
    const abertos = chamados.filter((chamado) => !chamado.fechamento_em).length;
    const mostrando = visiveis().length;
    const total = chamados.length;

    resumo.textContent = mostrando === total
      ? `${total} chamados no total · ${abertos} abertos`
      : `Mostrando ${mostrando} de ${total} · ${abertos} abertos`;
  }

  //REDESENHA SO UMA LINHA: o detalhe avisa quando muda algo do chamado
  //aberto. Trocar a linha inteira e mais simples (e igualmente rapido) do
  //que descobrir qual celula mudou.
  //
  //Mas so vale enquanto o que mudou nao afeta se o chamado deveria
  //continuar visivel (fila, prioridade e status entram em filtro) — com
  //algum filtro ligado, troca de linha pode deixar na tela um chamado que
  //acabou de sair do filtro (ou esconder um que acabou de entrar). Nesse
  //caso e mais seguro refazer a tabela inteira: sao no maximo centenas de
  //linhas, o custo e desprezivel perto do risco de mostrar dado errado.
  function atualizarLinha(chamado) {
    if (totalDeFiltros() || termo) {
      desenhar();
      return;
    }

    const atual = corpo.querySelector(`tr[data-chamado="${chamado.id}"]`);

    if (!atual) return;

    const nova = montarLinha(chamado);
    atual.replaceWith(nova);
    atualizarResumo();
  }

  /* ========================================================================
     PAINEL DE FILTRO: status, lista, prioridade, solicitante, atendente,
     periodo. Botao de icone (igual ao "Filtrar" do quadro no Portal) que
     abre um dropdown; fecha ao clicar fora ou Esc, igual aos outros
     dropdowns desta tela.
     ======================================================================== */

  function ligarFiltroDeTickets() {
    const caixa = document.querySelector("[data-tickets-filtro-caixa]");
    const botao = document.querySelector("[data-tickets-filtro-abrir]");
    const painel = document.querySelector("[data-tickets-filtro-painel]");
    const grupos = document.querySelector("[data-tickets-filtro-grupos]");
    const contador = document.querySelector("[data-tickets-filtro-contador]");
    const limpar = document.querySelector("[data-tickets-filtro-limpar]");

    //Quem pode aparecer em "Solicitante": todo mundo que ja abriu um
    //chamado, nao so quem tem perfil solicitante (um admin tambem abre).
    const solicitantes = [...new Map(
      chamados.map((chamado) => [chamado.solicitante_id, chamado.usuarios]).filter(([, pessoa]) => pessoa),
    ).entries()].map(([id, pessoa]) => ({ id, nome: nomeCompleto(pessoa) ?? "Alguém" }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

    const atendentesOpcoes = [
      ...equipe.map((pessoa) => ({ id: pessoa.id, nome: nomeCompleto(pessoa) ?? "Alguém" })),
      { id: SEM_ATENDENTE, nome: "Sem atendente" },
    ];

    function atualizarBotao() {
      const total = totalDeFiltros();
      botao.classList.toggle("painel-icone-botao--ativo", total > 0);
      contador.hidden = !total;
      contador.textContent = String(total);
      limpar.disabled = !total;
    }

    //GRUPO DE CHIPS: status, lista, prioridade — poucas opcoes, cabe como
    //botoezinhos (igual aos filtros de status que ja existiam na tela).
    function grupoChips({ titulo, opcoes, chave }) {
      const secao = document.createElement("div");
      secao.className = "painel-filtro-grupo";

      const rotulo = document.createElement("p");
      rotulo.className = "painel-filtro-grupo__titulo";
      rotulo.textContent = titulo;

      const lista = document.createElement("div");
      lista.className = "painel-filtro-grupo__opcoes";

      opcoes.forEach(({ valor, rotulo: rotuloOpcao }) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "painel-filtro-chip";
        chip.classList.toggle("painel-filtro-chip--marcado", filtros[chave].includes(valor));
        chip.textContent = rotuloOpcao;

        chip.addEventListener("click", () => {
          filtros[chave] = filtros[chave].includes(valor)
            ? filtros[chave].filter((atual) => atual !== valor)
            : [...filtros[chave], valor];

          chip.classList.toggle("painel-filtro-chip--marcado", filtros[chave].includes(valor));
          atualizarBotao();
          irParaPrimeiraPagina();
          desenhar();
        });

        lista.appendChild(chip);
      });

      secao.append(rotulo, lista);
      return secao;
    }

    //GRUPO DE PESSOAS: solicitante, atendente — pode ter muita gente, entao
    //ganha campo de busca e caixinhas de marcar, igual ao dropdown de
    //unidade que o Portal ja usa nos filtros do quadro.
    function grupoPessoas({ titulo, opcoes, chave }) {
      const secao = document.createElement("div");
      secao.className = "painel-filtro-grupo";

      const rotulo = document.createElement("p");
      rotulo.className = "painel-filtro-grupo__titulo";
      rotulo.textContent = titulo;

      const busca = document.createElement("input");
      busca.type = "search";
      busca.className = "painel-filtro-grupo__busca";
      busca.placeholder = `Buscar ${titulo.toLowerCase()}…`;
      busca.setAttribute("aria-label", `Buscar em ${titulo}`);
      busca.hidden = opcoes.length <= 6;

      const lista = document.createElement("div");
      lista.className = "painel-filtro-grupo__lista";

      const vazioBusca = document.createElement("p");
      vazioBusca.className = "painel-filtro-grupo__vazio";
      vazioBusca.textContent = "Ninguém encontrado.";
      vazioBusca.hidden = true;

      if (!opcoes.length) {
        const semOpcoes = document.createElement("p");
        semOpcoes.className = "painel-filtro-grupo__vazio";
        semOpcoes.textContent = "Nada para filtrar aqui ainda.";
        secao.append(rotulo, semOpcoes);
        return secao;
      }

      opcoes.forEach(({ id, nome }) => {
        const item = document.createElement("label");
        item.className = "painel-filtro-grupo__item";
        item.dataset.nome = nome.toLowerCase();

        const caixa = document.createElement("input");
        caixa.type = "checkbox";
        caixa.checked = filtros[chave].includes(id);

        caixa.addEventListener("change", () => {
          filtros[chave] = caixa.checked
            ? [...filtros[chave], id]
            : filtros[chave].filter((atual) => atual !== id);

          atualizarBotao();
          irParaPrimeiraPagina();
          desenhar();
        });

        const nomeSpan = document.createElement("span");
        nomeSpan.textContent = nome;

        item.append(caixa, nomeSpan);
        lista.appendChild(item);
      });

      busca.addEventListener("input", () => {
        const alvo = busca.value.trim().toLowerCase();
        let algumaAparece = false;

        lista.querySelectorAll(".painel-filtro-grupo__item").forEach((item) => {
          const aparece = item.dataset.nome.includes(alvo);
          item.hidden = !aparece;
          if (aparece) algumaAparece = true;
        });

        vazioBusca.hidden = algumaAparece;
      });

      secao.append(rotulo, busca, lista, vazioBusca);
      return secao;
    }

    //GRUPO DE PERIODO: data de abertura, de-ate.
    function grupoPeriodo() {
      const secao = document.createElement("div");
      secao.className = "painel-filtro-grupo";

      const rotulo = document.createElement("p");
      rotulo.className = "painel-filtro-grupo__titulo";
      rotulo.textContent = "Data de abertura";

      const linha = document.createElement("div");
      linha.className = "painel-filtro-datas";

      [["de", "De"], ["ate", "Até"]].forEach(([chave, texto]) => {
        const campo = document.createElement("label");
        campo.className = "painel-filtro-data";

        const spanTexto = document.createElement("span");
        spanTexto.textContent = texto;

        const input = document.createElement("input");
        input.type = "date";
        input.value = filtros[chave];

        input.addEventListener("change", () => {
          filtros[chave] = input.value;
          atualizarBotao();
          irParaPrimeiraPagina();
          desenhar();
        });

        campo.append(spanTexto, input);
        linha.appendChild(campo);
      });

      secao.append(rotulo, linha);
      return secao;
    }

    function montarGrupos() {
      grupos.replaceChildren(
        grupoChips({
          titulo: "Status",
          chave: "status",
          opcoes: Object.entries(ROTULOS_STATUS).map(([valor, rotulo]) => ({ valor, rotulo })),
        }),
        grupoChips({
          titulo: "Lista",
          chave: "lista",
          opcoes: filas.map((fila) => ({ valor: fila.id, rotulo: fila.nome })),
        }),
        grupoChips({
          titulo: "Prioridade",
          chave: "prioridade",
          opcoes: Object.entries(ROTULOS_PRIORIDADE).map(([valor, rotulo]) => ({ valor, rotulo })),
        }),
        grupoPessoas({ titulo: "Solicitante", chave: "solicitante", opcoes: solicitantes }),
        grupoPessoas({ titulo: "Atendente", chave: "atendente", opcoes: atendentesOpcoes }),
        grupoPeriodo(),
      );
    }

    function mostrar(aberto) {
      painel.hidden = !aberto;
      botao.setAttribute("aria-expanded", String(aberto));
    }

    botao.addEventListener("click", () => mostrar(painel.hidden));

    limpar.addEventListener("click", () => {
      filtros.status = []; filtros.lista = []; filtros.prioridade = [];
      filtros.solicitante = []; filtros.atendente = []; filtros.de = ""; filtros.ate = "";
      montarGrupos();
      atualizarBotao();
      irParaPrimeiraPagina();
      desenhar();
    });

    //CLIQUE FORA OU ESC FECHA — mesma regra dos outros dropdowns da tela.
    document.addEventListener("click", (evento) => {
      if (!painel.hidden && !evento.target.closest("[data-tickets-filtro-caixa]")) mostrar(false);
    });
    document.addEventListener("keydown", (evento) => {
      if (evento.key === "Escape" && !painel.hidden) mostrar(false);
    });

    montarGrupos();
    atualizarBotao();
  }

  /* ========================================================================
     EXPORTAR: CSV, JSON OU EXCEL DO QUE ESTA NA TABELA AGORA (busca +
     filtros aplicados) — nao exporta tudo do banco, exporta o que a pessoa
     esta vendo, para bater com o que ela pediu.
     ======================================================================== */

  function ligarExportarTickets() {
    const caixa = document.querySelector("[data-exportar-caixa]");
    const botao = document.querySelector("[data-exportar-abrir]");
    const painel = document.querySelector("[data-exportar-painel]");

    // "14/09/2026 10:30" — igual ao export do Portal.
    function dataHoraPlanilha(iso) {
      if (!iso) return "";
      return new Date(iso)
        .toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
        .replace(",", "");
    }

    //AS COLUNAS: mesma ideia do export do Portal, mas com o Status derivado
    //(o Portal nao mostra coluna de status porque a lista do Trello ja diz
    //isso; aqui a lista sozinha nao entrega o mesmo recado).
    const COLUNAS = [
      ["Ticket", (c) => `#${c.numero}`],
      ["Título", (c) => tituloDoChamado(c)],
      ["Status", (c) => ROTULOS_STATUS[derivarStatus(c).chave]],
      ["Lista", (c) => nomeDaFila.get(c.fila_id) ?? ""],
      ["Solicitante", (c) => nomeCompleto(c.usuarios) ?? ""],
      ["E-mail", (c) => c.usuarios?.email ?? ""],
      ["Unidade", (c) => c.unidades?.nome ?? ""],
      ["Categoria", (c) => c.categorias?.nome ?? ""],
      ["Prioridade", (c) => chavesDePrioridade(c).map((chave) => ROTULOS_PRIORIDADE[chave]).join(", ")],
      ["Atendentes", (c) => c.chamado_membros.map((m) => nomeCompleto(m.usuarios)).filter(Boolean).join(", ")],
      ["Descrição", (c) => c.descricao ?? ""],
      ["Aberto em", (c) => dataHoraPlanilha(c.abertura_em)],
      ["Fechado em", (c) => dataHoraPlanilha(c.fechamento_em)],
    ];

    //MESMA REGRA DE ESCAPE DO EXPORT DO PORTAL: texto comecando com
    //= + - @ ganha apostrofo (evita virar formula no Excel); texto com
    //separador, aspas ou quebra de linha vai entre aspas.
    function celula(valor) {
      let texto = String(valor ?? "");
      if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
      return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
    }

    function nomeDoArquivo(extensao) {
      const agora = new Date().toISOString().slice(0, 10);
      return `chamados-${agora}.${extensao}`;
    }

    function baixarArquivo(conteudo, tipo, extensao) {
      const arquivo = new Blob([conteudo], { type: tipo });
      const url = URL.createObjectURL(arquivo);
      const link = document.createElement("a");
      link.href = url;
      link.download = nomeDoArquivo(extensao);
      link.click();
      URL.revokeObjectURL(url);
    }

    function exportarCsv(lista) {
      // ﻿ (BOM) + ; como separador: mesma escolha do export do Portal,
      // para o Excel em portugues abrir direto em colunas e com acento certo.
      const linhas = [
        COLUNAS.map(([titulo]) => celula(titulo)).join(";"),
        ...lista.map((chamado) => COLUNAS.map(([, valorDe]) => celula(valorDe(chamado))).join(";")),
      ];
      baixarArquivo(`﻿${linhas.join("\r\n")}`, "text/csv;charset=utf-8", "csv");
    }

    //EXCEL: HTML de tabela com extensao .xls — o Excel abre e formata como
    //planilha de verdade (cabecalho, colunas), sem precisar de biblioteca.
    function exportarExcel(lista) {
      const escapar = (texto) => String(texto ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      const cabecalho = COLUNAS.map(([titulo]) => `<th>${escapar(titulo)}</th>`).join("");
      const linhas = lista.map((chamado) => `<tr>${
        COLUNAS.map(([, valorDe]) => `<td>${escapar(valorDe(chamado))}</td>`).join("")
      }</tr>`).join("");

      const html = `<html><head><meta charset="UTF-8"></head><body>`
        + `<table border="1"><thead><tr>${cabecalho}</tr></thead><tbody>${linhas}</tbody></table>`
        + `</body></html>`;

      baixarArquivo(html, "application/vnd.ms-excel;charset=utf-8", "xls");
    }

    function exportarJson(lista) {
      const dados = lista.map((chamado) => Object.fromEntries(
        COLUNAS.map(([titulo, valorDe]) => [titulo, valorDe(chamado)]),
      ));
      baixarArquivo(JSON.stringify(dados, null, 2), "application/json;charset=utf-8", "json");
    }

    const EXPORTADORES = { csv: exportarCsv, excel: exportarExcel, json: exportarJson };

    function mostrar(aberto) {
      painel.hidden = !aberto;
      botao.setAttribute("aria-expanded", String(aberto));
    }

    botao.addEventListener("click", () => mostrar(painel.hidden));

    document.querySelectorAll("[data-exportar-formato]").forEach((item) => {
      item.addEventListener("click", () => {
        const lista = visiveis();

        if (!lista.length) return;

        EXPORTADORES[item.dataset.exportarFormato]?.(lista);
        mostrar(false);
      });
    });

    document.addEventListener("click", (evento) => {
      if (!painel.hidden && !evento.target.closest("[data-exportar-caixa]")) mostrar(false);
    });
    document.addEventListener("keydown", (evento) => {
      if (evento.key === "Escape" && !painel.hidden) mostrar(false);
    });
  }

  campoBusca.addEventListener("input", () => {
    termo = campoBusca.value.trim().toLowerCase();
    irParaPrimeiraPagina();
    desenhar();
  });

  ligarFiltroDeTickets();
  ligarExportarTickets();

  corpo.addEventListener("click", (evento) => {
    const linha = evento.target.closest("tr[data-chamado]");

    if (!linha) return;

    const chamado = chamados.find((outro) => outro.id === linha.dataset.chamado);

    if (chamado) detalhe.abrir(chamado);
  });

  //TECLADO: Enter ou espaco na linha focada abre o chamado.
  corpo.addEventListener("keydown", (evento) => {
    if (evento.key !== "Enter" && evento.key !== " ") return;

    const linha = evento.target.closest("tr[data-chamado]");

    if (!linha) return;

    evento.preventDefault();

    const chamado = chamados.find((outro) => outro.id === linha.dataset.chamado);

    if (chamado) detalhe.abrir(chamado);
  });

  desenhar();

  return { desenhar, atualizarLinha, atualizarResumo };
}

/* ==========================================================================
   ABA 2: CONTATOS
   ========================================================================== */

const TAMANHO_MAXIMO_FOTO = 2 * 1024 * 1024;

//O DIALOG DE PESSOA E UM SO NA PAGINA (data-pessoa), COMPARTILHADO ENTRE
//CONTATOS E ADMINISTRADORES: as duas abas mostram gente da mesma tabela
//usuarios, só que Administradores já chega com a lista pré-filtrada em
//quem atende chamado. Por isso ligarPessoaDialog liga os listeners do
//dialog (abrir/criar/salvar/foto) UMA unica vez — ligar duas vezes
//duplicaria cada envio de formulário — e devolve funções que cada lista
//(ligarListaDePessoas) chama para abrir o dialog na pessoa certa.
function ligarPessoaDialog(setores, unidades) {
  const janela = document.querySelector("[data-pessoa]");
  const formulario = document.querySelector("[data-pessoa-form]");
  const avatarJanela = document.querySelector("[data-pessoa-avatar]");
  const nomeJanela = document.querySelector("[data-pessoa-nome]");
  const emailJanela = document.querySelector("[data-pessoa-email]");
  const aviso = document.querySelector("[data-pessoa-aviso]");
  const botaoSalvar = document.querySelector("[data-pessoa-salvar]");
  const dicaEmail = document.querySelector("[data-pessoa-dica-email]");
  const campoSenhaCaixa = document.querySelector("[data-pessoa-campo-senha]");

  //FOTO: caixa com os dois botoes (trocar/remover) + o input de arquivo
  //escondido atras do botao "Trocar foto", igual ao "Dados pessoais".
  const fotoAcoes = document.querySelector("[data-pessoa-foto-acoes]");
  const fotoBotaoTrocar = document.querySelector("[data-pessoa-foto-trocar]");
  const fotoBotaoRemover = document.querySelector("[data-pessoa-foto-remover]");
  const fotoArquivo = document.querySelector("[data-pessoa-foto-arquivo]");

  let editando = null;
  // A lista que abriu o dialog registra aqui como quer ser avisada quando
  // algo e salvo — assim o dialog nao precisa saber se veio de Contatos ou
  // de Administradores, so devolve o resultado pra quem chamou.
  let aoSalvar = () => {};

  //As listas de setor e unidade sao as mesmas do banco: se o admin criar um
  //setor na aba Setores, aparecem aqui ao recarregar.
  function preencherSelecao(seletor, itens, vazioRotulo) {
    const campo = formulario.querySelector(`[data-pessoa-campo="${seletor}"]`);
    campo.replaceChildren();

    const nenhum = document.createElement("option");
    nenhum.value = "";
    nenhum.textContent = vazioRotulo;
    campo.appendChild(nenhum);

    itens.forEach((item) => {
      const opcao = document.createElement("option");
      opcao.value = item.id;
      opcao.textContent = item.nome;
      campo.appendChild(opcao);
    });
  }

  preencherSelecao("setor_id", setores, "Sem setor");
  preencherSelecao("unidade_id", unidades, "Sem unidade");

  function avisar(texto, ehErro = false) {
    aviso.textContent = texto;
    aviso.classList.toggle("pessoa__aviso--erro", ehErro);

    if (!ehErro && texto) setTimeout(() => { aviso.textContent = ""; }, 2500);
  }

  //MODO CRIACAO OU EDICAO: campos que so existem num dos dois (senha,
  //botoes de foto) aparecem/somem daqui. editando null == criando.
  function aplicarModo() {
    const criando = !editando;

    campoSenhaCaixa.hidden = !criando;
    formulario.querySelector('[data-pessoa-campo="senha"]').required = criando;

    // Sem id ainda nao ha onde subir a foto (o nome do arquivo e o id da
    // pessoa) — a foto de quem esta sendo criado entra depois, editando.
    fotoAcoes.hidden = criando;

    dicaEmail.textContent = criando
      ? "É o e-mail de login da pessoa — confira antes de salvar."
      : "Muda só o cadastro interno — o e-mail de login continua o mesmo.";

    botaoSalvar.textContent = criando ? "Criar conta" : "Salvar";
  }

  //abrir/criarNovo recebem `quandoSalvar`: a lista que chamou passa a
  //propria funcao de "atualiza minha tabela com este resultado".
  function abrir(pessoa, quandoSalvar) {
    editando = pessoa;
    aoSalvar = quandoSalvar;
    aplicarModo();

    pintarAvatar(avatarJanela, pessoa);
    nomeJanela.textContent = nomeCompleto(pessoa) ?? "Sem nome";
    emailJanela.textContent = pessoa.email ?? "";
    fotoBotaoRemover.hidden = !pessoa.foto_path;
    avisar("");

    formulario.querySelector('[data-pessoa-campo="nome"]').value = pessoa.nome ?? "";
    formulario.querySelector('[data-pessoa-campo="sobrenome"]').value = pessoa.sobrenome ?? "";
    formulario.querySelector('[data-pessoa-campo="email"]').value = pessoa.email ?? "";
    formulario.querySelector('[data-pessoa-campo="setor_id"]').value = pessoa.setor_id ?? "";
    formulario.querySelector('[data-pessoa-campo="unidade_id"]').value = pessoa.unidade_id ?? "";
    formulario.querySelector('[data-pessoa-campo="perfil"]').value = pessoa.perfil ?? "solicitante";
    formulario.querySelector('[data-pessoa-campo="status_aprovacao"]').value =
      pessoa.status_aprovacao ?? "pendente";
    formulario.querySelector('[data-pessoa-campo="ativo"]').checked = Boolean(pessoa.ativo);

    janela.showModal();
  }

  //CRIAR: mesmo dialog, comecando vazio. Perfil solicitante e cadastro
  //pendente como padrao — sao os valores mais comuns, o admin troca se for
  //criar direto um analista/admin, por exemplo.
  function criarNovo(quandoSalvar) {
    editando = null;
    aoSalvar = quandoSalvar;
    aplicarModo();

    avatarJanela.textContent = "";
    avatarJanela.replaceChildren();
    nomeJanela.textContent = "Nova pessoa";
    emailJanela.textContent = "";
    avisar("");

    formulario.reset();
    formulario.querySelector('[data-pessoa-campo="perfil"]').value = "solicitante";
    formulario.querySelector('[data-pessoa-campo="status_aprovacao"]').value = "pendente";
    formulario.querySelector('[data-pessoa-campo="ativo"]').checked = true;

    janela.showModal();
    formulario.querySelector('[data-pessoa-campo="nome"]').focus();
  }

  async function salvarEdicao() {
    const mudancas = {
      nome: formulario.querySelector('[data-pessoa-campo="nome"]').value.trim(),
      sobrenome: formulario.querySelector('[data-pessoa-campo="sobrenome"]').value.trim() || null,
      email: formulario.querySelector('[data-pessoa-campo="email"]').value.trim(),
      setor_id: formulario.querySelector('[data-pessoa-campo="setor_id"]').value || null,
      unidade_id: formulario.querySelector('[data-pessoa-campo="unidade_id"]').value || null,
      perfil: formulario.querySelector('[data-pessoa-campo="perfil"]').value,
      status_aprovacao: formulario.querySelector('[data-pessoa-campo="status_aprovacao"]').value,
      ativo: formulario.querySelector('[data-pessoa-campo="ativo"]').checked,
    };

    if (!mudancas.nome || !mudancas.email) {
      avisar("Nome e e-mail são obrigatórios.", true);
      return;
    }

    botaoSalvar.disabled = true;

    // O .select devolve a linha gravada: sem ele, um update barrado pela RLS
    // volta sem erro e sem gravar, e a tela mostraria um dado que nao existe.
    const { data: gravada, error } = await supabase
      .from("usuarios")
      .update(mudancas)
      .eq("id", editando.id)
      .select("id, nome, sobrenome, email, setor_id, unidade_id, perfil, ativo, status_aprovacao, foto_path")
      .single();

    botaoSalvar.disabled = false;

    if (error || !gravada) {
      console.error("Erro ao salvar pessoa:", error);
      avisar("Não foi possível salvar. Tente de novo.", true);
      return;
    }

    Object.assign(editando, gravada);
    aoSalvar(editando, false);
    avisar("Salvo");
    janela.close();
  }

  //CRIAR CONTA: chama a Edge Function (unico jeito de gravar senha sem
  //derrubar a sessao do admin — ver comentario em cima do index.ts da
  //function). O client supabase ja manda o token de quem esta logado no
  //cabecalho Authorization sozinho, via functions.invoke.
  async function salvarCriacao() {
    const corpo = {
      nome: formulario.querySelector('[data-pessoa-campo="nome"]').value.trim(),
      sobrenome: formulario.querySelector('[data-pessoa-campo="sobrenome"]').value.trim() || null,
      email: formulario.querySelector('[data-pessoa-campo="email"]').value.trim(),
      senha: formulario.querySelector('[data-pessoa-campo="senha"]').value,
      setor_id: formulario.querySelector('[data-pessoa-campo="setor_id"]').value || null,
      unidade_id: formulario.querySelector('[data-pessoa-campo="unidade_id"]').value || null,
      perfil: formulario.querySelector('[data-pessoa-campo="perfil"]').value,
      status_aprovacao: formulario.querySelector('[data-pessoa-campo="status_aprovacao"]').value,
      ativo: formulario.querySelector('[data-pessoa-campo="ativo"]').checked,
    };

    if (!corpo.nome || !corpo.email) {
      avisar("Nome e e-mail são obrigatórios.", true);
      return;
    }

    if (corpo.senha.length < 6) {
      avisar("A senha precisa ter pelo menos 6 caracteres.", true);
      return;
    }

    botaoSalvar.disabled = true;
    avisar("Criando conta…");

    const { data, error } = await supabase.functions.invoke("criar-usuario", { body: corpo });

    botaoSalvar.disabled = false;

    // O supabase-js so preenche `error` para falha de rede/HTTP — uma
    // resposta 4xx da function chega aqui como `error` tambem, mas sem o
    // corpo JSON; por isso a mensagem soa generica quando o servidor negou.
    if (error || !data?.usuario) {
      console.error("Erro ao criar pessoa:", error, data);
      avisar(data?.erro ?? "Não foi possível criar a conta. Tente de novo.", true);
      return;
    }

    aoSalvar(data.usuario, true);
    avisar("Conta criada");
    janela.close();
  }

  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();

    if (editando) await salvarEdicao();
    else await salvarCriacao();
  });

  /* ------------------------------------------------------------------
     FOTO: trocar ou remover, so editando alguem que ja existe. Mesmo
     padrao de "Dados pessoais" (perfil.js): nome do arquivo == id da
     pessoa, e por isso a policy do bucket permite o admin gravar/apagar.
     ------------------------------------------------------------------ */

  fotoBotaoTrocar.addEventListener("click", () => fotoArquivo.click());

  fotoArquivo.addEventListener("change", async () => {
    const arquivo = fotoArquivo.files[0];

    if (!arquivo || !editando) return;

    if (arquivo.size > TAMANHO_MAXIMO_FOTO) {
      avisar("A foto precisa ter até 2 MB.", true);
      fotoArquivo.value = "";
      return;
    }

    fotoBotaoTrocar.disabled = true;
    avisar("Enviando foto…");

    const extensao = arquivo.name.split(".").pop().toLowerCase();
    const caminho = `${editando.id}.${extensao}`;

    const { error: erroUpload } = await supabase.storage
      .from("avatares")
      .upload(caminho, arquivo, { upsert: true });

    if (erroUpload) {
      console.error("Erro ao enviar foto:", erroUpload);
      avisar("Não foi possível enviar a foto.", true);
      fotoBotaoTrocar.disabled = false;
      fotoArquivo.value = "";
      return;
    }

    const { data: gravada, error: erroSalvar } = await supabase
      .from("usuarios")
      .update({ foto_path: caminho })
      .eq("id", editando.id)
      .select("foto_path")
      .single();

    fotoBotaoTrocar.disabled = false;
    fotoArquivo.value = "";

    if (erroSalvar || !gravada) {
      console.error("Erro ao salvar foto no cadastro:", erroSalvar);
      avisar("A foto subiu, mas não foi possível salvá-la no cadastro.", true);
      return;
    }

    editando.foto_path = gravada.foto_path;
    pintarAvatar(avatarJanela, editando);
    fotoBotaoRemover.hidden = false;
    aoSalvar(editando, false);
    avisar("Foto atualizada");
  });

  fotoBotaoRemover.addEventListener("click", async () => {
    if (!editando?.foto_path) return;

    fotoBotaoRemover.disabled = true;
    avisar("Removendo foto…");

    const { error: erroArquivo } = await supabase.storage
      .from("avatares")
      .remove([editando.foto_path]);

    if (erroArquivo) {
      console.error("Erro ao remover foto:", erroArquivo);
      avisar("Não foi possível remover a foto.", true);
      fotoBotaoRemover.disabled = false;
      return;
    }

    const { data: gravada, error } = await supabase
      .from("usuarios")
      .update({ foto_path: null })
      .eq("id", editando.id)
      .select("foto_path")
      .single();

    fotoBotaoRemover.disabled = false;

    // gravada aqui e {foto_path: null} no sucesso — objeto, nao null — por
    // isso a checagem e so em `error`, igual as outras gravacoes da tela.
    if (error) {
      console.error("Erro ao limpar foto do cadastro:", error);
      avisar("Não foi possível remover a foto.", true);
      return;
    }

    editando.foto_path = null;
    pintarAvatar(avatarJanela, editando);
    fotoBotaoRemover.hidden = true;
    aoSalvar(editando, false);
    avisar("Foto removida");
  });

  document.querySelector("[data-pessoa-fechar]").addEventListener("click", () => janela.close());
  document.querySelector("[data-pessoa-cancelar]").addEventListener("click", () => janela.close());

  janela.addEventListener("click", (evento) => {
    if (evento.target === janela) janela.close();
  });

  return { abrir, criarNovo };
}

/* ==========================================================================
   ABA 2b: LISTA DE PESSOAS (Contatos e Administradores)
   As duas usam a mesma tabela/editor — so muda de onde vem a lista
   (todo mundo x so quem atende chamado) e os seletores data-* do prefixo.
   ========================================================================== */

function ligarListaDePessoas({ prefixo, pessoas, setores, unidades, dialog, rotuloResumo }) {
  const corpo = document.querySelector(`[data-${prefixo}-corpo]`);
  const campoBusca = document.querySelector(`[data-${prefixo}-busca]`);
  const resumo = document.querySelector(`[data-${prefixo}-resumo]`);
  const vazio = document.querySelector(`[data-${prefixo}-vazio]`);
  const botaoNovo = document.querySelector(`[data-${prefixo}-novo]`);

  const nomeDoSetor = new Map(setores.map((setor) => [setor.id, setor.nome]));
  const nomeDaUnidade = new Map(unidades.map((unidade) => [unidade.id, unidade.nome]));

  const ROTULO_PERFIL = {
    solicitante: "Solicitante",
    parceiro: "Parceiro",
    analista: "Analista",
    admin: "Admin",
  };

  let termo = "";

  //FILTROS: unidade, setor, perfil, situacao — cada grupo guarda uma lista
  //de valores marcados (vazio == nao filtra por esse grupo), mesma regra
  //do filtro de tickets. Dentro do grupo vale OU, entre grupos vale E.
  const filtros = { unidade: [], setor: [], perfil: [], situacao: [] };

  const ROTULOS_SITUACAO = { inativo: "Inativo", aprovado: "Aprovado", rejeitado: "Rejeitado", pendente: "Pendente" };

  //SITUACAO E DERIVADA, NAO E UMA COLUNA SO: junta ativo + status_aprovacao
  //na mesma regra que decide o selo da tabela — repetida aqui de proposito
  //(inativo vence status_aprovacao) para o filtro bater com o que a pessoa ve.
  function situacaoDe(pessoa) {
    if (!pessoa.ativo) return "inativo";
    if (pessoa.status_aprovacao === "aprovado") return "aprovado";
    if (pessoa.status_aprovacao === "rejeitado") return "rejeitado";
    return "pendente";
  }

  function totalDeFiltros() {
    return filtros.unidade.length + filtros.setor.length + filtros.perfil.length + filtros.situacao.length;
  }

  function passaNoGrupo(valores, testar) {
    return !valores.length || testar();
  }

  function combina(pessoa) {
    if (termo) {
      const alvo = [
        nomeCompleto(pessoa),
        pessoa.email,
        nomeDoSetor.get(pessoa.setor_id),
        nomeDaUnidade.get(pessoa.unidade_id),
        ROTULO_PERFIL[pessoa.perfil],
      ].filter(Boolean).join(" ").toLowerCase();

      if (!alvo.includes(termo)) return false;
    }

    return passaNoGrupo(filtros.unidade, () => filtros.unidade.includes(pessoa.unidade_id))
      && passaNoGrupo(filtros.setor, () => filtros.setor.includes(pessoa.setor_id))
      && passaNoGrupo(filtros.perfil, () => filtros.perfil.includes(pessoa.perfil))
      && passaNoGrupo(filtros.situacao, () => filtros.situacao.includes(situacaoDe(pessoa)));
  }

  function montarLinha(pessoa) {
    const linha = document.createElement("tr");
    linha.dataset.pessoa = pessoa.id;
    linha.tabIndex = 0;

    const identidade = document.createElement("td");
    const caixa = document.createElement("span");
    caixa.className = "painel-pessoa";
    const avatar = document.createElement("span");
    avatar.className = "painel-pessoa__avatar";
    pintarAvatar(avatar, pessoa);
    const nome = document.createElement("span");
    nome.textContent = nomeCompleto(pessoa) ?? "—";
    caixa.append(avatar, nome);
    identidade.appendChild(caixa);

    const email = document.createElement("td");
    email.textContent = pessoa.email ?? "—";

    const setor = document.createElement("td");
    setor.textContent = nomeDoSetor.get(pessoa.setor_id) ?? "—";

    const unidade = document.createElement("td");
    unidade.textContent = nomeDaUnidade.get(pessoa.unidade_id) ?? "—";

    const perfil = document.createElement("td");
    perfil.textContent = ROTULO_PERFIL[pessoa.perfil] ?? pessoa.perfil ?? "—";

    //SITUACAO: conta desligada vem primeiro, porque manda mais que o
    //status do cadastro — quem esta inativo nao entra de jeito nenhum.
    const situacao = document.createElement("td");
    const selo = document.createElement("span");

    if (!pessoa.ativo) {
      selo.className = "painel-selo painel-selo--fechado";
      selo.textContent = "Inativo";
    } else if (pessoa.status_aprovacao === "aprovado") {
      selo.className = "painel-selo painel-selo--aguardando";
      selo.textContent = "Aprovado";
    } else if (pessoa.status_aprovacao === "rejeitado") {
      selo.className = "painel-selo painel-selo--fechado";
      selo.textContent = "Rejeitado";
    } else {
      selo.className = "painel-selo painel-selo--respondeu";
      selo.textContent = "Pendente";
    }

    situacao.appendChild(selo);

    linha.append(identidade, email, setor, unidade, perfil, situacao);

    return linha;
  }

  function desenhar() {
    const lista = pessoas.filter(combina);

    corpo.replaceChildren();
    lista.forEach((pessoa) => corpo.appendChild(montarLinha(pessoa)));

    vazio.hidden = lista.length > 0;
    resumo.textContent = rotuloResumo(pessoas, lista);
  }

  //O QUE ACONTECE QUANDO O DIALOG SALVA ALGUEM DESTA LISTA: se foi criacao,
  //a pessoa pode nem pertencer aqui ainda (ex.: criada como solicitante,
  //nao aparece em Administradores) — so entra na lista local se bater no
  //filtro que esta aba usa.
  function aoDialogSalvar(pessoa, ehCriacao) {
    if (ehCriacao) {
      if (!pessoas.some((outra) => outra.id === pessoa.id)) pessoas.push(pessoa);
    }

    desenhar();
  }

  /* ========================================================================
     FILTRAR: unidade, setor, perfil, situacao. Mesmo padrao visual e de
     interacao do filtro de tickets (botao de icone + dropdown que fecha ao
     clicar fora), so os grupos aqui sao todos chip (poucas opcoes cada).
     ======================================================================== */

  function ligarFiltroDePessoas() {
    const botao = document.querySelector(`[data-${prefixo}-filtro-abrir]`);
    const painel = document.querySelector(`[data-${prefixo}-filtro-painel]`);
    const grupos = document.querySelector(`[data-${prefixo}-filtro-grupos]`);
    const contador = document.querySelector(`[data-${prefixo}-filtro-contador]`);
    const limpar = document.querySelector(`[data-${prefixo}-filtro-limpar]`);

    function atualizarBotao() {
      const total = totalDeFiltros();
      botao.classList.toggle("painel-icone-botao--ativo", total > 0);
      contador.hidden = !total;
      contador.textContent = String(total);
      limpar.disabled = !total;
    }

    function grupoChips({ titulo, opcoes, chave }) {
      const secao = document.createElement("div");
      secao.className = "painel-filtro-grupo";

      const rotulo = document.createElement("p");
      rotulo.className = "painel-filtro-grupo__titulo";
      rotulo.textContent = titulo;

      const lista = document.createElement("div");
      lista.className = "painel-filtro-grupo__opcoes";

      if (!opcoes.length) {
        const vazio = document.createElement("p");
        vazio.className = "painel-filtro-grupo__vazio";
        vazio.textContent = "Nada para filtrar aqui ainda.";
        secao.append(rotulo, vazio);
        return secao;
      }

      opcoes.forEach(({ valor, rotulo: rotuloOpcao }) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "painel-filtro-chip";
        chip.classList.toggle("painel-filtro-chip--marcado", filtros[chave].includes(valor));
        chip.textContent = rotuloOpcao;

        chip.addEventListener("click", () => {
          filtros[chave] = filtros[chave].includes(valor)
            ? filtros[chave].filter((atual) => atual !== valor)
            : [...filtros[chave], valor];

          chip.classList.toggle("painel-filtro-chip--marcado", filtros[chave].includes(valor));
          atualizarBotao();
          desenhar();
        });

        lista.appendChild(chip);
      });

      secao.append(rotulo, lista);
      return secao;
    }

    function montarGrupos() {
      const unidadesEmUso = [...nomeDaUnidade.entries()]
        .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
      const setoresEmUso = [...nomeDoSetor.entries()]
        .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));

      grupos.replaceChildren(
        grupoChips({
          titulo: "Unidade",
          chave: "unidade",
          opcoes: unidadesEmUso.map(([valor, rotulo]) => ({ valor, rotulo })),
        }),
        grupoChips({
          titulo: "Setor",
          chave: "setor",
          opcoes: setoresEmUso.map(([valor, rotulo]) => ({ valor, rotulo })),
        }),
        grupoChips({
          titulo: "Perfil",
          chave: "perfil",
          opcoes: Object.entries(ROTULO_PERFIL).map(([valor, rotulo]) => ({ valor, rotulo })),
        }),
        grupoChips({
          titulo: "Situação",
          chave: "situacao",
          opcoes: Object.entries(ROTULOS_SITUACAO).map(([valor, rotulo]) => ({ valor, rotulo })),
        }),
      );
    }

    function mostrar(aberto) {
      painel.hidden = !aberto;
      botao.setAttribute("aria-expanded", String(aberto));
    }

    botao.addEventListener("click", () => mostrar(painel.hidden));

    limpar.addEventListener("click", () => {
      filtros.unidade = []; filtros.setor = []; filtros.perfil = []; filtros.situacao = [];
      montarGrupos();
      atualizarBotao();
      desenhar();
    });

    document.addEventListener("click", (evento) => {
      if (!painel.hidden && !evento.target.closest(`[data-${prefixo}-filtro-caixa]`)) mostrar(false);
    });
    document.addEventListener("keydown", (evento) => {
      if (evento.key === "Escape" && !painel.hidden) mostrar(false);
    });

    montarGrupos();
    atualizarBotao();
  }

  /* ========================================================================
     EXPORTAR: CSV, JSON OU EXCEL DE QUEM ESTA NA TABELA AGORA (busca +
     filtros aplicados) — mesmo padrao do export de tickets.
     ======================================================================== */

  function ligarExportarPessoas() {
    const botao = document.querySelector(`[data-${prefixo}-exportar-abrir]`);
    const painel = document.querySelector(`[data-${prefixo}-exportar-painel]`);

    function dataHoraPlanilha(iso) {
      if (!iso) return "";
      return new Date(iso)
        .toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
        .replace(",", "");
    }

    const COLUNAS = [
      ["Nome", (p) => nomeCompleto(p) ?? ""],
      ["E-mail", (p) => p.email ?? ""],
      ["Setor", (p) => nomeDoSetor.get(p.setor_id) ?? ""],
      ["Unidade", (p) => nomeDaUnidade.get(p.unidade_id) ?? ""],
      ["Perfil", (p) => ROTULO_PERFIL[p.perfil] ?? p.perfil ?? ""],
      ["Situação", (p) => ROTULOS_SITUACAO[situacaoDe(p)]],
      ["Cadastro em", (p) => dataHoraPlanilha(p.created_at)],
    ];

    //MESMA REGRA DE ESCAPE DO EXPORT DE TICKETS: apostrofo na frente de
    //celula comecando com =+-@ (evita virar formula no Excel); aspas em
    //volta de texto com separador, aspas ou quebra de linha.
    function celula(valor) {
      let texto = String(valor ?? "");
      if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
      return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
    }

    function nomeDoArquivo(extensao) {
      const agora = new Date().toISOString().slice(0, 10);
      return `${prefixo}-${agora}.${extensao}`;
    }

    function baixarArquivo(conteudo, tipo, extensao) {
      const arquivo = new Blob([conteudo], { type: tipo });
      const url = URL.createObjectURL(arquivo);
      const link = document.createElement("a");
      link.href = url;
      link.download = nomeDoArquivo(extensao);
      link.click();
      URL.revokeObjectURL(url);
    }

    function exportarCsv(lista) {
      const linhas = [
        COLUNAS.map(([titulo]) => celula(titulo)).join(";"),
        ...lista.map((pessoa) => COLUNAS.map(([, valorDe]) => celula(valorDe(pessoa))).join(";")),
      ];
      baixarArquivo(`﻿${linhas.join("\r\n")}`, "text/csv;charset=utf-8", "csv");
    }

    function exportarExcel(lista) {
      const escapar = (texto) => String(texto ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      const cabecalho = COLUNAS.map(([titulo]) => `<th>${escapar(titulo)}</th>`).join("");
      const linhas = lista.map((pessoa) => `<tr>${
        COLUNAS.map(([, valorDe]) => `<td>${escapar(valorDe(pessoa))}</td>`).join("")
      }</tr>`).join("");

      const html = `<html><head><meta charset="UTF-8"></head><body>`
        + `<table border="1"><thead><tr>${cabecalho}</tr></thead><tbody>${linhas}</tbody></table>`
        + `</body></html>`;

      baixarArquivo(html, "application/vnd.ms-excel;charset=utf-8", "xls");
    }

    function exportarJson(lista) {
      const dados = lista.map((pessoa) => Object.fromEntries(
        COLUNAS.map(([titulo, valorDe]) => [titulo, valorDe(pessoa)]),
      ));
      baixarArquivo(JSON.stringify(dados, null, 2), "application/json;charset=utf-8", "json");
    }

    const EXPORTADORES = { csv: exportarCsv, excel: exportarExcel, json: exportarJson };

    function mostrar(aberto) {
      painel.hidden = !aberto;
      botao.setAttribute("aria-expanded", String(aberto));
    }

    botao.addEventListener("click", () => mostrar(painel.hidden));

    document.querySelectorAll(`[data-${prefixo}-exportar-formato]`).forEach((item) => {
      item.addEventListener("click", () => {
        const lista = pessoas.filter(combina);

        if (!lista.length) return;

        // getAttribute direto, nao dataset: com "administradores" o
        // camelCase automatico do dataset (administradoresExportarFormato)
        // fica fragil de montar por string — o atributo cru e mais simples.
        const formato = item.getAttribute(`data-${prefixo}-exportar-formato`);
        EXPORTADORES[formato]?.(lista);
        mostrar(false);
      });
    });

    document.addEventListener("click", (evento) => {
      if (!painel.hidden && !evento.target.closest(`[data-${prefixo}-exportar-caixa]`)) mostrar(false);
    });
    document.addEventListener("keydown", (evento) => {
      if (evento.key === "Escape" && !painel.hidden) mostrar(false);
    });
  }

  botaoNovo.addEventListener("click", () => dialog.criarNovo(aoDialogSalvar));

  campoBusca.addEventListener("input", () => {
    termo = campoBusca.value.trim().toLowerCase();
    desenhar();
  });

  ligarFiltroDePessoas();
  ligarExportarPessoas();

  corpo.addEventListener("click", (evento) => {
    const linha = evento.target.closest("tr[data-pessoa]");

    if (!linha) return;

    const pessoa = pessoas.find((outra) => outra.id === linha.dataset.pessoa);

    if (pessoa) dialog.abrir(pessoa, aoDialogSalvar);
  });

  corpo.addEventListener("keydown", (evento) => {
    if (evento.key !== "Enter" && evento.key !== " ") return;

    const linha = evento.target.closest("tr[data-pessoa]");

    if (!linha) return;

    evento.preventDefault();

    const pessoa = pessoas.find((outra) => outra.id === linha.dataset.pessoa);

    if (pessoa) dialog.abrir(pessoa, aoDialogSalvar);
  });

  desenhar();
}

/* ==========================================================================
   ABAS DE CONFIGURACAO: UNIDADES, SETORES, CATEGORIAS, TEXTOS RAPIDOS
   Cada uma virou uma aba propria (antes eram 5 cartoes espremidos numa
   unica aba "Configurações") — mesma estrutura de Contatos: busca, botão
   Novo, tabela, clicar na linha edita, ícone de lixeira remove.
   ========================================================================== */

//REMOVER E DESATIVAR, NAO APAGAR: um chamado antigo aponta para a
//categoria/unidade dele. Apagar de verdade quebraria a chave estrangeira
//(ou deixaria o historico sem nome) — mesma regra em toda tabela de apoio.
async function desativarItem(tabela, id) {
  return supabase.from(tabela).update({ ativo: false }).eq("id", id).select("id").single();
}

/* ==========================================================================
   ABA: LISTAS. So-leitura + reativar — criar e arquivar acontece no quadro
   (o menu de 3 pontinhos de cada lista, e o "+ Adicionar outra lista").
   Mostra ativas E arquivadas: e o unico historico de onde uma lista
   arquivada volta a existir.
   ========================================================================== */

function ligarListaDeFilas(filas) {
  const corpo = document.querySelector("[data-listas-corpo]");
  const campoBusca = document.querySelector("[data-listas-busca]");
  const resumo = document.querySelector("[data-listas-resumo]");
  const vazio = document.querySelector("[data-listas-vazio]");

  let termo = "";

  function combina(fila) {
    return !termo || fila.nome.toLowerCase().includes(termo);
  }

  function montarLinha(fila) {
    const linha = document.createElement("tr");
    linha.dataset.item = fila.id;

    const nome = document.createElement("td");
    nome.textContent = fila.nome;

    const situacao = document.createElement("td");
    const selo = document.createElement("span");
    selo.className = `painel-selo painel-selo--${fila.ativo ? "aberto" : "fechado"}`;
    selo.textContent = fila.ativo ? "Ativa" : "Inativa";
    situacao.appendChild(selo);

    const acao = document.createElement("td");

    // So a arquivada ganha o botao — reativar uma que ja esta ativa nao
    // faz sentido, e nao ha lixeira aqui (arquivar e so pelo quadro).
    if (!fila.ativo) {
      const reativar = document.createElement("button");
      reativar.type = "button";
      reativar.className = "painel-tabela__reativar";
      reativar.textContent = "Reativar";

      reativar.addEventListener("click", async () => {
        reativar.disabled = true;

        const { data, error } = await supabase
          .from("filas")
          .update({ ativo: true })
          .eq("id", fila.id)
          .select("id, nome, ordem, ativo")
          .single();

        if (error || !data) {
          console.error("Erro ao reativar lista:", error);
          reativar.disabled = false;
          return;
        }

        Object.assign(fila, data);
        desenhar();
      });

      acao.appendChild(reativar);
    }

    linha.append(nome, situacao, acao);

    return linha;
  }

  function desenhar() {
    const lista = filas.filter(combina);

    corpo.replaceChildren();
    lista.forEach((fila) => corpo.appendChild(montarLinha(fila)));

    vazio.hidden = lista.length > 0;

    const ativas = filas.filter((fila) => fila.ativo).length;
    resumo.textContent = lista.length === filas.length
      ? `${filas.length} listas · ${ativas} ${ativas === 1 ? "ativa" : "ativas"}`
      : `Mostrando ${lista.length} de ${filas.length}`;
  }

  campoBusca.addEventListener("input", () => {
    termo = campoBusca.value.trim().toLowerCase();
    desenhar();
  });

  desenhar();
}

/* ------------------------------------------------------------------------
   UNIDADES, SETORES, CATEGORIAS: mesmo desenho (so um campo, "nome") —
   uma funcao generica monta as tres, so troca tabela/seletor/rotulos.
   ------------------------------------------------------------------------ */

//O DIALOG "item-simples" E UM SO NA PAGINA, COMPARTILHADO ENTRE UNIDADES,
//SETORES E CATEGORIAS (mesmo motivo do dialog de pessoa: ligar os
//listeners de submit/fechar tres vezes faria cada envio disparar tres
//gravacoes, cada uma numa tabela diferente). Liga uma vez so; cada lista
//registra o que fazer quando salvar via `abrir`/`criarNovo`.
function ligarItemSimplesDialog() {
  const janela = document.querySelector("[data-item-simples]");
  const formulario = document.querySelector("[data-item-simples-form]");
  const tituloJanela = document.querySelector("[data-item-simples-titulo]");
  const rotuloJanela = document.querySelector("[data-item-simples-rotulo]");
  const aviso = document.querySelector("[data-item-simples-aviso]");
  const botaoSalvar = document.querySelector("[data-item-simples-salvar]");
  const campoNome = formulario.querySelector('[data-item-simples-campo="nome"]');

  let editando = null;
  let contexto = null; // { tabela, rotuloSingular, aoSalvar }

  function avisar(texto, ehErro = false) {
    aviso.textContent = texto;
    aviso.classList.toggle("pessoa__aviso--erro", ehErro);

    if (!ehErro && texto) setTimeout(() => { aviso.textContent = ""; }, 2500);
  }

  function abrir(item, ctx) {
    editando = item;
    contexto = ctx;
    tituloJanela.textContent = `Editar ${ctx.rotuloSingular.toLowerCase()}`;
    rotuloJanela.textContent = "Nome";
    campoNome.value = item.nome;
    botaoSalvar.textContent = "Salvar";
    avisar("");
    janela.showModal();
  }

  function criarNovo(ctx) {
    editando = null;
    contexto = ctx;
    tituloJanela.textContent = `Nov${ctx.generoMasculino ? "o" : "a"} ${ctx.rotuloSingular.toLowerCase()}`;
    rotuloJanela.textContent = "Nome";
    formulario.reset();
    botaoSalvar.textContent = "Adicionar";
    avisar("");
    janela.showModal();
    campoNome.focus();
  }

  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();

    const nome = campoNome.value.trim();

    if (!nome) {
      avisar("Preencha o nome.", true);
      return;
    }

    botaoSalvar.disabled = true;

    if (editando) {
      const { data, error } = await supabase
        .from(contexto.tabela).update({ nome }).eq("id", editando.id).select("id, nome").single();

      botaoSalvar.disabled = false;

      if (error || !data) {
        console.error(`Erro ao renomear em ${contexto.tabela}:`, error);
        avisar("Não foi possível salvar. Tente de novo.", true);
        return;
      }

      Object.assign(editando, data);
      contexto.aoSalvar(editando, false);
      avisar("Salvo");
    } else {
      const { data, error } = await supabase
        .from(contexto.tabela).insert({ nome }).select("id, nome").single();

      botaoSalvar.disabled = false;

      if (error || !data) {
        console.error(`Erro ao adicionar em ${contexto.tabela}:`, error);
        avisar("Não foi possível adicionar. Tente de novo.", true);
        return;
      }

      contexto.aoSalvar(data, true);
      avisar("Adicionado");
    }

    janela.close();
  });

  document.querySelector("[data-item-simples-fechar]").addEventListener("click", () => janela.close());
  document.querySelector("[data-item-simples-cancelar]").addEventListener("click", () => janela.close());

  janela.addEventListener("click", (evento) => {
    if (evento.target === janela) janela.close();
  });

  return { abrir, criarNovo };
}

/* ------------------------------------------------------------------------
   UNIDADES, SETORES, CATEGORIAS: mesmo desenho (so um campo, "nome") —
   uma funcao generica monta as tres, so troca tabela/seletor/rotulos.
   ------------------------------------------------------------------------ */

function ligarListaSimples({ prefixo, tabela, itens, rotuloSingular, rotuloPlural, generoMasculino = false, dialog }) {
  const corpo = document.querySelector(`[data-${prefixo}-corpo]`);
  const campoBusca = document.querySelector(`[data-${prefixo}-busca]`);
  const resumo = document.querySelector(`[data-${prefixo}-resumo]`);
  const vazio = document.querySelector(`[data-${prefixo}-vazio]`);
  const botaoNovo = document.querySelector(`[data-${prefixo}-novo]`);

  let termo = "";

  function combina(item) {
    return !termo || item.nome.toLowerCase().includes(termo);
  }

  function montarLinha(item) {
    const linha = document.createElement("tr");
    linha.dataset.item = item.id;
    linha.tabIndex = 0;

    const nome = document.createElement("td");
    nome.textContent = item.nome;

    const acao = document.createElement("td");
    const excluir = document.createElement("button");
    excluir.type = "button";
    excluir.className = "painel-tabela__excluir";
    excluir.setAttribute("aria-label", `Remover ${item.nome}`);
    excluir.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">'
      + '<path d="M5.5 7.5h13M10 7.5V6a1.5 1.5 0 0 1 1.5-1.5h1A1.5 1.5 0 0 1 14 6v1.5'
      + 'M7 7.5 7.7 18a1.5 1.5 0 0 0 1.5 1.4h5.6a1.5 1.5 0 0 0 1.5-1.4l.7-10.5" '
      + 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

    // stopPropagation: o clique na lixeira nao pode tambem abrir o editor
    // (a linha inteira e clicavel).
    excluir.addEventListener("click", async (evento) => {
      evento.stopPropagation();

      const certeza = await confirmarNoSite({
        titulo: `Remover ${rotuloSingular.toLowerCase()}?`,
        mensagem: `"${item.nome}" para de aparecer nas listas do Portal. `
          + "Os chamados antigos que já usam continuam como estão.",
        confirmar: "Remover",
        perigo: true,
      });

      if (!certeza) return;

      const { data, error } = await desativarItem(tabela, item.id);

      if (error || !data) {
        console.error(`Erro ao remover de ${tabela}:`, error);
        return;
      }

      const indice = itens.findIndex((outro) => outro.id === item.id);
      if (indice !== -1) itens.splice(indice, 1);

      desenhar();
    });

    acao.appendChild(excluir);
    linha.append(nome, acao);

    return linha;
  }

  function desenhar() {
    const lista = itens.filter(combina);

    corpo.replaceChildren();
    lista.forEach((item) => corpo.appendChild(montarLinha(item)));

    vazio.hidden = lista.length > 0;
    resumo.textContent = lista.length === itens.length
      ? `${itens.length} ${itens.length === 1 ? rotuloSingular.toLowerCase() : rotuloPlural.toLowerCase()}`
      : `Mostrando ${lista.length} de ${itens.length}`;
  }

  function aoDialogSalvar(item, ehCriacao) {
    if (ehCriacao) itens.push(item);
    desenhar();
  }

  const ctx = { tabela, rotuloSingular, generoMasculino, aoSalvar: aoDialogSalvar };

  botaoNovo.addEventListener("click", () => dialog.criarNovo(ctx));

  campoBusca.addEventListener("input", () => {
    termo = campoBusca.value.trim().toLowerCase();
    desenhar();
  });

  corpo.addEventListener("click", (evento) => {
    const linha = evento.target.closest("tr[data-item]");

    if (!linha) return;

    const item = itens.find((outro) => outro.id === linha.dataset.item);

    if (item) dialog.abrir(item, ctx);
  });

  corpo.addEventListener("keydown", (evento) => {
    if (evento.key !== "Enter" && evento.key !== " ") return;

    const linha = evento.target.closest("tr[data-item]");

    if (!linha) return;

    evento.preventDefault();

    const item = itens.find((outro) => outro.id === linha.dataset.item);

    if (item) dialog.abrir(item, ctx);
  });

  desenhar();
}

/* ------------------------------------------------------------------------
   TEXTOS RAPIDOS: mesma estrutura, mas com um campo a mais (o corpo da
   resposta) — por isso nao reaproveita ligarListaSimples.
   ------------------------------------------------------------------------ */

function ligarListaTextos(textos) {
  const corpo = document.querySelector("[data-textos-corpo]");
  const campoBusca = document.querySelector("[data-textos-busca]");
  const resumo = document.querySelector("[data-textos-resumo]");
  const vazio = document.querySelector("[data-textos-vazio]");
  const botaoNovo = document.querySelector("[data-textos-novo]");

  const janela = document.querySelector("[data-item-texto]");
  const formulario = document.querySelector("[data-item-texto-form]");
  const tituloJanela = document.querySelector("[data-item-texto-titulo]");
  const aviso = document.querySelector("[data-item-texto-aviso]");
  const campoTitulo = formulario.querySelector('[data-item-texto-campo="titulo"]');
  const campoCorpo = formulario.querySelector('[data-item-texto-campo="corpo"]');
  const botaoSalvar = formulario.querySelector('[type="submit"]');

  let termo = "";
  let editando = null;

  function combina(texto) {
    if (!termo) return true;

    return [texto.titulo, texto.corpo].filter(Boolean).join(" ").toLowerCase().includes(termo);
  }

  function montarLinha(texto) {
    const linha = document.createElement("tr");
    linha.dataset.item = texto.id;
    linha.tabIndex = 0;

    const titulo = document.createElement("td");
    titulo.textContent = texto.titulo;

    const previa = document.createElement("td");
    const spanPrevia = document.createElement("span");
    spanPrevia.className = "painel-tabela__previa";
    spanPrevia.textContent = texto.corpo ?? "";
    previa.appendChild(spanPrevia);

    const acao = document.createElement("td");
    const excluir = document.createElement("button");
    excluir.type = "button";
    excluir.className = "painel-tabela__excluir";
    excluir.setAttribute("aria-label", `Remover ${texto.titulo}`);
    excluir.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">'
      + '<path d="M5.5 7.5h13M10 7.5V6a1.5 1.5 0 0 1 1.5-1.5h1A1.5 1.5 0 0 1 14 6v1.5'
      + 'M7 7.5 7.7 18a1.5 1.5 0 0 0 1.5 1.4h5.6a1.5 1.5 0 0 0 1.5-1.4l.7-10.5" '
      + 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

    excluir.addEventListener("click", async (evento) => {
      evento.stopPropagation();

      const certeza = await confirmarNoSite({
        titulo: "Remover texto rápido?",
        mensagem: `"${texto.titulo}" para de aparecer na lista de respostas prontas.`,
        confirmar: "Remover",
        perigo: true,
      });

      if (!certeza) return;

      const { data, error } = await desativarItem("textos_rapidos", texto.id);

      if (error || !data) {
        console.error("Erro ao remover texto rápido:", error);
        return;
      }

      const indice = textos.findIndex((outro) => outro.id === texto.id);
      if (indice !== -1) textos.splice(indice, 1);

      desenhar();
    });

    acao.appendChild(excluir);
    linha.append(titulo, previa, acao);

    return linha;
  }

  function desenhar() {
    const lista = textos.filter(combina);

    corpo.replaceChildren();
    lista.forEach((texto) => corpo.appendChild(montarLinha(texto)));

    vazio.hidden = lista.length > 0;
    resumo.textContent = lista.length === textos.length
      ? `${textos.length} ${textos.length === 1 ? "texto" : "textos"}`
      : `Mostrando ${lista.length} de ${textos.length}`;
  }

  function avisar(texto, ehErro = false) {
    aviso.textContent = texto;
    aviso.classList.toggle("pessoa__aviso--erro", ehErro);

    if (!ehErro && texto) setTimeout(() => { aviso.textContent = ""; }, 2500);
  }

  function abrir(texto) {
    editando = texto;
    tituloJanela.textContent = "Editar texto rápido";
    campoTitulo.value = texto.titulo;
    campoCorpo.value = texto.corpo ?? "";
    botaoSalvar.textContent = "Salvar";
    avisar("");
    janela.showModal();
  }

  function criarNovo() {
    editando = null;
    tituloJanela.textContent = "Novo texto rápido";
    formulario.reset();
    botaoSalvar.textContent = "Adicionar";
    avisar("");
    janela.showModal();
    campoTitulo.focus();
  }

  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();

    const titulo = campoTitulo.value.trim();
    const corpoTexto = campoCorpo.value.trim();

    if (!titulo || !corpoTexto) {
      avisar("Preencha título e resposta.", true);
      return;
    }

    botaoSalvar.disabled = true;

    if (editando) {
      const { data, error } = await supabase
        .from("textos_rapidos")
        .update({ titulo, corpo: corpoTexto })
        .eq("id", editando.id)
        .select("id, titulo, corpo")
        .single();

      botaoSalvar.disabled = false;

      if (error || !data) {
        console.error("Erro ao salvar texto rápido:", error);
        avisar("Não foi possível salvar. Tente de novo.", true);
        return;
      }

      Object.assign(editando, data);
      avisar("Salvo");
    } else {
      const { data, error } = await supabase
        .from("textos_rapidos")
        .insert({ titulo, corpo: corpoTexto, criado_por: usuarioAtual })
        .select("id, titulo, corpo")
        .single();

      botaoSalvar.disabled = false;

      if (error || !data) {
        console.error("Erro ao criar texto rápido:", error);
        avisar("Não foi possível adicionar. Tente de novo.", true);
        return;
      }

      textos.push(data);
      avisar("Adicionado");
    }

    desenhar();
    janela.close();
  });

  document.querySelector("[data-item-texto-fechar]").addEventListener("click", () => janela.close());
  document.querySelector("[data-item-texto-cancelar]").addEventListener("click", () => janela.close());

  janela.addEventListener("click", (evento) => {
    if (evento.target === janela) janela.close();
  });

  botaoNovo.addEventListener("click", criarNovo);

  campoBusca.addEventListener("input", () => {
    termo = campoBusca.value.trim().toLowerCase();
    desenhar();
  });

  corpo.addEventListener("click", (evento) => {
    const linha = evento.target.closest("tr[data-item]");

    if (!linha) return;

    const texto = textos.find((outro) => outro.id === linha.dataset.item);

    if (texto) abrir(texto);
  });

  corpo.addEventListener("keydown", (evento) => {
    if (evento.key !== "Enter" && evento.key !== " ") return;

    const linha = evento.target.closest("tr[data-item]");

    if (!linha) return;

    evento.preventDefault();

    const texto = textos.find((outro) => outro.id === linha.dataset.item);

    if (texto) abrir(texto);
  });

  desenhar();
}



/* ==========================================================================
   ARRANQUE
   ========================================================================== */

async function montarPainel() {
  ligarAbas();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return;

  usuarioAtual = user.id;

  //SO O QUE ESTA ATIVO: as listas de apoio usam ativo=false como "removido"
  //(o Portal faz igual), entao o que foi removido nao volta a aparecer aqui —
  //EXCETO filasTodas, que e a excecao de proposito: a aba Listas precisa
  //mostrar tambem as arquivadas, pra dar pra reativar.
  const [filas, filasTodas, chamados, equipe, pessoas, setores, unidades, categorias, textos] =
    await Promise.all([
      supabase.from("filas").select("id, nome, ordem, ativo").eq("ativo", true).order("ordem"),
      supabase.from("filas").select("id, nome, ordem, ativo").order("nome"),
      supabase.from("chamados").select(CAMPOS_CHAMADO).order("abertura_em", { ascending: false }),
      // Quem pode ser posto num chamado: a equipe de TI (mesma regra do Portal).
      supabase.from("usuarios").select("id, nome, sobrenome, foto_path, cor_destaque")
        .neq("perfil", "solicitante").eq("ativo", true).order("nome"),
      supabase.from("usuarios")
        .select("id, nome, sobrenome, email, setor_id, unidade_id, perfil, ativo, status_aprovacao, foto_path, created_at")
        .order("nome"),
      supabase.from("setores").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("unidades").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("categorias").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("textos_rapidos").select("id, titulo, corpo").eq("ativo", true).order("titulo"),
    ]);

  if (filas.error || chamados.error) {
    console.error("Erro ao carregar o painel:", filas.error ?? chamados.error);
    mostrarErro("Não foi possível carregar os chamados. Recarregue a página.");
    return;
  }

  //O MESMO MODAL DO PORTAL. Sem quadro para atualizar: o que muda no chamado
  //volta para a tabela pelo aoMudarCard/aoMudarFechamento.
  let tickets = null;

  const detalhe = ligarDetalhe(
    chamados.data,
    filas.data ?? [],
    equipe.data ?? [],
    user.id,
    {
      acharCard: () => null,
      aoMudarCard: (chamado) => tickets?.atualizarLinha(chamado),
      aoMudarFechamento: () => tickets?.desenhar(),
      aoContarChamados: () => tickets?.atualizarResumo(),
    },
  );

  tickets = ligarTickets(chamados.data, filas.data ?? [], equipe.data ?? [], detalhe);

  //DIALOG DE PESSOA: UM SO, compartilhado por Contatos e Administradores
  //(ver comentario em ligarPessoaDialog).
  const dialogPessoa = ligarPessoaDialog(setores.data ?? [], unidades.data ?? []);

  ligarListaDePessoas({
    prefixo: "contatos",
    pessoas: pessoas.data ?? [],
    setores: setores.data ?? [],
    unidades: unidades.data ?? [],
    dialog: dialogPessoa,
    rotuloResumo: (todas, visiveis) => {
      const equipeTi = todas.filter((pessoa) => pessoa.perfil !== "solicitante").length;
      return visiveis.length === todas.length
        ? `${todas.length} pessoas · ${equipeTi} na equipe de TI`
        : `Mostrando ${visiveis.length} de ${todas.length} pessoas`;
    },
  });

  //ADMINISTRADORES: mesma tabela usuarios, so que ja filtrada em quem
  //atende chamado — um array PROPRIO (nao o mesmo de Contatos), entao criar
  //ou editar aqui nao reflete em Contatos ate recarregar (e vice-versa).
  const equipeDeTi = (pessoas.data ?? []).filter((pessoa) => pessoa.perfil !== "solicitante");

  ligarListaDePessoas({
    prefixo: "administradores",
    pessoas: equipeDeTi,
    setores: setores.data ?? [],
    unidades: unidades.data ?? [],
    dialog: dialogPessoa,
    rotuloResumo: (todas, visiveis) => (visiveis.length === todas.length
      ? `${todas.length} ${todas.length === 1 ? "pessoa" : "pessoas"} na equipe de TI`
      : `Mostrando ${visiveis.length} de ${todas.length}`),
  });

  ligarListaDeFilas(filasTodas.data ?? []);

  //DIALOG DE ITEM SIMPLES: UM SO, compartilhado por Unidades/Setores/
  //Categorias (ver comentario em ligarItemSimplesDialog).
  const dialogItemSimples = ligarItemSimplesDialog();

  ligarListaSimples({
    prefixo: "unidades",
    tabela: "unidades",
    itens: unidades.data ?? [],
    rotuloSingular: "Unidade",
    rotuloPlural: "Unidades",
    dialog: dialogItemSimples,
  });

  ligarListaSimples({
    prefixo: "setores",
    tabela: "setores",
    itens: setores.data ?? [],
    rotuloSingular: "Setor",
    rotuloPlural: "Setores",
    generoMasculino: true,
    dialog: dialogItemSimples,
  });

  ligarListaSimples({
    prefixo: "categorias",
    tabela: "categorias",
    itens: categorias.data ?? [],
    rotuloSingular: "Categoria",
    rotuloPlural: "Categorias",
    dialog: dialogItemSimples,
  });

  ligarListaTextos(textos.data ?? []);
}

montarPainel();
