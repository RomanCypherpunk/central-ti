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
import { pintarImagemPrivada } from "../componentes/storage-privado.js";
import { ligarDetalhe, confirmarNoSite } from "./portal.js";
import { pintarFoto } from "../componentes/avatar.js";
import {
  derivarStatus,
  primeiroNome,
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

//aoMostrar: avisa quem chamou qual aba ficou visivel — usado pela Analise
//pra so consultar o banco na primeira vez que a aba abre (o grafico e
//pesado, as outras abas carregam tudo de cara em montarPainel, mas essa
//nao teria por que rodar a consulta se a pessoa nunca clicar nela).
function ligarAbas(aoMostrar) {
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

    aoMostrar?.(alvo);
  }

  itens.forEach((item) => {
    item.addEventListener("click", () => mostrar(item.dataset.aba));
  });

  mostrar(new URL(window.location.href).searchParams.get("aba") ?? ABA_PADRAO);
}

//AVATAR DA TABELA: foto de perfil com as iniciais atras, igual ao resto do
//site. Recebe o <span> pronto para nao criar um estilo novo por tela.
//versao: depois de trocar a foto de alguem, forca a URL nova (o arquivo e
//gravado por cima do mesmo caminho e o navegador mostraria a antiga).
function pintarAvatar(elemento, pessoa, versao = null) {
  elemento.title = nomeCompleto(pessoa) ?? "Alguém";
  pintarFoto(elemento, pessoa?.foto_path, iniciais(pessoa?.nome, pessoa?.sobrenome), { versao });
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
  const botaoExcluir = document.querySelector("[data-pessoa-excluir]");
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
    botaoExcluir.hidden = criando;

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

    if (corpo.senha.length < 8 || !/[a-z]/.test(corpo.senha) || !/[A-Z]/.test(corpo.senha)
      || !/[0-9]/.test(corpo.senha) || !/[^A-Za-z0-9]/.test(corpo.senha)) {
      avisar("A senha precisa ter 8 caracteres, maiúscula, minúscula, número e símbolo.", true);
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

  botaoExcluir.addEventListener("click", async () => {
    if (!editando) return;

    const confirmacao = window.prompt(
      `Excluir permanentemente a conta de ${nomeCompleto(editando) ?? "esta pessoa"}?\n\n`
      + "Esta ação não pode ser desfeita. Digite EXCLUIR para confirmar.",
    );
    if (confirmacao !== "EXCLUIR") return;

    botaoExcluir.disabled = true;
    botaoSalvar.disabled = true;
    avisar("Excluindo conta…");
    const { data, error } = await supabase.functions.invoke("excluir-usuario", {
      body: { usuario_id: editando.id },
    });

    if (error || !data?.ok) {
      console.error("Erro ao excluir conta:", error);
      avisar(data?.erro ?? "Não foi possível excluir a conta.", true);
      botaoExcluir.disabled = false;
      botaoSalvar.disabled = false;
      return;
    }

    document.dispatchEvent(new CustomEvent("central-ti:pessoa-excluida", {
      detail: { id: editando.id },
    }));
    janela.close();
  });

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
    // Mesmo caminho de antes: sem versao nova a janela mostraria a foto antiga.
    pintarAvatar(avatarJanela, editando, String(Date.now()));
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
    contribuinte: "Contribuinte",
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

  document.addEventListener("central-ti:pessoa-excluida", (evento) => {
    const id = evento.detail?.id;
    const indice = pessoas.findIndex((pessoa) => pessoa.id === id);
    if (indice < 0) return;
    pessoas.splice(indice, 1);
    desenhar();
  });

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

  //BLOCO DE FOTO: so aparece pra quem tem ctx.comFoto (hoje so Terceirizados).
  const blocoFoto = document.querySelector("[data-item-simples-foto-bloco]");
  const avatarFoto = document.querySelector("[data-item-simples-foto-avatar]");
  const fotoBotaoTrocar = document.querySelector("[data-item-simples-foto-trocar]");
  const fotoBotaoRemover = document.querySelector("[data-item-simples-foto-remover]");
  const fotoArquivo = document.querySelector("[data-item-simples-foto-arquivo]");
  const ICONE_PADRAO_FOTO = avatarFoto.innerHTML; // o SVG de prédio, guardado pra restaurar sem foto.

  let editando = null;
  let contexto = null; // { tabela, rotuloSingular, aoSalvar, comFoto, bucketFoto }

  function avisar(texto, ehErro = false) {
    aviso.textContent = texto;
    aviso.classList.toggle("pessoa__aviso--erro", ehErro);

    if (!ehErro && texto) setTimeout(() => { aviso.textContent = ""; }, 2500);
  }

  //MOSTRA A FOTO SALVA, OU O ICONE PADRAO SE NAO TIVER: mesma logica do
  //avatar de pessoa (pintarFoto), so que sem letras de iniciais — aqui o
  //"sem foto" e sempre o SVG de predio, nunca texto.
  function atualizarFotoNaTela() {
    if (!editando?.foto_path) {
      avatarFoto.innerHTML = ICONE_PADRAO_FOTO;
      fotoBotaoRemover.hidden = true;
      return;
    }

    avatarFoto.innerHTML = "";

    const img = document.createElement("img");
    pintarImagemPrivada(img, contexto.bucketFoto, editando.foto_path,
      () => { if (avatarFoto.contains(img)) avatarFoto.innerHTML = ICONE_PADRAO_FOTO; });
    img.alt = "";
    avatarFoto.appendChild(img);
    fotoBotaoRemover.hidden = false;
  }

  function abrir(item, ctx) {
    editando = item;
    contexto = ctx;
    tituloJanela.textContent = `Editar ${ctx.rotuloSingular.toLowerCase()}`;
    rotuloJanela.textContent = "Nome";
    campoNome.value = item.nome;
    botaoSalvar.textContent = "Salvar";
    avisar("");

    blocoFoto.hidden = !ctx.comFoto;
    if (ctx.comFoto) atualizarFotoNaTela();

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

    // Sem id ainda (a pessoa está criando): a foto só pode ser enviada
    // depois que o item existir — mesma regra do dialog de pessoa. O bloco
    // aparece, mas o botão de trocar fica desabilitado até salvar.
    blocoFoto.hidden = !ctx.comFoto;
    if (ctx.comFoto) {
      avatarFoto.innerHTML = ICONE_PADRAO_FOTO;
      fotoBotaoRemover.hidden = true;
    }

    janela.showModal();
    campoNome.focus();
  }

  fotoBotaoTrocar.addEventListener("click", () => {
    if (!editando) {
      avisar("Salve o nome primeiro; a foto entra depois de criar.", true);
      return;
    }
    fotoArquivo.click();
  });

  fotoArquivo.addEventListener("change", async () => {
    const arquivo = fotoArquivo.files[0];

    if (!arquivo || !editando) return;

    fotoBotaoTrocar.disabled = true;
    avisar("Enviando foto…");

    const extensao = arquivo.name.split(".").pop().toLowerCase();
    const caminho = `${editando.id}.${extensao}`;

    const { error: erroUpload } = await supabase.storage
      .from(contexto.bucketFoto)
      .upload(caminho, arquivo, { upsert: true });

    if (erroUpload) {
      console.error(`Erro ao enviar foto em ${contexto.bucketFoto}:`, erroUpload);
      avisar("Não foi possível enviar a foto.", true);
      fotoBotaoTrocar.disabled = false;
      fotoArquivo.value = "";
      return;
    }

    const { data: gravada, error: erroSalvar } = await supabase
      .from(contexto.tabela)
      .update({ foto_path: caminho })
      .eq("id", editando.id)
      .select("id, nome, foto_path")
      .single();

    fotoBotaoTrocar.disabled = false;
    fotoArquivo.value = "";

    if (erroSalvar || !gravada) {
      console.error(`Erro ao salvar foto em ${contexto.tabela}:`, erroSalvar);
      avisar("A foto subiu, mas não foi possível salvá-la.", true);
      return;
    }

    Object.assign(editando, gravada);
    atualizarFotoNaTela();
    contexto.aoSalvar(editando, false);
    avisar("Foto atualizada");
  });

  fotoBotaoRemover.addEventListener("click", async () => {
    if (!editando?.foto_path) return;

    fotoBotaoRemover.disabled = true;
    avisar("Removendo foto…");

    const { error: erroArquivo } = await supabase.storage
      .from(contexto.bucketFoto)
      .remove([editando.foto_path]);

    if (erroArquivo) {
      console.error(`Erro ao remover foto em ${contexto.bucketFoto}:`, erroArquivo);
      avisar("Não foi possível remover a foto.", true);
      fotoBotaoRemover.disabled = false;
      return;
    }

    const { data: gravada, error } = await supabase
      .from(contexto.tabela)
      .update({ foto_path: null })
      .eq("id", editando.id)
      .select("id, nome, foto_path")
      .single();

    fotoBotaoRemover.disabled = false;

    if (error) {
      console.error(`Erro ao limpar foto_path em ${contexto.tabela}:`, error);
      avisar("A foto foi removida, mas não foi possível atualizar o cadastro.", true);
      return;
    }

    Object.assign(editando, gravada ?? { foto_path: null });
    atualizarFotoNaTela();
    contexto.aoSalvar(editando, false);
    avisar("Foto removida");
  });

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

function ligarListaSimples({
  prefixo, tabela, itens, rotuloSingular, rotuloPlural, generoMasculino = false, dialog,
  comFoto = false, bucketFoto = null,
}) {
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

  const ctx = { tabela, rotuloSingular, generoMasculino, comFoto, bucketFoto, aoSalvar: aoDialogSalvar };

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
   ABA ANALISE: SUBSTITUI O RELATORIO DE POWER BI — mesma ideia (graficos
   por periodo), mas os dados vem direto do banco, sem extracao manual.

   Cada aba nova do Power BI vira aqui uma consulta PROPRIA e LEVE, nunca o
   chamados.data completo de montarPainel (esse traz comentarios, anexos e
   membros de TODO chamado sem filtro de data — pesado demais, e so serve
   pro quadro/tabela de tickets). A consulta desta aba busca so os campos
   que os graficos precisam, e SEMPRE com o periodo aplicado no banco (a
   base tem ~15 mil chamados; nunca trazer tudo de uma vez).
   ========================================================================== */

//PALETA DO GRAFICO DE PIZZA: mesmas cores que o projeto ja usa em
//etiquetas/selo (urgente, prioridade, normal) mais alguns tons da familia
//laranja/terra da marca — nao e um gerador aleatorio, e uma lista fixa
//pensada pra nunca repetir cor entre categorias vizinhas.
const CORES_GRAFICO = [
  "#dd5b12", "#2f6fb0", "#3a9c6a", "#9a5b00", "#7a4a2a",
  "#b02a2a", "#5e141d", "#6b6b70", "#c77240", "#1f6b5c",
];

//ESPESSURA DA BARRA PROPORCIONAL A QUANTIDADE: com maxBarThickness fixo,
//3 barras num container de 352px (.analise-grafico__caixa--barra, 22rem)
//ficavam finas e desencontradas, sobrando bastante espaco vazio entre
//elas; com muitas unidades a mesma espessura fixa faria as barras
//se espremerem ou vazarem do container. Divide a altura disponivel pela
//quantidade de barras e usa um pedaco dela como espessura — poucas
//barras ganham mais grossura, muitas ficam mais finas — sempre dentro de
//um minimo (continua clicavel/legivel) e um maximo (nao vira um bloco
//gigante so com uma ou duas barras).
const ALTURA_GRAFICO_BARRA_PX = 352; // bate com .analise-grafico__caixa--barra (22rem)

function espessuraDaBarra(quantidade) {
  if (!quantidade) return 22;

  const espacoPorBarra = ALTURA_GRAFICO_BARRA_PX / quantidade;
  return Math.max(14, Math.min(48, Math.round(espacoPorBarra * 0.6)));
}

//FONTE PADRAO DE TODOS OS GRAFICOS: "Poppins", igual ao resto do
//Painel/Portal — sem isso o Chart.js cai na fonte generica do sistema
//(Helvetica/Arial), destoando do resto da tela. Definido uma vez so,
//antes do primeiro grafico ser criado (Chart e global, vem do CDN).
Chart.defaults.font.family = "'Poppins', system-ui, sans-serif";
Chart.defaults.font.size = 12;

//TOOLTIP NO PADRAO SHADCN DO PROJETO: cantos arredondados generosos,
//sem a seta/triangulo padrao do Chart.js (nao combina com o resto do
//site, que nunca usa esse recurso), padding confortavel, titulo em
//Poppins 600 (os rotulos de card/grafico do projeto usam esse peso pra
//titulo, ver .analise-grafico__titulo em painel.css).
Chart.defaults.plugins.tooltip.backgroundColor = "#1a1a1a";
Chart.defaults.plugins.tooltip.titleFont = { family: "'Poppins', system-ui, sans-serif", weight: "600", size: 12 };
Chart.defaults.plugins.tooltip.bodyFont = { family: "'Poppins', system-ui, sans-serif", size: 12 };
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.plugins.tooltip.displayColors = true;
Chart.defaults.plugins.tooltip.boxPadding = 4;

//SLA EM HORAS UTEIS, NAO HORAS CORRIDAS: regra do horario de
//funcionamento do TI — seg-sex 8h as 12h e 13h as 17h48 (a hora de almoco
//da equipe NAO conta), sabado 8h as 12h, domingo sem expediente. Um
//chamado aberto sexta 17h47 e fechado segunda 8h tem so 1 minuto de SLA
//(o cronometro so "liga" quando o expediente abre de verdade, nao conta o
//tempo fechado do fim de semana); um aberto 11h50 e fechado 13h10 tem 20
//minutos, e nao 1h20, porque a hora do almoco fica de fora. Feriados NAO
//sao considerados por enquanto (decisao do usuario) — so dia da semana e
//horario.
//
//Cada dia tem uma LISTA de janelas (a semana tem duas por causa do
//almoco): o algoritmo soma, dia a dia entre abertura e fechamento, a
//sobreposicao entre [abertura, fechamento] e cada janela daquele dia.
const EXPEDIENTE_POR_DIA_DA_SEMANA = {
  0: [], // domingo: sem expediente
  1: [{ inicio: [8, 0], fim: [12, 0] }, { inicio: [13, 0], fim: [17, 48] }],
  2: [{ inicio: [8, 0], fim: [12, 0] }, { inicio: [13, 0], fim: [17, 48] }],
  3: [{ inicio: [8, 0], fim: [12, 0] }, { inicio: [13, 0], fim: [17, 48] }],
  4: [{ inicio: [8, 0], fim: [12, 0] }, { inicio: [13, 0], fim: [17, 48] }],
  5: [{ inicio: [8, 0], fim: [12, 0] }, { inicio: [13, 0], fim: [17, 48] }],
  6: [{ inicio: [8, 0], fim: [12, 0] }], // sabado so de manha, sem almoco
};

function horasUteisEntre(inicio, fim) {
  if (fim <= inicio) return 0;

  let minutos = 0;
  // Comeca no dia da abertura e anda dia a dia ate o dia do fechamento —
  // no maximo alguns milhares de iteracoes mesmo pra um chamado aberto
  // ha anos, entao nao ha problema de desempenho aqui.
  const cursor = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());

  while (cursor <= fim) {
    EXPEDIENTE_POR_DIA_DA_SEMANA[cursor.getDay()].forEach((janela) => {
      const abreDoDia = new Date(cursor);
      abreDoDia.setHours(janela.inicio[0], janela.inicio[1], 0, 0);
      const fechaDoDia = new Date(cursor);
      fechaDoDia.setHours(janela.fim[0], janela.fim[1], 0, 0);

      // Sobreposicao entre [inicio, fim] do chamado e [abreDoDia, fechaDoDia]
      // desta janela — maior dos inicios, menor dos fins.
      const comeco = inicio > abreDoDia ? inicio : abreDoDia;
      const termino = fim < fechaDoDia ? fim : fechaDoDia;

      if (termino > comeco) {
        minutos += (termino - comeco) / 60_000;
      }
    });

    cursor.setDate(cursor.getDate() + 1);
  }

  return minutos / 60;
}

function formatarDuracao(horas) {
  if (horas == null || !Number.isFinite(horas)) return "—";

  if (horas < 24) {
    return `${horas.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} horas`;
  }

  return `${(horas / 24).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`;
}

//TEMPO ATE A PRIMEIRA RESPOSTA: da abertura ate o primeiro comentario de
//alguem que NAO e o solicitante (a equipe de TI) — mesmo criterio de
//"quem falou" que derivarStatus usa (chamado-comum.js), so publico e
//humano conta, nota interna e mensagem automatica de abertura nao.
//Chamado sem nenhuma resposta da equipe ainda fica de fora da media —
//nao tem "tempo de resposta" formado, igual um chamado aberto fica de
//fora do tempo de solucao.
function horasAtePrimeiraResposta(chamado) {
  const respostas = chamado.comentarios
    .filter((comentario) =>
      comentario.visibilidade === "publico" &&
      comentario.tipo === "humano" &&
      comentario.autor_id !== chamado.solicitante_id)
    .sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));

  const primeira = respostas[0];

  if (!primeira) return null;

  return horasUteisEntre(new Date(chamado.abertura_em), new Date(primeira.criado_em));
}

//"AAAA-MM-DD" NO FUSO LOCAL: toISOString() converte pra UTC antes de
//cortar a string — perto da meia-noite isso pode voltar um dia (as 23h de
//um dia no Brasil ja e 2h do dia seguinte em UTC). Usado em todo lugar
//que precisa da data de um Date local como texto, nunca toISOString().
function paraTextoLocal(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

//PRIMEIRO DIA DO MES ATE HOJE: mesmo padrao do print do Power BI (o
//usuario mandou um mes inteiro de exemplo) — o filtro sempre comeca com
//um recorte curto, nunca "todo o historico".
function periodoPadrao() {
  const hoje = new Date();
  const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);

  return { de: paraTextoLocal(primeiroDia), ate: paraTextoLocal(hoje) };
}

//OS 5 ATALHOS DO SELETOR DE PERIODO — cada um calcula { de, ate } a
//partir de hoje. "Semana" comeca na segunda (padrao BR), nao no domingo.
const ATALHOS_PERIODO = {
  hoje: () => {
    const hoje = new Date();
    return { de: hoje, ate: hoje };
  },
  semana: () => {
    const hoje = new Date();
    // getDay(): 0=domingo..6=sabado. Distancia ate a segunda-feira anterior
    // (ou a propria hoje, se hoje ja for segunda).
    const distanciaDaSegunda = (hoje.getDay() + 6) % 7;
    const segunda = new Date(hoje);
    segunda.setDate(hoje.getDate() - distanciaDaSegunda);
    return { de: segunda, ate: hoje };
  },
  mes: () => {
    const hoje = new Date();
    return { de: new Date(hoje.getFullYear(), hoje.getMonth(), 1), ate: hoje };
  },
  "mes-passado": () => {
    const hoje = new Date();
    const primeiroDoMesPassado = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    // Dia 0 do mes atual = ultimo dia do mes anterior.
    const ultimoDoMesPassado = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
    return { de: primeiroDoMesPassado, ate: ultimoDoMesPassado };
  },
  ano: () => {
    const hoje = new Date();
    return { de: new Date(hoje.getFullYear(), 0, 1), ate: hoje };
  },
};

const NOMES_MES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function ligarAnalise() {
  const secao = document.querySelector('[data-painel-aba="analise"]');

  if (!secao) return { aoAbrir: () => {} };

  const erroEl = secao.querySelector("[data-analise-erro]");
  const vazioEl = secao.querySelector("[data-analise-vazio]");
  const cardsEl = secao.querySelector("[data-analise-cards]");
  const unidadesCardsEl = secao.querySelector("[data-analise-unidades-cards]");
  const categoriasCardsEl = secao.querySelector("[data-analise-categorias-cards]");
  const setoresCardsEl = secao.querySelector("[data-analise-setores-cards]");
  const solicitantesCardsEl = secao.querySelector("[data-analise-solicitantes-cards]");
  const atendentesCardsEl = secao.querySelector("[data-analise-atendentes-cards]");
  const terceirosCardsEl = secao.querySelector("[data-analise-terceiros-cards]");
  const acompanhamentoCardsEl = secao.querySelector("[data-analise-acompanhamento-cards]");
  const subabasNavEl = secao.querySelector("[data-analise-subabas]");
  const canvasUnidades = secao.querySelector("[data-analise-grafico-unidades]");
  const canvasCategorias = secao.querySelector("[data-analise-grafico-categorias]");
  const canvasUnidadesEmpilhado = secao.querySelector("[data-analise-grafico-unidades-empilhado]");
  const canvasUnidadesSla = secao.querySelector("[data-analise-grafico-unidades-sla]");
  const canvasCategoriasEmpilhado = secao.querySelector("[data-analise-grafico-categorias-empilhado]");
  const canvasCategoriasSla = secao.querySelector("[data-analise-grafico-categorias-sla]");
  const canvasSetoresEmpilhado = secao.querySelector("[data-analise-grafico-setores-empilhado]");
  const canvasSetoresSla = secao.querySelector("[data-analise-grafico-setores-sla]");
  const canvasSolicitantesEmpilhado = secao.querySelector("[data-analise-grafico-solicitantes-empilhado]");
  const canvasSolicitantesSla = secao.querySelector("[data-analise-grafico-solicitantes-sla]");
  const canvasAtendentesTotal = secao.querySelector("[data-analise-grafico-atendentes-total]");
  const canvasAtendentesSla = secao.querySelector("[data-analise-grafico-atendentes-sla]");
  const canvasTerceirosTotal = secao.querySelector("[data-analise-grafico-terceiros-total]");
  const canvasTerceirosSla = secao.querySelector("[data-analise-grafico-terceiros-sla]");
  const canvasMesTotal = secao.querySelector("[data-analise-grafico-mes-total]");
  const canvasMesSla = secao.querySelector("[data-analise-grafico-mes-sla]");

  let graficoUnidades = null;
  let graficoCategorias = null;
  let graficoUnidadesEmpilhado = null;
  let graficoUnidadesSla = null;
  let graficoCategoriasEmpilhado = null;
  let graficoCategoriasSla = null;
  let graficoSetoresEmpilhado = null;
  let graficoSetoresSla = null;
  let graficoSolicitantesEmpilhado = null;
  let graficoSolicitantesSla = null;
  let graficoAtendentesTotal = null;
  let graficoAtendentesSla = null;
  let graficoTerceirosTotal = null;
  let graficoTerceirosSla = null;
  let graficoMesTotal = null;
  let graficoMesSla = null;
  let jaAbriu = false;

  // Acompanhamento tem sua PROPRIA consulta (12 meses fixos, nao o
  // periodo do topo) e so carrega na primeira vez que a sub-aba abre —
  // igual ao padrao jaAbriu da secao inteira, so que aninhado.
  let jaAbriuAcompanhamento = false;
  let dadosAcompanhamento = [];

  // Guarda o resultado BRUTO da consulta (so o periodo aplicado no banco,
  // nunca os filtros de unidade/categoria/setor/atendente — esses sao
  // client-side, ver aplicarFiltrosAnalise). Trocar de sub-aba ou mudar um
  // filtro so reprocessa o que ja esta em memoria, sem nova consulta ao
  // banco — todas as sub-abas usam o MESMO periodo e os MESMOS filtros do
  // topo desta secao.
  let ultimoResultado = [];

  //FILTROS GLOBAIS DA ANALISE: unidade/categoria/setor/atendente, mesmo
  //padrao do filtro de "Todos os tickets" (ligarFiltroDeTickets) —
  //client-side, sobre o que a consulta ja trouxe do periodo. SEM_ATENDENTE
  //e um valor sentinela (nao e um id de verdade) pra "chamado sem ninguem
  //em chamado_membros", igual ligarFiltroDeTickets ja faz.
  const SEM_ATENDENTE_ANALISE = "__sem-atendente";
  const filtrosAnalise = { unidade: [], categoria: [], setor: [], atendente: [] };

  function totalDeFiltrosAnalise() {
    return filtrosAnalise.unidade.length + filtrosAnalise.categoria.length
      + filtrosAnalise.setor.length + filtrosAnalise.atendente.length;
  }

  function aplicarFiltrosAnalise(chamados) {
    return chamados.filter((chamado) => {
      if (filtrosAnalise.unidade.length && !filtrosAnalise.unidade.includes(chamado.unidade_id)) return false;
      if (filtrosAnalise.categoria.length && !filtrosAnalise.categoria.includes(chamado.categoria_id)) return false;
      if (filtrosAnalise.setor.length && !filtrosAnalise.setor.includes(chamado.usuarios?.setor_id)) return false;

      if (filtrosAnalise.atendente.length) {
        const idsAtendentes = chamado.chamado_membros.map((membro) => membro.usuario_id);
        const combina = idsAtendentes.some((id) => filtrosAnalise.atendente.includes(id))
          || (filtrosAnalise.atendente.includes(SEM_ATENDENTE_ANALISE) && !idsAtendentes.length);
        if (!combina) return false;
      }

      return true;
    });
  }

  //O QUE TODA SUB-ABA DE FATO DESENHA: periodo (ja aplicado no banco em
  //carregar()) + filtros client-side por cima.
  function dadosFiltrados() {
    return aplicarFiltrosAnalise(ultimoResultado);
  }

  // { de, ate }: Date locais, sempre em par — e o que a consulta usa de
  // verdade. O input date sumiu; agora quem escreve aqui e o atalho
  // clicado ou o range confirmado no calendario.
  let periodo = ATALHOS_PERIODO.mes();
  let atalhoAtivo = "mes";

  const periodoBotao = secao.querySelector("[data-periodo-abrir]");
  const periodoRotulo = secao.querySelector("[data-periodo-rotulo]");
  const periodoCaixa = secao.querySelector("[data-periodo-caixa]");
  const periodoPainel = secao.querySelector("[data-periodo-painel]");
  const mesAnteriorBotao = secao.querySelector("[data-periodo-mes-anterior]");
  const mesProximoBotao = secao.querySelector("[data-periodo-mes-proximo]");
  const mesTitulo = secao.querySelector("[data-periodo-mes-titulo]");
  const diasEl = secao.querySelector("[data-periodo-dias]");
  const cancelarBotao = secao.querySelector("[data-periodo-cancelar]");
  const confirmarBotao = secao.querySelector("[data-periodo-confirmar]");

  // Mes que o calendario esta mostrando (independente do periodo
  // aplicado) e a selecao em andamento (dois cliques: inicio, depois fim).
  let mesVisivel = new Date(periodo.de.getFullYear(), periodo.de.getMonth(), 1);
  let selecaoInicio = null;
  let selecaoFim = null;

  function formatarRotuloPeriodo() {
    const rotulosFixos = {
      hoje: "Hoje", semana: "Esta semana", mes: "Este mês",
      "mes-passado": "Mês passado", ano: "Este ano",
    };

    if (atalhoAtivo) return rotulosFixos[atalhoAtivo];

    //DD/MM manual, nao toLocaleDateString: o formato "short" do pt-BR
    //produz "01 de set." (com "de" e ponto), verboso demais pro botao.
    const curto = (data) =>
      `${String(data.getDate()).padStart(2, "0")}/${String(data.getMonth() + 1).padStart(2, "0")}`;

    return `${curto(periodo.de)} – ${curto(periodo.ate)}`;
  }

  function aplicarPeriodo(novoPeriodo, chaveAtalho) {
    periodo = novoPeriodo;
    atalhoAtivo = chaveAtalho ?? null;
    periodoRotulo.textContent = formatarRotuloPeriodo();
    carregar();
  }

  function mostrarPainel(aberto) {
    periodoPainel.hidden = !aberto;
    periodoBotao.setAttribute("aria-expanded", String(aberto));

    if (aberto) {
      // Reabre sempre mostrando o mes do periodo ATUAL, sem selecao pendente
      // de uma vez anterior que a pessoa cancelou.
      mesVisivel = new Date(periodo.de.getFullYear(), periodo.de.getMonth(), 1);
      selecaoInicio = null;
      selecaoFim = null;
      desenharCalendario();
    }
  }

  //RECONSTROI A GRADE INTEIRA: usada so quando o MES visivel muda (abrir o
  //popover, trocar de mes) — o layout dos 42 dias e diferente a cada mes.
  function desenharCalendario() {
    mesTitulo.textContent = `${NOMES_MES[mesVisivel.getMonth()]} ${mesVisivel.getFullYear()}`;

    const primeiroDoMes = new Date(mesVisivel.getFullYear(), mesVisivel.getMonth(), 1);
    // Mesma conta de distancia-ate-segunda do atalho "semana": a grade
    // sempre comeca numa segunda-feira, mesmo que seja do mes anterior.
    const distanciaDaSegunda = (primeiroDoMes.getDay() + 6) % 7;
    const inicioDaGrade = new Date(primeiroDoMes);
    inicioDaGrade.setDate(primeiroDoMes.getDate() - distanciaDaSegunda);

    const hojeTexto = paraTextoLocal(new Date());

    diasEl.replaceChildren();

    // 6 semanas cobre qualquer mes, inclusive os que "vazam" pra 6 linhas.
    for (let indice = 0; indice < 42; indice += 1) {
      const dia = new Date(inicioDaGrade);
      dia.setDate(inicioDaGrade.getDate() + indice);

      const diaTexto = paraTextoLocal(dia);
      const foraDoMes = dia.getMonth() !== mesVisivel.getMonth();

      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "periodo-dia";
      botao.textContent = String(dia.getDate());
      botao.dataset.data = diaTexto;
      if (foraDoMes) botao.classList.add("periodo-dia--fora");
      if (diaTexto === hojeTexto) botao.classList.add("periodo-dia--hoje");

      // Nao usa closure sobre `dia`: o clique sempre le o Date de novo a
      // partir do dataset, senao um clique num botao "velho" (de antes de
      // uma corrida de re-render) selecionaria a data errada.
      botao.addEventListener("click", () => selecionarDia(new Date(diaTexto + "T00:00:00")));
      diasEl.appendChild(botao);
    }

    atualizarSelecaoNaGrade();
  }

  //SO ATUALIZA AS CLASSES DE SELECAO NOS BOTOES JA EXISTENTES, sem
  //recriar nenhum — chamada a cada clique num dia. Recriar o grid inteiro
  //dentro do proprio handler de clique do dia removia o botao clicado da
  //arvore ANTES do clique terminar de borbulhar ate o listener de
  //"clique fora" no document, e o closest() num no ja desconectado da
  //arvore retorna null — o popover fechava sozinho a cada dia clicado,
  //antes da pessoa conseguir escolher o segundo dia do intervalo.
  function atualizarSelecaoNaGrade() {
    const inicioTexto = selecaoInicio && paraTextoLocal(selecaoInicio);
    const fimTexto = selecaoFim && paraTextoLocal(selecaoFim);

    diasEl.querySelectorAll(".periodo-dia").forEach((botao) => {
      const diaTexto = botao.dataset.data;

      botao.classList.toggle("periodo-dia--inicio", Boolean(inicioTexto) && diaTexto === inicioTexto);
      botao.classList.toggle("periodo-dia--fim", Boolean(fimTexto) && diaTexto === fimTexto);
      botao.classList.toggle(
        "periodo-dia--no-range",
        Boolean(inicioTexto) && Boolean(fimTexto) && diaTexto > inicioTexto && diaTexto < fimTexto,
      );
    });
  }

  function selecionarDia(dia) {
    // Primeiro clique da selecao (ou clique depois de um range ja
    // completo): comeca um range novo, do zero.
    if (!selecaoInicio || selecaoFim) {
      selecaoInicio = dia;
      selecaoFim = null;
    } else if (dia < selecaoInicio) {
      // Clicou antes do inicio: o clique novo vira o inicio.
      selecaoFim = selecaoInicio;
      selecaoInicio = dia;
    } else {
      selecaoFim = dia;
    }

    confirmarBotao.disabled = !(selecaoInicio && selecaoFim);
    atualizarSelecaoNaGrade();
  }

  Object.keys(ATALHOS_PERIODO).forEach((chave) => {
    const botao = secao.querySelector(`[data-periodo-atalho="${chave}"]`);

    botao?.addEventListener("click", () => {
      secao.querySelectorAll(".periodo-atalho")
        .forEach((outro) => outro.classList.remove("periodo-atalho--marcado"));
      botao.classList.add("periodo-atalho--marcado");

      aplicarPeriodo(ATALHOS_PERIODO[chave](), chave);
      mostrarPainel(false);
    });
  });

  mesAnteriorBotao.addEventListener("click", () => {
    mesVisivel = new Date(mesVisivel.getFullYear(), mesVisivel.getMonth() - 1, 1);
    desenharCalendario();
  });

  mesProximoBotao.addEventListener("click", () => {
    mesVisivel = new Date(mesVisivel.getFullYear(), mesVisivel.getMonth() + 1, 1);
    desenharCalendario();
  });

  cancelarBotao.addEventListener("click", () => mostrarPainel(false));

  confirmarBotao.addEventListener("click", () => {
    if (!selecaoInicio || !selecaoFim) return;

    secao.querySelectorAll(".periodo-atalho")
      .forEach((outro) => outro.classList.remove("periodo-atalho--marcado"));

    aplicarPeriodo({ de: selecaoInicio, ate: selecaoFim }, null);
    mostrarPainel(false);
  });

  periodoBotao.addEventListener("click", () => mostrarPainel(periodoPainel.hidden));

  //CLIQUE FORA OU ESC FECHA — mesma regra dos outros dropdowns da tela.
  document.addEventListener("click", (evento) => {
    if (!periodoPainel.hidden && !evento.target.closest("[data-periodo-caixa]")) mostrarPainel(false);
  });
  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && !periodoPainel.hidden) mostrarPainel(false);
  });

  periodoRotulo.textContent = formatarRotuloPeriodo();

  /* ------------------------------------------------------------------
     SUB-ABAS: barra no rodape da secao (pedido do usuario), cada uma um
     pedaco do relatorio de Power BI. Trocar so alterna [hidden] e
     redesenha os graficos da sub-aba escolhida com o ultimoResultado ja
     em memoria — nunca refaz a consulta.
     ------------------------------------------------------------------ */
  const subabaBotoes = [...secao.querySelectorAll("[data-analise-subaba]")];
  const subabaSecoes = [...secao.querySelectorAll("[data-analise-sub]")];

  function mostrarSubaba(chave) {
    subabaBotoes.forEach((botao) => {
      botao.classList.toggle("analise-subaba--atual", botao.dataset.analiseSubaba === chave);
    });
    subabaSecoes.forEach((sub) => {
      sub.hidden = sub.dataset.analiseSub !== chave;
    });
    desenharSubabaAtual(chave);
  }

  //REDESENHA SO OS GRAFICOS DA SUB-ABA VISIVEL: um canvas escondido
  //([hidden] no ancestral) mede largura 0 no Chart.js e o grafico nasce
  //achatado — por isso Resumo e Unidades tem os graficos redesenhados de
  //novo aqui a cada troca, em vez de todos de uma vez em carregar().
  function desenharSubabaAtual(chave) {
    if (!ultimoResultado.length) return;

    const chamados = dadosFiltrados();

    if (chave === "resumo") {
      desenharGraficoUnidades(chamados);
      desenharGraficoCategorias(chamados);
    } else if (chave === "unidades") {
      desenharCardsDeUnidades(chamados);
      desenharGraficoUnidadesEmpilhado(chamados);
      desenharGraficoUnidadesSla(chamados);
    } else if (chave === "categorias") {
      desenharCardsDeCategorias(chamados);
      desenharGraficoCategoriasEmpilhado(chamados);
      desenharGraficoCategoriasSla(chamados);
    } else if (chave === "setores") {
      desenharCardsDeSetores(chamados);
      desenharGraficoSetoresEmpilhado(chamados);
      desenharGraficoSetoresSla(chamados);
    } else if (chave === "solicitantes") {
      desenharCardsDeSolicitantes(chamados);
      desenharGraficoSolicitantesEmpilhado(chamados);
      desenharGraficoSolicitantesSla(chamados);
    } else if (chave === "atendentes") {
      desenharCardsDeAtendentes(chamados);
      desenharGraficoAtendentesTotal(chamados);
      desenharGraficoAtendentesSla(chamados);
    } else if (chave === "terceiros") {
      desenharCardsDeTerceiros(chamados);
      desenharGraficoTerceirosTotal(chamados);
      desenharGraficoTerceirosSla(chamados);
    } else if (chave === "acompanhamento") {
      // Consulta PROPRIA (12 meses fixos), carregada so na primeira vez —
      // desenharAcompanhamento cuida de disparar carregarAcompanhamento()
      // se ainda nao tiver dados, e redesenhar quando a consulta voltar.
      desenharAcompanhamento();
    }
  }

  subabaBotoes.forEach((botao) => {
    botao.addEventListener("click", () => mostrarSubaba(botao.dataset.analiseSubaba));
  });

  /* ------------------------------------------------------------------
     FILTRO GLOBAL DA ANALISE: unidade/categoria/setor/atendente, mesmo
     padrao visual e de interacao do filtro de "Todos os tickets"
     (ligarFiltroDeTickets), so que aqui filtra o conjunto de dados
     compartilhado por TODAS as sub-abas, nao uma tabela. As opcoes de
     cada grupo sao derivadas do proprio ultimoResultado (quem realmente
     aparece no periodo carregado), nao de uma lista fixa vinda de outra
     consulta — assim nunca mostra "Financeiro" como opcao de setor se
     ninguem daquele setor abriu chamado no periodo escolhido.
     ------------------------------------------------------------------ */
  const filtroCaixa = secao.querySelector("[data-analise-filtro-caixa]");
  const filtroBotao = secao.querySelector("[data-analise-filtro-abrir]");
  const filtroPainel = secao.querySelector("[data-analise-filtro-painel]");
  const filtroGrupos = secao.querySelector("[data-analise-filtro-grupos]");
  const filtroContador = secao.querySelector("[data-analise-filtro-contador]");
  const filtroLimpar = secao.querySelector("[data-analise-filtro-limpar]");

  function opcoesUnicas(chamados, pegarPar) {
    const mapa = new Map();
    chamados.forEach((chamado) => {
      const par = pegarPar(chamado);
      if (par && par[0] != null && !mapa.has(par[0])) mapa.set(par[0], par[1]);
    });
    return [...mapa.entries()].map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }

  function atualizarBotaoFiltro() {
    const total = totalDeFiltrosAnalise();
    filtroBotao.classList.toggle("painel-icone-botao--ativo", total > 0);
    filtroContador.hidden = !total;
    filtroContador.textContent = String(total);
    filtroLimpar.disabled = !total;
  }

  //MESMA IDEIA DE grupoChips EM ligarFiltroDeTickets: poucas opcoes,
  //cabe como botoezinhos — usado pra unidade/categoria/setor.
  function grupoChipsAnalise({ titulo, opcoes, chave }) {
    const grupo = document.createElement("div");
    grupo.className = "painel-filtro-grupo";

    const rotulo = document.createElement("p");
    rotulo.className = "painel-filtro-grupo__titulo";
    rotulo.textContent = titulo;

    const lista = document.createElement("div");
    lista.className = "painel-filtro-grupo__opcoes";

    if (!opcoes.length) {
      const vazio = document.createElement("p");
      vazio.className = "painel-filtro-grupo__vazio";
      vazio.textContent = "Nada para filtrar aqui ainda.";
      grupo.append(rotulo, vazio);
      return grupo;
    }

    opcoes.forEach(({ id, nome }) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "painel-filtro-chip";
      chip.classList.toggle("painel-filtro-chip--marcado", filtrosAnalise[chave].includes(id));
      chip.textContent = nome;

      chip.addEventListener("click", () => {
        filtrosAnalise[chave] = filtrosAnalise[chave].includes(id)
          ? filtrosAnalise[chave].filter((atual) => atual !== id)
          : [...filtrosAnalise[chave], id];

        chip.classList.toggle("painel-filtro-chip--marcado", filtrosAnalise[chave].includes(id));
        atualizarBotaoFiltro();
        desenharCards(dadosFiltrados());
        desenharSubabaAtual(subabaBotoes.find((botao) => botao.classList.contains("analise-subaba--atual"))
          ?.dataset.analiseSubaba ?? "resumo");
      });

      lista.appendChild(chip);
    });

    grupo.append(rotulo, lista);
    return grupo;
  }

  //MESMA IDEIA DE grupoPessoas EM ligarFiltroDeTickets: pode ter muita
  //gente, ganha campo de busca e caixinhas de marcar — usado so pra
  //atendente (chamado_membros pode ter varias pessoas por chamado).
  function grupoPessoasAnalise({ titulo, opcoes, chave }) {
    const grupo = document.createElement("div");
    grupo.className = "painel-filtro-grupo";

    const rotulo = document.createElement("p");
    rotulo.className = "painel-filtro-grupo__titulo";
    rotulo.textContent = titulo;

    if (!opcoes.length) {
      const vazio = document.createElement("p");
      vazio.className = "painel-filtro-grupo__vazio";
      vazio.textContent = "Nada para filtrar aqui ainda.";
      grupo.append(rotulo, vazio);
      return grupo;
    }

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

    opcoes.forEach(({ id, nome }) => {
      const item = document.createElement("label");
      item.className = "painel-filtro-grupo__item";
      item.dataset.nome = nome.toLowerCase();

      const caixa = document.createElement("input");
      caixa.type = "checkbox";
      caixa.checked = filtrosAnalise[chave].includes(id);

      caixa.addEventListener("change", () => {
        filtrosAnalise[chave] = caixa.checked
          ? [...filtrosAnalise[chave], id]
          : filtrosAnalise[chave].filter((atual) => atual !== id);

        atualizarBotaoFiltro();
        desenharCards(dadosFiltrados());
        desenharSubabaAtual(subabaBotoes.find((botao) => botao.classList.contains("analise-subaba--atual"))
          ?.dataset.analiseSubaba ?? "resumo");
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

    grupo.append(rotulo, busca, lista, vazioBusca);
    return grupo;
  }

  //RECONSTROI OS GRUPOS A CADA carregar() (novo periodo = opcoes novas):
  //preserva a SELECAO ja marcada em filtrosAnalise, so troca as opcoes
  //disponiveis pra bater com quem aparece no periodo atual.
  function montarFiltroAnalise() {
    const unidades = opcoesUnicas(ultimoResultado, (c) => c.unidades ? [c.unidade_id, c.unidades.nome] : null);
    const categorias = opcoesUnicas(ultimoResultado, (c) => c.categorias ? [c.categoria_id, c.categorias.nome] : null);
    const setores = opcoesUnicas(ultimoResultado, (c) => c.usuarios?.setores
      ? [c.usuarios.setor_id, c.usuarios.setores.nome] : null);

    const atendentesMapa = new Map();
    let temChamadoSemAtendente = false;
    ultimoResultado.forEach((chamado) => {
      if (!chamado.chamado_membros.length) temChamadoSemAtendente = true;
      chamado.chamado_membros.forEach((membro) => {
        if (membro.usuarios && !atendentesMapa.has(membro.usuario_id)) {
          atendentesMapa.set(membro.usuario_id, nomeCompleto(membro.usuarios) ?? "Alguém");
        }
      });
    });
    const atendentes = [...atendentesMapa.entries()].map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    if (temChamadoSemAtendente) atendentes.push({ id: SEM_ATENDENTE_ANALISE, nome: "Sem atendente" });

    filtroGrupos.replaceChildren(
      grupoChipsAnalise({ titulo: "Unidade", chave: "unidade", opcoes: unidades }),
      grupoChipsAnalise({ titulo: "Categoria", chave: "categoria", opcoes: categorias }),
      grupoChipsAnalise({ titulo: "Setor", chave: "setor", opcoes: setores }),
      grupoPessoasAnalise({ titulo: "Atendente", chave: "atendente", opcoes: atendentes }),
    );

    atualizarBotaoFiltro();
  }

  function mostrarFiltroAnalise(aberto) {
    filtroPainel.hidden = !aberto;
    filtroBotao.setAttribute("aria-expanded", String(aberto));
  }

  filtroBotao.addEventListener("click", () => mostrarFiltroAnalise(filtroPainel.hidden));

  filtroLimpar.addEventListener("click", () => {
    filtrosAnalise.unidade = [];
    filtrosAnalise.categoria = [];
    filtrosAnalise.setor = [];
    filtrosAnalise.atendente = [];
    montarFiltroAnalise();
    desenharCards(dadosFiltrados());
    desenharSubabaAtual(subabaBotoes.find((botao) => botao.classList.contains("analise-subaba--atual"))
      ?.dataset.analiseSubaba ?? "resumo");
  });

  //CLIQUE FORA OU ESC FECHA — mesma regra dos outros dropdowns da tela.
  document.addEventListener("click", (evento) => {
    if (!filtroPainel.hidden && !evento.target.closest("[data-analise-filtro-caixa]")) mostrarFiltroAnalise(false);
  });
  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && !filtroPainel.hidden) mostrarFiltroAnalise(false);
  });

  /* ------------------------------------------------------------------
     EXPORTAR EM PDF: "foto" (html2canvas) da sub-aba renderizada, colada
     numa pagina A4 retrato (jsPDF) — o PDF sai visualmente identico ao
     que esta na tela (cores, graficos, layout), diferente do PDF de
     texto que a Base de Solucoes gera (baixarPdfSolucao em base.js, que
     desenha tudo na mao com jsPDF puro — nao serve aqui, o pedido era
     "o resultado exato do dashboard", nao um relatorio textual).
     ------------------------------------------------------------------ */
  const exportarCaixa = secao.querySelector("[data-analise-exportar-caixa]");
  const exportarBotao = secao.querySelector("[data-analise-exportar-abrir]");
  const exportarPainel = secao.querySelector("[data-analise-exportar-painel]");
  const exportarStatus = secao.querySelector("[data-analise-exportar-status]");

  function mostrarExportar(aberto) {
    exportarPainel.hidden = !aberto;
    exportarBotao.setAttribute("aria-expanded", String(aberto));
  }

  exportarBotao.addEventListener("click", () => mostrarExportar(exportarPainel.hidden));

  document.addEventListener("click", (evento) => {
    if (!exportarPainel.hidden && !evento.target.closest("[data-analise-exportar-caixa]")) mostrarExportar(false);
  });
  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && !exportarPainel.hidden) mostrarExportar(false);
  });

  //TITULO + PERIODO ATIVO NO TOPO DA CAPTURA: da contexto de QUANDO foi
  //gerado sem precisar reabrir o Painel pra saber — cada pagina do PDF
  //ganha essa faixa antes de tirar a "foto" da sub-aba (removida logo
  //depois, nao fica na tela de verdade pro usuario).
  function montarFaixaDeContexto(rotuloSubaba) {
    const faixa = document.createElement("div");
    faixa.className = "analise-exportar-faixa";

    const titulo = document.createElement("h1");
    titulo.textContent = `Análise — ${rotuloSubaba}`;

    const periodo = document.createElement("p");
    periodo.textContent = `Período: ${periodoRotulo.textContent}`;

    faixa.append(titulo, periodo);
    return faixa;
  }

  //CAPTURA UMA SUB-ABA (precisa estar VISIVEL — html2canvas nao renderiza
  //elemento com display:none) e devolve o canvas pronto pra colar no PDF.
  async function capturarSubaba(subabaEl, rotuloSubaba) {
    const faixa = montarFaixaDeContexto(rotuloSubaba);
    subabaEl.prepend(faixa);

    try {
      return await html2canvas(subabaEl, {
        backgroundColor: corDoTexto("--superficie-2") || "#f4f4f5",
        scale: 2, // nitidez maior que 1:1 — o texto dos graficos fica legivel no PDF
        useCORS: true,
      });
    } finally {
      faixa.remove();
    }
  }

  //CANVAS -> UMA PAGINA A4 RETRATO: escala a imagem pra caber na largura
  //util da pagina (margem de 10mm de cada lado), mantendo a proporcao —
  //se a imagem for mais alta que a pagina, ela e cortada na largura, nunca
  //espremida ou distorcida.
  function adicionarPaginaComCanvas(doc, canvas, ehPrimeiraPagina) {
    const LARGURA_A4_MM = 210;
    const ALTURA_A4_MM = 297;
    const MARGEM_MM = 10;
    const larguraUtil = LARGURA_A4_MM - MARGEM_MM * 2;
    const alturaUtil = ALTURA_A4_MM - MARGEM_MM * 2;

    const razao = canvas.height / canvas.width;
    let larguraImg = larguraUtil;
    let alturaImg = larguraImg * razao;

    // Mais alta que a pagina inteira: encolhe pra caber na altura em vez
    // de deixar a imagem estourar a pagina (perderia o rodape do grafico).
    if (alturaImg > alturaUtil) {
      alturaImg = alturaUtil;
      larguraImg = alturaImg / razao;
    }

    if (!ehPrimeiraPagina) doc.addPage();

    const x = MARGEM_MM + (larguraUtil - larguraImg) / 2;
    doc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", x, MARGEM_MM, larguraImg, alturaImg);
  }

  async function exportarPaginaAtual() {
    const chaveAtual = subabaBotoes.find((botao) => botao.classList.contains("analise-subaba--atual"))
      ?.dataset.analiseSubaba ?? "resumo";
    const subabaEl = secao.querySelector(`[data-analise-sub="${chaveAtual}"]`);
    const rotulo = subabaBotoes.find((botao) => botao.dataset.analiseSubaba === chaveAtual)?.textContent ?? chaveAtual;

    const canvas = await capturarSubaba(subabaEl, rotulo);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    adicionarPaginaComCanvas(doc, canvas, true);
    doc.save(`analise-${chaveAtual}.pdf`);
  }

  async function exportarTudo() {
    const chaveOriginal = subabaBotoes.find((botao) => botao.classList.contains("analise-subaba--atual"))
      ?.dataset.analiseSubaba ?? "resumo";

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

    for (let indice = 0; indice < subabaBotoes.length; indice += 1) {
      const botao = subabaBotoes[indice];
      const chave = botao.dataset.analiseSubaba;

      exportarStatus.textContent = `Gerando "${botao.textContent}" (${indice + 1} de ${subabaBotoes.length})…`;

      // Mostra a sub-aba de verdade (nao so tira o [hidden]): precisa
      // redesenhar os graficos dela, senao um canvas que nunca ficou
      // visivel neste carregamento da pagina nasce com largura 0.
      mostrarSubaba(chave);
      // Dois frames de respiro pro Chart.js terminar de desenhar antes
      // do html2canvas tirar a "foto" — mudar [hidden] e chamar Chart.js
      // no mesmo tick nao garante que o canvas ja tem pixel pra capturar.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const subabaEl = secao.querySelector(`[data-analise-sub="${chave}"]`);
      const canvas = await capturarSubaba(subabaEl, botao.textContent);
      adicionarPaginaComCanvas(doc, canvas, indice === 0);
    }

    mostrarSubaba(chaveOriginal);
    exportarStatus.textContent = "Gera um PDF em retrato, igual ao que está na tela agora.";
    doc.save("analise-completa.pdf");
  }

  secao.querySelectorAll("[data-analise-exportar]").forEach((botao) => {
    botao.addEventListener("click", async () => {
      mostrarExportar(false);
      const modo = botao.dataset.analiseExportar;

      exportarStatus.textContent = "Gerando PDF…";

      try {
        if (modo === "pagina") await exportarPaginaAtual();
        else await exportarTudo();
      } catch (erro) {
        console.error("Erro ao exportar a análise em PDF:", erro);
        mostrarErro("Não foi possível gerar o PDF. Tente novamente.");
      } finally {
        exportarStatus.textContent = "Gera um PDF em retrato, igual ao que está na tela agora.";
      }
    });
  });

  //OS TOKENS DE COR (--texto-2, --borda, --superficie...) SAO DECLARADOS
  //EM body.portal-pagina (portal.css), NAO em :root/<html> — ler do
  //documentElement sempre voltava string vazia. Passou despercebido pros
  //eixos/grade porque o PROPRIO Chart.js tem um cinza padrao parecido
  //quando a cor vem vazia; so ficou obvio quando a borda da pizza caiu no
  //preto padrao do Chart.js em vez do respiro sutil pretendido.
  function corDoTexto(variavel) {
    return getComputedStyle(document.body).getPropertyValue(variavel).trim();
  }

  async function carregar() {
    erroEl.hidden = true;
    vazioEl.hidden = true;
    cardsEl.hidden = false;
    unidadesCardsEl.hidden = false;
    categoriasCardsEl.hidden = false;
    setoresCardsEl.hidden = false;
    solicitantesCardsEl.hidden = false;
    atendentesCardsEl.hidden = false;
    terceirosCardsEl.hidden = false;
    subabasNavEl.hidden = false;

    const desde = paraTextoLocal(periodo.de);
    const ate = paraTextoLocal(periodo.ate);

    //FIM DO DIA: sem isso o dia final ficaria de fora — chamados abertos
    //DEPOIS da meia-noite do ultimo dia escolhido nao entrariam na busca.
    const ateFimDoDia = `${ate}T23:59:59.999`;

    const { data, error } = await supabase
      .from("chamados")
      .select(`
        eh_urgente, abertura_em, fechamento_em, solicitante_id,
        unidade_id, categoria_id,
        unidades(nome), categorias(nome),
        usuarios!chamados_solicitante_id_fkey(nome, sobrenome, setor_id, setores(nome)),
        chamado_membros(usuario_id, usuarios(nome, sobrenome)),
        chamado_terceiros(terceiro_id, terceiros(nome)),
        comentarios(autor_id, criado_em, visibilidade, tipo)
      `)
      .gte("abertura_em", `${desde}T00:00:00`)
      .lte("abertura_em", ateFimDoDia);

    if (error) {
      console.error("Erro ao carregar a análise:", error);
      cardsEl.hidden = true;
      unidadesCardsEl.hidden = true;
      categoriasCardsEl.hidden = true;
      setoresCardsEl.hidden = true;
      solicitantesCardsEl.hidden = true;
      atendentesCardsEl.hidden = true;
      terceirosCardsEl.hidden = true;
      subabasNavEl.hidden = true;
      erroEl.hidden = false;
      erroEl.textContent = "Não foi possível carregar os dados do período. Tente novamente.";
      return;
    }

    const chamados = data ?? [];
    ultimoResultado = chamados;

    if (!chamados.length) {
      cardsEl.hidden = true;
      unidadesCardsEl.hidden = true;
      categoriasCardsEl.hidden = true;
      setoresCardsEl.hidden = true;
      solicitantesCardsEl.hidden = true;
      atendentesCardsEl.hidden = true;
      terceirosCardsEl.hidden = true;
      subabasNavEl.hidden = true;
      vazioEl.hidden = false;
      graficoUnidades?.destroy();
      graficoCategorias?.destroy();
      graficoUnidadesEmpilhado?.destroy();
      graficoUnidadesSla?.destroy();
      graficoCategoriasEmpilhado?.destroy();
      graficoCategoriasSla?.destroy();
      graficoSetoresEmpilhado?.destroy();
      graficoSetoresSla?.destroy();
      graficoSolicitantesEmpilhado?.destroy();
      graficoSolicitantesSla?.destroy();
      graficoAtendentesTotal?.destroy();
      graficoAtendentesSla?.destroy();
      graficoTerceirosTotal?.destroy();
      graficoTerceirosSla?.destroy();
      graficoUnidades = null;
      graficoCategorias = null;
      graficoUnidadesEmpilhado = null;
      graficoUnidadesSla = null;
      graficoCategoriasEmpilhado = null;
      graficoCategoriasSla = null;
      graficoSetoresEmpilhado = null;
      graficoSetoresSla = null;
      graficoSolicitantesEmpilhado = null;
      graficoSolicitantesSla = null;
      graficoAtendentesTotal = null;
      graficoAtendentesSla = null;
      graficoTerceirosTotal = null;
      graficoTerceirosSla = null;
      return;
    }

    // Filtros de unidade/categoria/setor/atendente sao aplicados AGORA,
    // sobre o que a consulta trouxe do periodo — montarFiltroAnalise usa
    // ultimoResultado (sempre o conjunto INTEIRO do periodo, sem filtro)
    // pra montar as opcoes, entao precisa estar atualizado antes.
    montarFiltroAnalise();
    desenharCards(dadosFiltrados());

    const subabaAtual = subabaBotoes.find((botao) => botao.classList.contains("analise-subaba--atual"))
      ?.dataset.analiseSubaba ?? "resumo";
    desenharSubabaAtual(subabaAtual);
  }

  function desenharCards(chamados) {
    const total = chamados.length;
    const urgentes = chamados.filter((chamado) => chamado.eh_urgente).length;
    const percentualUrgentes = total ? (urgentes / total) * 100 : 0;

    //SO CHAMADOS FECHADOS ENTRAM NA CONTA DE TEMPO DE SOLUCAO — um chamado
    //ainda aberto nao tem "tempo de solucao" formado.
    const duracoesEmHoras = chamados
      .filter((chamado) => chamado.fechamento_em)
      .map((chamado) => horasUteisEntre(new Date(chamado.abertura_em), new Date(chamado.fechamento_em)))
      .filter((horas) => horas >= 0);

    const media = duracoesEmHoras.length
      ? duracoesEmHoras.reduce((soma, horas) => soma + horas, 0) / duracoesEmHoras.length
      : null;

    const horasPrimeiraResposta = chamados
      .map(horasAtePrimeiraResposta)
      .filter((horas) => horas != null && horas >= 0);

    const mediaPrimeiraResposta = horasPrimeiraResposta.length
      ? horasPrimeiraResposta.reduce((soma, horas) => soma + horas, 0) / horasPrimeiraResposta.length
      : null;

    secao.querySelector("[data-analise-total]").textContent = total.toLocaleString("pt-BR");
    secao.querySelector("[data-analise-urgentes]").textContent = urgentes.toLocaleString("pt-BR");
    secao.querySelector("[data-analise-percentual-urgentes]").textContent =
      `${percentualUrgentes.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
    secao.querySelector("[data-analise-media]").textContent = formatarDuracao(media);
    secao.querySelector("[data-analise-primeira-resposta]").textContent = formatarDuracao(mediaPrimeiraResposta);
  }

  //AGRUPA E ORDENA DO MAIOR PRO MENOR — mesmo formato dos dois graficos do
  //Power BI (barra de unidade e pizza de categoria).
  function contarPor(chamados, pegarChave) {
    const contagem = new Map();

    chamados.forEach((chamado) => {
      const chave = pegarChave(chamado) ?? "Sem unidade";
      contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
    });

    return [...contagem.entries()].sort((a, b) => b[1] - a[1]);
  }

  function desenharGraficoUnidades(chamados) {
    const dados = contarPor(chamados, (chamado) => chamado.unidades?.nome);
    const texto = corDoTexto("--texto-2");

    graficoUnidades?.destroy();
    graficoUnidades = new Chart(canvasUnidades, {
      type: "bar",
      data: {
        labels: dados.map(([nome]) => nome),
        datasets: [{
          data: dados.map(([, quantidade]) => quantidade),
          backgroundColor: "#dd5b12",
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: espessuraDaBarra(dados.length),
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            beginAtZero: true,
            //SO NUMERO INTEIRO NO EIXO: e contagem de chamados, nunca faz
            //sentido meio ticket — sem isso o Chart.js as vezes escolhe
            //passo decimal (0,2/0,4/...) quando a barra maior e pequena.
            ticks: { color: texto, precision: 0, padding: 6 },
            //SEM LINHAS DE GRADE VERTICAIS: poluiam o fundo do grafico
            //sem ajudar em nada (as barras ja tem os proprios numeros do
            //eixo, nao precisa contar quadradinho) — pedido do usuario.
            grid: { display: false },
          },
          y: { ticks: { color: texto, padding: 8 }, grid: { display: false } },
        },
      },
    });
  }

  function desenharGraficoCategorias(chamados) {
    const dados = contarPor(chamados, (chamado) => chamado.categorias?.nome);
    const texto = corDoTexto("--texto-2");

    const fundoDoCard = corDoTexto("--superficie");

    graficoCategorias?.destroy();
    graficoCategorias = new Chart(canvasCategorias, {
      type: "doughnut",
      data: {
        labels: dados.map(([nome]) => nome),
        datasets: [{
          data: dados.map(([, quantidade]) => quantidade),
          backgroundColor: dados.map((_, indice) => CORES_GRAFICO[indice % CORES_GRAFICO.length]),
          borderRadius: 4,
          // A "borda" aqui e so um respiro entre fatias vizinhas — usa a
          // cor do proprio card (nao branco fixo), senao no tema escuro
          // sobraria uma linha branca cortando o grafico.
          borderColor: fundoDoCard,
          borderWidth: 2,
          hoverOffset: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: texto, boxWidth: 10, boxHeight: 10, padding: 14, font: { weight: "500" } },
          },
        },
      },
    });
  }

  //AGRUPA CHAMADOS POR UNIDADE (o array inteiro, nao so a contagem) —
  //base pros 3 cards e pros 2 graficos da sub-aba Unidades, que precisam
  //olhar urgencia e tempo de solucao, nao so quantidade.
  function agruparPorUnidade(chamados) {
    const grupos = new Map();

    chamados.forEach((chamado) => {
      const nome = chamado.unidades?.nome ?? "Sem unidade";
      if (!grupos.has(nome)) grupos.set(nome, []);
      grupos.get(nome).push(chamado);
    });

    return grupos;
  }

  function desenharCardsDeUnidades(chamados) {
    const grupos = agruparPorUnidade(chamados);

    let maisChamados = null;
    let maisUrgente = null;
    let maiorSla = null;

    grupos.forEach((chamadosDaUnidade, nome) => {
      const total = chamadosDaUnidade.length;

      if (!maisChamados || total > maisChamados.valor) {
        maisChamados = { nome, valor: total };
      }

      const urgentes = chamadosDaUnidade.filter((chamado) => chamado.eh_urgente).length;
      const percentualUrgentes = total ? (urgentes / total) * 100 : 0;

      if (!maisUrgente || percentualUrgentes > maisUrgente.valor) {
        maisUrgente = { nome, valor: percentualUrgentes };
      }

      const duracoes = chamadosDaUnidade
        .filter((chamado) => chamado.fechamento_em)
        .map((chamado) => horasUteisEntre(new Date(chamado.abertura_em), new Date(chamado.fechamento_em)))
        .filter((horas) => horas >= 0);

      // So compara unidades que TEM chamado fechado no periodo — sem
      // nenhum tempo de solucao formado, a unidade nao entra nessa
      // comparacao (mesmo criterio do card "Media de solucao" do Resumo).
      if (duracoes.length) {
        const media = duracoes.reduce((soma, horas) => soma + horas, 0) / duracoes.length;
        if (!maiorSla || media > maiorSla.valor) {
          maiorSla = { nome, valor: media };
        }
      }
    });

    secao.querySelector("[data-analise-unidade-mais-chamados]").textContent =
      maisChamados ? `${maisChamados.nome} (${maisChamados.valor.toLocaleString("pt-BR")})` : "—";
    secao.querySelector("[data-analise-unidade-mais-urgente]").textContent =
      maisUrgente ? `${maisUrgente.nome} (${maisUrgente.valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%)` : "—";
    secao.querySelector("[data-analise-unidade-maior-sla]").textContent =
      maiorSla ? `${maiorSla.nome} (${formatarDuracao(maiorSla.valor)})` : "—";
  }

  function desenharGraficoUnidadesEmpilhado(chamados) {
    const grupos = agruparPorUnidade(chamados);

    // Ordena pelo TOTAL (normal + urgente), maior pro menor — mesma ordem
    // do grafico da aba Resumo, so que aqui cada barra vira duas fatias.
    const linhas = [...grupos.entries()]
      .map(([nome, doGrupo]) => ({
        nome,
        normais: doGrupo.filter((chamado) => !chamado.eh_urgente).length,
        urgentes: doGrupo.filter((chamado) => chamado.eh_urgente).length,
      }))
      .sort((a, b) => (b.normais + b.urgentes) - (a.normais + a.urgentes));

    const texto = corDoTexto("--texto-2");

    //CINZA/VERMELHO FIXOS (nao tokens de tema): sao cores de DADO aqui —
    //"normal" e "urgente" tem que parecer a mesma coisa claro ou escuro,
    //diferente de --texto-4 (que existe pra legibilidade de texto e muda
    //de tom entre os temas).
    const espessura = espessuraDaBarra(linhas.length);

    const CANTO_ESQUERDO = { topLeft: 6, bottomLeft: 6, topRight: 0, bottomRight: 0 };
    const CANTO_DIREITO = { topLeft: 0, bottomLeft: 0, topRight: 6, bottomRight: 6 };
    const CANTO_TODOS = { topLeft: 6, bottomLeft: 6, topRight: 6, bottomRight: 6 };

    graficoUnidadesEmpilhado?.destroy();
    graficoUnidadesEmpilhado = new Chart(canvasUnidadesEmpilhado, {
      type: "bar",
      data: {
        labels: linhas.map((linha) => linha.nome),
        datasets: [
          {
            label: "Normal",
            data: linhas.map((linha) => linha.normais),
            backgroundColor: "#9a9aa2",
            stack: "total",
            maxBarThickness: espessura,
            // A ponta ESQUERDA (comeco da barra) sempre arredonda. A
            // DIREITA so arredonda quando a linha NAO tem segmento
            // "Urgente" — com valor 0 o Chart.js nao desenha nada nesse
            // dataset, entao sem isso a ponta direita do "Normal" ficava
            // reta (Diadema/Sao Jose no exemplo do usuario, sem urgente).
            // Com "Urgente" > 0, o proprio dataset dele cuida da ponta
            // direita — arredondar aqui tambem deixaria um vao no meio.
            borderRadius: linhas.map((linha) => (linha.urgentes ? CANTO_ESQUERDO : CANTO_TODOS)),
            borderSkipped: false,
          },
          {
            label: "Urgente",
            data: linhas.map((linha) => linha.urgentes),
            backgroundColor: "#e5484d",
            stack: "total",
            maxBarThickness: espessura,
            // So a ponta DIREITA (fim da barra) — o "Normal" ja cobre a
            // esquerda, e so ele mesmo cobre a direita quando existe.
            borderRadius: linhas.map(() => CANTO_DIREITO),
            borderSkipped: false,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "top",
            align: "start",
            labels: { color: texto, boxWidth: 10, boxHeight: 10, padding: 14, font: { weight: "500" } },
          },
        },
        scales: {
          x: {
            stacked: true,
            beginAtZero: true,
            ticks: { color: texto, precision: 0, padding: 6 },
            grid: { display: false },
          },
          y: { stacked: true, ticks: { color: texto, padding: 8 }, grid: { display: false } },
        },
      },
    });
  }

  function desenharGraficoUnidadesSla(chamados) {
    const grupos = agruparPorUnidade(chamados);

    const linhas = [...grupos.entries()]
      .map(([nome, doGrupo]) => {
        const duracoes = doGrupo
          .filter((chamado) => chamado.fechamento_em)
          .map((chamado) => horasUteisEntre(new Date(chamado.abertura_em), new Date(chamado.fechamento_em)))
          .filter((horas) => horas >= 0);

        const media = duracoes.length
          ? duracoes.reduce((soma, horas) => soma + horas, 0) / duracoes.length
          : null;

        return { nome, media };
      })
      // Fora as unidades sem nenhum chamado fechado — nao tem media pra
      // mostrar, uma barra de altura zero so confundiria.
      .filter((linha) => linha.media != null)
      .sort((a, b) => b.media - a.media);

    const texto = corDoTexto("--texto-2");

    graficoUnidadesSla?.destroy();
    graficoUnidadesSla = new Chart(canvasUnidadesSla, {
      type: "bar",
      data: {
        labels: linhas.map((linha) => linha.nome),
        datasets: [{
          data: linhas.map((linha) => Math.round(linha.media * 10) / 10),
          backgroundColor: "#dd5b12",
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: espessuraDaBarra(linhas.length),
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { color: texto, padding: 6 }, grid: { display: false } },
          y: { ticks: { color: texto, padding: 8 }, grid: { display: false } },
        },
      },
    });
  }

  //CATEGORIAS: mesma ideia de agruparPorUnidade/desenharCardsDeUnidades/
  //desenharGraficoUnidadesEmpilhado/desenharGraficoUnidadesSla, so
  //trocando a chave de agrupamento (categoria em vez de unidade).
  function agruparPorCategoria(chamados) {
    const grupos = new Map();

    chamados.forEach((chamado) => {
      const nome = chamado.categorias?.nome ?? "Sem categoria";
      if (!grupos.has(nome)) grupos.set(nome, []);
      grupos.get(nome).push(chamado);
    });

    return grupos;
  }

  function desenharCardsDeCategorias(chamados) {
    const grupos = agruparPorCategoria(chamados);

    let maisChamados = null;
    let maisUrgente = null;
    let maiorSla = null;

    grupos.forEach((chamadosDaCategoria, nome) => {
      const total = chamadosDaCategoria.length;

      if (!maisChamados || total > maisChamados.valor) {
        maisChamados = { nome, valor: total };
      }

      const urgentes = chamadosDaCategoria.filter((chamado) => chamado.eh_urgente).length;
      const percentualUrgentes = total ? (urgentes / total) * 100 : 0;

      if (!maisUrgente || percentualUrgentes > maisUrgente.valor) {
        maisUrgente = { nome, valor: percentualUrgentes };
      }

      const duracoes = chamadosDaCategoria
        .filter((chamado) => chamado.fechamento_em)
        .map((chamado) => horasUteisEntre(new Date(chamado.abertura_em), new Date(chamado.fechamento_em)))
        .filter((horas) => horas >= 0);

      // So compara categorias que TEM chamado fechado no periodo — mesmo
      // criterio do card "Media de solucao" do Resumo.
      if (duracoes.length) {
        const media = duracoes.reduce((soma, horas) => soma + horas, 0) / duracoes.length;
        if (!maiorSla || media > maiorSla.valor) {
          maiorSla = { nome, valor: media };
        }
      }
    });

    secao.querySelector("[data-analise-categoria-mais-chamados]").textContent =
      maisChamados ? `${maisChamados.nome} (${maisChamados.valor.toLocaleString("pt-BR")})` : "—";
    secao.querySelector("[data-analise-categoria-mais-urgente]").textContent =
      maisUrgente ? `${maisUrgente.nome} (${maisUrgente.valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%)` : "—";
    secao.querySelector("[data-analise-categoria-maior-sla]").textContent =
      maiorSla ? `${maiorSla.nome} (${formatarDuracao(maiorSla.valor)})` : "—";
  }

  function desenharGraficoCategoriasEmpilhado(chamados) {
    const grupos = agruparPorCategoria(chamados);

    const linhas = [...grupos.entries()]
      .map(([nome, doGrupo]) => ({
        nome,
        normais: doGrupo.filter((chamado) => !chamado.eh_urgente).length,
        urgentes: doGrupo.filter((chamado) => chamado.eh_urgente).length,
      }))
      .sort((a, b) => (b.normais + b.urgentes) - (a.normais + a.urgentes));

    const texto = corDoTexto("--texto-2");
    const espessura = espessuraDaBarra(linhas.length);

    const CANTO_ESQUERDO = { topLeft: 6, bottomLeft: 6, topRight: 0, bottomRight: 0 };
    const CANTO_DIREITO = { topLeft: 0, bottomLeft: 0, topRight: 6, bottomRight: 6 };
    const CANTO_TODOS = { topLeft: 6, bottomLeft: 6, topRight: 6, bottomRight: 6 };

    graficoCategoriasEmpilhado?.destroy();
    graficoCategoriasEmpilhado = new Chart(canvasCategoriasEmpilhado, {
      type: "bar",
      data: {
        labels: linhas.map((linha) => linha.nome),
        datasets: [
          {
            label: "Normal",
            data: linhas.map((linha) => linha.normais),
            backgroundColor: "#9a9aa2",
            stack: "total",
            maxBarThickness: espessura,
            // Mesma logica do grafico de unidades: a ponta direita so
            // arredonda sozinha quando nao ha segmento "Urgente" pra
            // cobri-la (valor 0 nao desenha nada nesse dataset).
            borderRadius: linhas.map((linha) => (linha.urgentes ? CANTO_ESQUERDO : CANTO_TODOS)),
            borderSkipped: false,
          },
          {
            label: "Urgente",
            data: linhas.map((linha) => linha.urgentes),
            backgroundColor: "#e5484d",
            stack: "total",
            maxBarThickness: espessura,
            borderRadius: linhas.map(() => CANTO_DIREITO),
            borderSkipped: false,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "top",
            align: "start",
            labels: { color: texto, boxWidth: 10, boxHeight: 10, padding: 14, font: { weight: "500" } },
          },
        },
        scales: {
          x: {
            stacked: true,
            beginAtZero: true,
            ticks: { color: texto, precision: 0, padding: 6 },
            grid: { display: false },
          },
          y: { stacked: true, ticks: { color: texto, padding: 8 }, grid: { display: false } },
        },
      },
    });
  }

  function desenharGraficoCategoriasSla(chamados) {
    const grupos = agruparPorCategoria(chamados);

    const linhas = [...grupos.entries()]
      .map(([nome, doGrupo]) => {
        const duracoes = doGrupo
          .filter((chamado) => chamado.fechamento_em)
          .map((chamado) => horasUteisEntre(new Date(chamado.abertura_em), new Date(chamado.fechamento_em)))
          .filter((horas) => horas >= 0);

        const media = duracoes.length
          ? duracoes.reduce((soma, horas) => soma + horas, 0) / duracoes.length
          : null;

        return { nome, media };
      })
      // Fora as categorias sem nenhum chamado fechado no periodo.
      .filter((linha) => linha.media != null)
      .sort((a, b) => b.media - a.media);

    const texto = corDoTexto("--texto-2");

    graficoCategoriasSla?.destroy();
    graficoCategoriasSla = new Chart(canvasCategoriasSla, {
      type: "bar",
      data: {
        labels: linhas.map((linha) => linha.nome),
        datasets: [{
          data: linhas.map((linha) => Math.round(linha.media * 10) / 10),
          backgroundColor: "#dd5b12",
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: espessuraDaBarra(linhas.length),
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { color: texto, padding: 6 }, grid: { display: false } },
          y: { ticks: { color: texto, padding: 8 }, grid: { display: false } },
        },
      },
    });
  }

  //SETORES: mesma ideia de agruparPorUnidade/agruparPorCategoria, so que
  //o setor NAO e um campo direto do chamado — vem do solicitante
  //(chamado.usuarios.setores.nome), por isso a consulta em carregar()
  //precisou trazer usuarios!chamados_solicitante_id_fkey(setores(nome))
  //a mais do que ja buscava pra Unidades/Categorias.
  function agruparPorSetor(chamados) {
    const grupos = new Map();

    chamados.forEach((chamado) => {
      const nome = chamado.usuarios?.setores?.nome ?? "Sem setor";
      if (!grupos.has(nome)) grupos.set(nome, []);
      grupos.get(nome).push(chamado);
    });

    return grupos;
  }

  function desenharCardsDeSetores(chamados) {
    const grupos = agruparPorSetor(chamados);

    let maisChamados = null;
    let maisUrgente = null;
    let maiorSla = null;

    grupos.forEach((chamadosDoSetor, nome) => {
      const total = chamadosDoSetor.length;

      if (!maisChamados || total > maisChamados.valor) {
        maisChamados = { nome, valor: total };
      }

      const urgentes = chamadosDoSetor.filter((chamado) => chamado.eh_urgente).length;
      const percentualUrgentes = total ? (urgentes / total) * 100 : 0;

      if (!maisUrgente || percentualUrgentes > maisUrgente.valor) {
        maisUrgente = { nome, valor: percentualUrgentes };
      }

      const duracoes = chamadosDoSetor
        .filter((chamado) => chamado.fechamento_em)
        .map((chamado) => horasUteisEntre(new Date(chamado.abertura_em), new Date(chamado.fechamento_em)))
        .filter((horas) => horas >= 0);

      // So compara setores que TEM chamado fechado no periodo — mesmo
      // criterio do card "Media de solucao" do Resumo.
      if (duracoes.length) {
        const media = duracoes.reduce((soma, horas) => soma + horas, 0) / duracoes.length;
        if (!maiorSla || media > maiorSla.valor) {
          maiorSla = { nome, valor: media };
        }
      }
    });

    secao.querySelector("[data-analise-setor-mais-chamados]").textContent =
      maisChamados ? `${maisChamados.nome} (${maisChamados.valor.toLocaleString("pt-BR")})` : "—";
    secao.querySelector("[data-analise-setor-mais-urgente]").textContent =
      maisUrgente ? `${maisUrgente.nome} (${maisUrgente.valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%)` : "—";
    secao.querySelector("[data-analise-setor-maior-sla]").textContent =
      maiorSla ? `${maiorSla.nome} (${formatarDuracao(maiorSla.valor)})` : "—";
  }

  function desenharGraficoSetoresEmpilhado(chamados) {
    const grupos = agruparPorSetor(chamados);

    const linhas = [...grupos.entries()]
      .map(([nome, doGrupo]) => ({
        nome,
        normais: doGrupo.filter((chamado) => !chamado.eh_urgente).length,
        urgentes: doGrupo.filter((chamado) => chamado.eh_urgente).length,
      }))
      .sort((a, b) => (b.normais + b.urgentes) - (a.normais + a.urgentes));

    const texto = corDoTexto("--texto-2");
    const espessura = espessuraDaBarra(linhas.length);

    const CANTO_ESQUERDO = { topLeft: 6, bottomLeft: 6, topRight: 0, bottomRight: 0 };
    const CANTO_DIREITO = { topLeft: 0, bottomLeft: 0, topRight: 6, bottomRight: 6 };
    const CANTO_TODOS = { topLeft: 6, bottomLeft: 6, topRight: 6, bottomRight: 6 };

    graficoSetoresEmpilhado?.destroy();
    graficoSetoresEmpilhado = new Chart(canvasSetoresEmpilhado, {
      type: "bar",
      data: {
        labels: linhas.map((linha) => linha.nome),
        datasets: [
          {
            label: "Normal",
            data: linhas.map((linha) => linha.normais),
            backgroundColor: "#9a9aa2",
            stack: "total",
            maxBarThickness: espessura,
            // Mesma logica de Unidades/Categorias: a ponta direita so
            // arredonda sozinha quando nao ha segmento "Urgente" pra
            // cobri-la (valor 0 nao desenha nada nesse dataset).
            borderRadius: linhas.map((linha) => (linha.urgentes ? CANTO_ESQUERDO : CANTO_TODOS)),
            borderSkipped: false,
          },
          {
            label: "Urgente",
            data: linhas.map((linha) => linha.urgentes),
            backgroundColor: "#e5484d",
            stack: "total",
            maxBarThickness: espessura,
            borderRadius: linhas.map(() => CANTO_DIREITO),
            borderSkipped: false,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "top",
            align: "start",
            labels: { color: texto, boxWidth: 10, boxHeight: 10, padding: 14, font: { weight: "500" } },
          },
        },
        scales: {
          x: {
            stacked: true,
            beginAtZero: true,
            ticks: { color: texto, precision: 0, padding: 6 },
            grid: { display: false },
          },
          y: { stacked: true, ticks: { color: texto, padding: 8 }, grid: { display: false } },
        },
      },
    });
  }

  function desenharGraficoSetoresSla(chamados) {
    const grupos = agruparPorSetor(chamados);

    const linhas = [...grupos.entries()]
      .map(([nome, doGrupo]) => {
        const duracoes = doGrupo
          .filter((chamado) => chamado.fechamento_em)
          .map((chamado) => horasUteisEntre(new Date(chamado.abertura_em), new Date(chamado.fechamento_em)))
          .filter((horas) => horas >= 0);

        const media = duracoes.length
          ? duracoes.reduce((soma, horas) => soma + horas, 0) / duracoes.length
          : null;

        return { nome, media };
      })
      // Fora os setores sem nenhum chamado fechado no periodo.
      .filter((linha) => linha.media != null)
      .sort((a, b) => b.media - a.media);

    const texto = corDoTexto("--texto-2");

    graficoSetoresSla?.destroy();
    graficoSetoresSla = new Chart(canvasSetoresSla, {
      type: "bar",
      data: {
        labels: linhas.map((linha) => linha.nome),
        datasets: [{
          data: linhas.map((linha) => Math.round(linha.media * 10) / 10),
          backgroundColor: "#dd5b12",
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: espessuraDaBarra(linhas.length),
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { color: texto, padding: 6 }, grid: { display: false } },
          y: { ticks: { color: texto, padding: 8 }, grid: { display: false } },
        },
      },
    });
  }

  //SOLICITANTES: mesma ideia de agruparPorSetor, so que a chave e quem
  //abriu o chamado (nomeCompleto de chamado.usuarios, ja importado de
  //chamado-comum.js — mesma funcao que o Portal usa pro mesmo dado).
  //LIMITE DE 10: diferente de unidade/categoria/setor (poucas opcoes
  //fixas), solicitante pode ser dezenas de pessoas diferentes — sem
  //limite os graficos de barra ficariam ilegiveis. So os graficos
  //cortam em 10; os CARDS de destaque continuam olhando todo mundo.
  const LIMITE_SOLICITANTES_NO_GRAFICO = 10;

  function agruparPorSolicitante(chamados) {
    const grupos = new Map();

    chamados.forEach((chamado) => {
      const nome = nomeCompleto(chamado.usuarios) ?? "Sem solicitante";
      if (!grupos.has(nome)) grupos.set(nome, []);
      grupos.get(nome).push(chamado);
    });

    return grupos;
  }

  function desenharCardsDeSolicitantes(chamados) {
    const grupos = agruparPorSolicitante(chamados);

    let maisChamados = null;
    let maisUrgente = null;
    let maiorSla = null;

    grupos.forEach((chamadosDoSolicitante, nome) => {
      const total = chamadosDoSolicitante.length;

      if (!maisChamados || total > maisChamados.valor) {
        maisChamados = { nome, valor: total };
      }

      const urgentes = chamadosDoSolicitante.filter((chamado) => chamado.eh_urgente).length;
      const percentualUrgentes = total ? (urgentes / total) * 100 : 0;

      if (!maisUrgente || percentualUrgentes > maisUrgente.valor) {
        maisUrgente = { nome, valor: percentualUrgentes };
      }

      const duracoes = chamadosDoSolicitante
        .filter((chamado) => chamado.fechamento_em)
        .map((chamado) => horasUteisEntre(new Date(chamado.abertura_em), new Date(chamado.fechamento_em)))
        .filter((horas) => horas >= 0);

      // So compara solicitantes que TEM chamado fechado no periodo —
      // mesmo criterio do card "Media de solucao" do Resumo.
      if (duracoes.length) {
        const media = duracoes.reduce((soma, horas) => soma + horas, 0) / duracoes.length;
        if (!maiorSla || media > maiorSla.valor) {
          maiorSla = { nome, valor: media };
        }
      }
    });

    secao.querySelector("[data-analise-solicitante-mais-chamados]").textContent =
      maisChamados ? `${maisChamados.nome} (${maisChamados.valor.toLocaleString("pt-BR")})` : "—";
    secao.querySelector("[data-analise-solicitante-mais-urgente]").textContent =
      maisUrgente ? `${maisUrgente.nome} (${maisUrgente.valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%)` : "—";
    secao.querySelector("[data-analise-solicitante-maior-sla]").textContent =
      maiorSla ? `${maiorSla.nome} (${formatarDuracao(maiorSla.valor)})` : "—";
  }

  function desenharGraficoSolicitantesEmpilhado(chamados) {
    const grupos = agruparPorSolicitante(chamados);

    const linhas = [...grupos.entries()]
      .map(([nome, doGrupo]) => ({
        nome,
        normais: doGrupo.filter((chamado) => !chamado.eh_urgente).length,
        urgentes: doGrupo.filter((chamado) => chamado.eh_urgente).length,
      }))
      .sort((a, b) => (b.normais + b.urgentes) - (a.normais + a.urgentes))
      .slice(0, LIMITE_SOLICITANTES_NO_GRAFICO);

    const texto = corDoTexto("--texto-2");
    const espessura = espessuraDaBarra(linhas.length);

    const CANTO_ESQUERDO = { topLeft: 6, bottomLeft: 6, topRight: 0, bottomRight: 0 };
    const CANTO_DIREITO = { topLeft: 0, bottomLeft: 0, topRight: 6, bottomRight: 6 };
    const CANTO_TODOS = { topLeft: 6, bottomLeft: 6, topRight: 6, bottomRight: 6 };

    graficoSolicitantesEmpilhado?.destroy();
    graficoSolicitantesEmpilhado = new Chart(canvasSolicitantesEmpilhado, {
      type: "bar",
      data: {
        labels: linhas.map((linha) => linha.nome),
        datasets: [
          {
            label: "Normal",
            data: linhas.map((linha) => linha.normais),
            backgroundColor: "#9a9aa2",
            stack: "total",
            maxBarThickness: espessura,
            // Mesma logica das outras sub-abas: a ponta direita so
            // arredonda sozinha quando nao ha segmento "Urgente" pra
            // cobri-la (valor 0 nao desenha nada nesse dataset).
            borderRadius: linhas.map((linha) => (linha.urgentes ? CANTO_ESQUERDO : CANTO_TODOS)),
            borderSkipped: false,
          },
          {
            label: "Urgente",
            data: linhas.map((linha) => linha.urgentes),
            backgroundColor: "#e5484d",
            stack: "total",
            maxBarThickness: espessura,
            borderRadius: linhas.map(() => CANTO_DIREITO),
            borderSkipped: false,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "top",
            align: "start",
            labels: { color: texto, boxWidth: 10, boxHeight: 10, padding: 14, font: { weight: "500" } },
          },
        },
        scales: {
          x: {
            stacked: true,
            beginAtZero: true,
            ticks: { color: texto, precision: 0, padding: 6 },
            grid: { display: false },
          },
          y: { stacked: true, ticks: { color: texto, padding: 8 }, grid: { display: false } },
        },
      },
    });
  }

  function desenharGraficoSolicitantesSla(chamados) {
    const grupos = agruparPorSolicitante(chamados);

    const linhas = [...grupos.entries()]
      .map(([nome, doGrupo]) => {
        const duracoes = doGrupo
          .filter((chamado) => chamado.fechamento_em)
          .map((chamado) => horasUteisEntre(new Date(chamado.abertura_em), new Date(chamado.fechamento_em)))
          .filter((horas) => horas >= 0);

        const media = duracoes.length
          ? duracoes.reduce((soma, horas) => soma + horas, 0) / duracoes.length
          : null;

        return { nome, media };
      })
      // Fora os solicitantes sem nenhum chamado fechado no periodo.
      .filter((linha) => linha.media != null)
      .sort((a, b) => b.media - a.media)
      .slice(0, LIMITE_SOLICITANTES_NO_GRAFICO);

    const texto = corDoTexto("--texto-2");

    graficoSolicitantesSla?.destroy();
    graficoSolicitantesSla = new Chart(canvasSolicitantesSla, {
      type: "bar",
      data: {
        labels: linhas.map((linha) => linha.nome),
        datasets: [{
          data: linhas.map((linha) => Math.round(linha.media * 10) / 10),
          backgroundColor: "#dd5b12",
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: espessuraDaBarra(linhas.length),
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { color: texto, padding: 6 }, grid: { display: false } },
          y: { ticks: { color: texto, padding: 8 }, grid: { display: false } },
        },
      },
    });
  }

  //ATENDENTES: DIFERENTE das outras sub-abas — um chamado pode ter VARIOS
  //atendentes ao mesmo tempo (chamado_membros e N:N, nao um campo unico
  //como unidade/categoria/setor/solicitante). Por isso o mesmo chamado
  //entra no grupo de CADA atendente nele, sem dividir/ratear — se dois
  //atendentes estao no mesmo chamado, os dois "ganham" esse chamado na
  //contagem, nao meio chamado cada.
  //Guarda { pessoa, chamados } por atendente, nao so a lista de chamados —
  //o rotulo do grafico precisa do PRIMEIRO NOME de verdade (campo `nome`
  //no banco, que pode ter mais de uma palavra: "João Gabriel"), nao um
  //split(" ")[0] ingenuo em cima do nome completo (cortaria "João
  //Gabriel Arantes" em so "João", perdendo metade do primeiro nome).
  //
  //REGRA DO TERCEIRO (decisao do usuario): um chamado que tem QUALQUER
  //terceiro vinculado (chamado_terceiros) sai do SLA dos atendentes
  //internos — passa a contar so na sub-aba Terceiros, nunca aqui, mesmo
  //que tambem tenha gente da equipe no mesmo chamado. Ex.: Enzo + Vivo no
  //mesmo chamado -> nao entra no grupo do Enzo, so no da Vivo. E sem
  //excecao por quantidade: 2 internos + 1 terceiro tambem sai dos dois
  //internos, nao so de um.
  function agruparPorAtendente(chamados) {
    const grupos = new Map();

    chamados
      .filter((chamado) => !chamado.chamado_terceiros?.length)
      .forEach((chamado) => {
        chamado.chamado_membros.forEach((membro) => {
          if (!membro.usuarios) return;
          const nome = nomeCompleto(membro.usuarios) ?? "Alguém";
          if (!grupos.has(nome)) grupos.set(nome, { pessoa: membro.usuarios, chamados: [] });
          grupos.get(nome).chamados.push(chamado);
        });
      });

    return grupos;
  }

  //TERCEIROS: espelha agruparPorAtendente, so que por fornecedor
  //(chamado_terceiros) em vez de por pessoa da equipe (chamado_membros).
  //Aqui NAO ha filtro de exclusao — e o oposto do de atendente: so entra
  //quem TEM terceiro, que e exatamente quem o grupo de atendente descarta.
  function agruparPorTerceiro(chamados) {
    const grupos = new Map();

    chamados.forEach((chamado) => {
      (chamado.chamado_terceiros ?? []).forEach((vinculo) => {
        const fornecedor = vinculo.terceiros;

        if (!fornecedor?.nome) return;

        if (!grupos.has(fornecedor.nome)) grupos.set(fornecedor.nome, { pessoa: fornecedor, chamados: [] });
        grupos.get(fornecedor.nome).chamados.push(chamado);
      });
    });

    return grupos;
  }

  function desenharCardsDeAtendentes(chamados) {
    const grupos = agruparPorAtendente(chamados);

    let maisChamados = null;
    let maisUrgente = null;
    let maiorSla = null;
    let melhorResposta = null;

    grupos.forEach(({ chamados: chamadosDoAtendente }, nome) => {
      const total = chamadosDoAtendente.length;

      if (!maisChamados || total > maisChamados.valor) {
        maisChamados = { nome, valor: total };
      }

      const urgentes = chamadosDoAtendente.filter((chamado) => chamado.eh_urgente).length;
      const percentualUrgentes = total ? (urgentes / total) * 100 : 0;

      if (!maisUrgente || percentualUrgentes > maisUrgente.valor) {
        maisUrgente = { nome, valor: percentualUrgentes };
      }

      const duracoes = chamadosDoAtendente
        .filter((chamado) => chamado.fechamento_em)
        .map((chamado) => horasUteisEntre(new Date(chamado.abertura_em), new Date(chamado.fechamento_em)));

      if (duracoes.length) {
        const media = duracoes.reduce((soma, horas) => soma + horas, 0) / duracoes.length;
        if (!maiorSla || media > maiorSla.valor) {
          maiorSla = { nome, valor: media };
        }
      }

      const respostas = chamadosDoAtendente
        .map(horasAtePrimeiraResposta)
        .filter((horas) => horas != null);

      // "MELHOR" primeira resposta = MENOR tempo (mais rapido) — unico
      // card da pagina onde o numero menor e o destaque, nao o maior.
      if (respostas.length) {
        const media = respostas.reduce((soma, horas) => soma + horas, 0) / respostas.length;
        if (!melhorResposta || media < melhorResposta.valor) {
          melhorResposta = { nome, valor: media };
        }
      }
    });

    secao.querySelector("[data-analise-atendente-mais-chamados]").textContent =
      maisChamados ? `${maisChamados.nome} (${maisChamados.valor.toLocaleString("pt-BR")})` : "—";
    secao.querySelector("[data-analise-atendente-mais-urgente]").textContent =
      maisUrgente ? `${maisUrgente.nome} (${maisUrgente.valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%)` : "—";
    secao.querySelector("[data-analise-atendente-maior-sla]").textContent =
      maiorSla ? `${maiorSla.nome} (${formatarDuracao(maiorSla.valor)})` : "—";
    secao.querySelector("[data-analise-atendente-melhor-resposta]").textContent =
      melhorResposta ? `${melhorResposta.nome} (${formatarDuracao(melhorResposta.valor)})` : "—";
  }

  //GRAFICOS DE COLUNA (EM PE): pedido explicito do usuario — as outras
  //sub-abas usam barra deitada (indexAxis: "y"), aqui e indexAxis: "x"
  //(o padrao do Chart.js), rotulos no eixo X embaixo de cada coluna.
  function desenharGraficoAtendentesTotal(chamados) {
    const grupos = agruparPorAtendente(chamados);

    const linhas = [...grupos.entries()]
      .map(([nome, { pessoa, chamados: doGrupo }]) => ({ nome, rotulo: primeiroNome(pessoa), total: doGrupo.length }))
      .sort((a, b) => b.total - a.total);

    const texto = corDoTexto("--texto-2");

    graficoAtendentesTotal?.destroy();
    graficoAtendentesTotal = new Chart(canvasAtendentesTotal, {
      type: "bar",
      data: {
        //SO O PRIMEIRO NOME NO EIXO, igual ao Power BI de referencia — os
        //cards de destaque continuam com nome completo (precisam
        //diferenciar duas pessoas de primeiro nome igual), so o ROTULO do
        //grafico que fica curto. Usa primeiroNome(pessoa) — o campo `nome`
        //de verdade no banco, nao um split(" ")[0] em cima do nome
        //completo (cortaria "João Gabriel Arantes" em so "João").
        labels: linhas.map((linha) => linha.rotulo),
        datasets: [{
          data: linhas.map((linha) => linha.total),
          backgroundColor: "#dd5b12",
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 48,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          //MAXROTATION 0: nome curto (so o primeiro) cabe na horizontal —
          //sem isso o Chart.js as vezes gira o rotulo na diagonal quando
          //acha que precisa de mais espaco, o que nao combina com o
          //padrao "empilhado reto" do BI de referencia.
          x: { ticks: { color: texto, padding: 8, maxRotation: 0, minRotation: 0 }, grid: { display: false } },
          y: {
            beginAtZero: true,
            ticks: { color: texto, precision: 0, padding: 6 },
            grid: { display: false },
          },
        },
      },
    });
  }

  function desenharGraficoAtendentesSla(chamados) {
    const grupos = agruparPorAtendente(chamados);

    const linhas = [...grupos.entries()]
      .map(([nome, { pessoa, chamados: doGrupo }]) => {
        const duracoes = doGrupo
          .filter((chamado) => chamado.fechamento_em)
          .map((chamado) => horasUteisEntre(new Date(chamado.abertura_em), new Date(chamado.fechamento_em)));

        const media = duracoes.length
          ? duracoes.reduce((soma, horas) => soma + horas, 0) / duracoes.length
          : null;

        return { nome, rotulo: primeiroNome(pessoa), media };
      })
      .filter((linha) => linha.media != null)
      .sort((a, b) => b.media - a.media);

    const texto = corDoTexto("--texto-2");

    graficoAtendentesSla?.destroy();
    graficoAtendentesSla = new Chart(canvasAtendentesSla, {
      type: "bar",
      data: {
        //SO O PRIMEIRO NOME NO EIXO — mesmo motivo do grafico de total.
        labels: linhas.map((linha) => linha.rotulo),
        datasets: [{
          data: linhas.map((linha) => Math.round(linha.media * 10) / 10),
          backgroundColor: "#dd5b12",
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 48,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: texto, padding: 8, maxRotation: 0, minRotation: 0 }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: texto, padding: 6 }, grid: { display: false } },
        },
      },
    });
  }

  /* ------------------------------------------------------------------
     TERCEIROS: espelha Atendentes de ponta a ponta (cards, os dois
     graficos de coluna), so trocando agruparPorAtendente por
     agruparPorTerceiro — que ja filtra os chamados certos (so quem TEM
     terceiro vinculado, nunca os que so tem gente da equipe).
     ------------------------------------------------------------------ */

  function desenharCardsDeTerceiros(chamados) {
    const grupos = agruparPorTerceiro(chamados);

    let maisChamados = null;
    let maisUrgente = null;
    let maiorSla = null;
    let melhorResposta = null;

    grupos.forEach(({ chamados: chamadosDoTerceiro }, nome) => {
      const total = chamadosDoTerceiro.length;

      if (!maisChamados || total > maisChamados.valor) {
        maisChamados = { nome, valor: total };
      }

      const urgentes = chamadosDoTerceiro.filter((chamado) => chamado.eh_urgente).length;
      const percentualUrgentes = total ? (urgentes / total) * 100 : 0;

      if (!maisUrgente || percentualUrgentes > maisUrgente.valor) {
        maisUrgente = { nome, valor: percentualUrgentes };
      }

      const duracoes = chamadosDoTerceiro
        .filter((chamado) => chamado.fechamento_em)
        .map((chamado) => horasUteisEntre(new Date(chamado.abertura_em), new Date(chamado.fechamento_em)));

      if (duracoes.length) {
        const media = duracoes.reduce((soma, horas) => soma + horas, 0) / duracoes.length;
        if (!maiorSla || media > maiorSla.valor) {
          maiorSla = { nome, valor: media };
        }
      }

      const respostas = chamadosDoTerceiro
        .map(horasAtePrimeiraResposta)
        .filter((horas) => horas != null);

      if (respostas.length) {
        const media = respostas.reduce((soma, horas) => soma + horas, 0) / respostas.length;
        if (!melhorResposta || media < melhorResposta.valor) {
          melhorResposta = { nome, valor: media };
        }
      }
    });

    secao.querySelector("[data-analise-terceiro-mais-chamados]").textContent =
      maisChamados ? `${maisChamados.nome} (${maisChamados.valor.toLocaleString("pt-BR")})` : "—";
    secao.querySelector("[data-analise-terceiro-mais-urgente]").textContent =
      maisUrgente ? `${maisUrgente.nome} (${maisUrgente.valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%)` : "—";
    secao.querySelector("[data-analise-terceiro-maior-sla]").textContent =
      maiorSla ? `${maiorSla.nome} (${formatarDuracao(maiorSla.valor)})` : "—";
    secao.querySelector("[data-analise-terceiro-melhor-resposta]").textContent =
      melhorResposta ? `${melhorResposta.nome} (${formatarDuracao(melhorResposta.valor)})` : "—";
  }

  function desenharGraficoTerceirosTotal(chamados) {
    const grupos = agruparPorTerceiro(chamados);

    const linhas = [...grupos.entries()]
      .map(([nome, { pessoa, chamados: doGrupo }]) => ({ nome, rotulo: primeiroNome(pessoa), total: doGrupo.length }))
      .sort((a, b) => b.total - a.total);

    const texto = corDoTexto("--texto-2");

    graficoTerceirosTotal?.destroy();
    graficoTerceirosTotal = new Chart(canvasTerceirosTotal, {
      type: "bar",
      data: {
        labels: linhas.map((linha) => linha.rotulo),
        datasets: [{
          data: linhas.map((linha) => linha.total),
          backgroundColor: "#dd5b12",
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 48,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: texto, padding: 8, maxRotation: 0, minRotation: 0 }, grid: { display: false } },
          y: {
            beginAtZero: true,
            ticks: { color: texto, precision: 0, padding: 6 },
            grid: { display: false },
          },
        },
      },
    });
  }

  function desenharGraficoTerceirosSla(chamados) {
    const grupos = agruparPorTerceiro(chamados);

    const linhas = [...grupos.entries()]
      .map(([nome, { pessoa, chamados: doGrupo }]) => {
        const duracoes = doGrupo
          .filter((chamado) => chamado.fechamento_em)
          .map((chamado) => horasUteisEntre(new Date(chamado.abertura_em), new Date(chamado.fechamento_em)));

        const media = duracoes.length
          ? duracoes.reduce((soma, horas) => soma + horas, 0) / duracoes.length
          : null;

        return { nome, rotulo: primeiroNome(pessoa), media };
      })
      .filter((linha) => linha.media != null)
      .sort((a, b) => b.media - a.media);

    const texto = corDoTexto("--texto-2");

    graficoTerceirosSla?.destroy();
    graficoTerceirosSla = new Chart(canvasTerceirosSla, {
      type: "bar",
      data: {
        labels: linhas.map((linha) => linha.rotulo),
        datasets: [{
          data: linhas.map((linha) => Math.round(linha.media * 10) / 10),
          backgroundColor: "#dd5b12",
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 48,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: texto, padding: 8, maxRotation: 0, minRotation: 0 }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: texto, padding: 6 }, grid: { display: false } },
        },
      },
    });
  }

  /* ------------------------------------------------------------------
     ACOMPANHAMENTO: unica sub-aba que agrupa por MES, nao por dimensao —
     e a unica com consulta PROPRIA tambem, porque sempre olha os ULTIMOS
     12 MESES fixos, nunca o periodo escolhido no topo (esse period so
     vale pras outras 6 sub-abas). O filtro de unidade/categoria/setor/
     atendente continua valendo aqui — aplicado sobre dadosAcompanhamento
     do mesmo jeito que aplicarFiltrosAnalise ja faz sobre ultimoResultado.
     ------------------------------------------------------------------ */

  //12 MESES FIXOS: do primeiro dia do mes 11 meses atras ate hoje —
  //sempre 12 pontos no grafico, independente de quando a pessoa abrir.
  function periodoAcompanhamento() {
    const hoje = new Date();
    const primeiroDoRange = new Date(hoje.getFullYear(), hoje.getMonth() - 11, 1);
    return { de: primeiroDoRange, ate: hoje };
  }

  async function carregarAcompanhamento() {
    const { de, ate } = periodoAcompanhamento();
    const ateFimDoDia = `${paraTextoLocal(ate)}T23:59:59.999`;

    const { data, error } = await supabase
      .from("chamados")
      .select(`
        eh_urgente, abertura_em, fechamento_em,
        unidade_id, categoria_id,
        usuarios!chamados_solicitante_id_fkey(setor_id),
        chamado_membros(usuario_id)
      `)
      .gte("abertura_em", `${paraTextoLocal(de)}T00:00:00`)
      .lte("abertura_em", ateFimDoDia);

    if (error) {
      console.error("Erro ao carregar o acompanhamento:", error);
      erroEl.hidden = false;
      erroEl.textContent = "Não foi possível carregar os dados de acompanhamento. Tente novamente.";
      return;
    }

    dadosAcompanhamento = data ?? [];
    desenharAcompanhamento();
  }

  //MESMOS FILTROS GLOBAIS (unidade/categoria/setor/atendente), so que
  //sobre dadosAcompanhamento em vez de ultimoResultado — a funcao de
  //filtro em si (aplicarFiltrosAnalise) e a mesma, reaproveitada aqui.
  function dadosAcompanhamentoFiltrados() {
    return aplicarFiltrosAnalise(dadosAcompanhamento);
  }

  const NOMES_MES_CURTO = [
    "jan", "fev", "mar", "abr", "mai", "jun",
    "jul", "ago", "set", "out", "nov", "dez",
  ];

  //AGRUPA POR MES-ANO ("2026-09"), NAO SO PELO NOME DO MES: sem o ano
  //junto, chamados de setembro/2025 e setembro/2026 cairiam no mesmo
  //grupo (o range de 12 meses pode cruzar a virada de ano).
  function agruparPorMes(chamados) {
    const grupos = new Map();

    chamados.forEach((chamado) => {
      const data = new Date(chamado.abertura_em);
      const chave = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}`;
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(chamado);
    });

    return grupos;
  }

  //GARANTE OS 12 MESES NA ORDEM CERTA, mesmo os que nao tem nenhum
  //chamado — sem isso um mes vazio simplesmente sumiria do eixo, em vez
  //de aparecer com 0 (o grafico do Power BI de referencia sempre mostra
  //os 12 pontos seguidos).
  function mesesDoRange() {
    const { de } = periodoAcompanhamento();
    const meses = [];

    for (let indice = 0; indice < 12; indice += 1) {
      const data = new Date(de.getFullYear(), de.getMonth() + indice, 1);
      meses.push({
        chave: `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}`,
        rotulo: `${NOMES_MES_CURTO[data.getMonth()]} ${data.getFullYear()}`,
      });
    }

    return meses;
  }

  function desenharAcompanhamento() {
    if (!jaAbriuAcompanhamento) {
      jaAbriuAcompanhamento = true;
      carregarAcompanhamento();
      return;
    }

    if (!dadosAcompanhamento.length) return;

    const chamados = dadosAcompanhamentoFiltrados();
    const grupos = agruparPorMes(chamados);
    const meses = mesesDoRange();

    desenharCardsDeAcompanhamento(grupos, meses);
    desenharGraficoMesTotal(grupos, meses);
    desenharGraficoMesSla(grupos, meses);
  }

  function formatarVariacaoNumero(valor) {
    const sinal = valor > 0 ? "+" : "";
    return `${sinal}${valor.toLocaleString("pt-BR")}`;
  }

  function formatarVariacaoPercentual(valor) {
    if (!Number.isFinite(valor)) return "—";
    const sinal = valor > 0 ? "+" : "";
    return `${sinal}${valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
  }

  function formatarVariacaoHoras(valor) {
    const sinal = valor > 0 ? "+" : "";
    return `${sinal}${valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}h`;
  }

  //APLICA A COR SEMANTICA (alta = vermelho, baixa = verde) num <span> de
  //card — usado pelos 4 cards de variacao. "Alta" aqui SEMPRE significa
  //"o numero cresceu", nao "isso e ruim": quem le decide se crescer e bom
  //ou ruim (mais chamados e neutro/ruim, SLA menor e bom — a cor e so um
  //indicador visual de direcao, o rotulo do card ja diz o que e cada um).
  function aplicarCorDeVariacao(elemento, valor) {
    elemento.classList.remove("analise-card__valor--alta", "analise-card__valor--baixa");
    if (valor > 0) elemento.classList.add("analise-card__valor--alta");
    else if (valor < 0) elemento.classList.add("analise-card__valor--baixa");
  }

  function desenharCardsDeAcompanhamento(grupos, meses) {
    // Mes ATUAL = ultimo do range; ANTERIOR = penultimo — sempre os dois
    // ultimos dos 12 meses fixos, nao os dois ultimos com dado (um mes
    // sem chamado nenhum ainda conta como "0", nao e pulado).
    const mesAtual = meses[meses.length - 1];
    const mesAnterior = meses[meses.length - 2];

    const chamadosAtual = grupos.get(mesAtual.chave) ?? [];
    const chamadosAnterior = grupos.get(mesAnterior.chave) ?? [];

    const totalAtual = chamadosAtual.length;
    const totalAnterior = chamadosAnterior.length;
    const variacaoTotal = totalAtual - totalAnterior;
    const variacaoPercentual = totalAnterior
      ? ((totalAtual - totalAnterior) / totalAnterior) * 100
      : (totalAtual ? 100 : 0);

    function slaMedio(chamadosDoMes, urgente) {
      const duracoes = chamadosDoMes
        .filter((chamado) => chamado.eh_urgente === urgente && chamado.fechamento_em)
        .map((chamado) => horasUteisEntre(new Date(chamado.abertura_em), new Date(chamado.fechamento_em)));
      return duracoes.length ? duracoes.reduce((soma, horas) => soma + horas, 0) / duracoes.length : null;
    }

    const slaNormalAtual = slaMedio(chamadosAtual, false);
    const slaNormalAnterior = slaMedio(chamadosAnterior, false);
    const slaUrgenteAtual = slaMedio(chamadosAtual, true);
    const slaUrgenteAnterior = slaMedio(chamadosAnterior, true);

    const variacaoSlaNormal = (slaNormalAtual != null && slaNormalAnterior != null)
      ? slaNormalAtual - slaNormalAnterior : null;
    const variacaoSlaUrgente = (slaUrgenteAtual != null && slaUrgenteAnterior != null)
      ? slaUrgenteAtual - slaUrgenteAnterior : null;

    const elTotal = secao.querySelector("[data-analise-variacao-total]");
    const elPercentual = secao.querySelector("[data-analise-variacao-percentual]");
    const elSlaNormal = secao.querySelector("[data-analise-variacao-sla-normal]");
    const elSlaUrgente = secao.querySelector("[data-analise-variacao-sla-urgente]");

    elTotal.textContent = formatarVariacaoNumero(variacaoTotal);
    aplicarCorDeVariacao(elTotal, variacaoTotal);

    elPercentual.textContent = formatarVariacaoPercentual(variacaoPercentual);
    aplicarCorDeVariacao(elPercentual, variacaoPercentual);

    elSlaNormal.textContent = variacaoSlaNormal != null ? formatarVariacaoHoras(variacaoSlaNormal) : "—";
    if (variacaoSlaNormal != null) aplicarCorDeVariacao(elSlaNormal, variacaoSlaNormal);

    elSlaUrgente.textContent = variacaoSlaUrgente != null ? formatarVariacaoHoras(variacaoSlaUrgente) : "—";
    if (variacaoSlaUrgente != null) aplicarCorDeVariacao(elSlaUrgente, variacaoSlaUrgente);
  }

  //PLUGIN INLINE PRA ANOTAR O VALOR EM CIMA DE CADA PONTO: o Chart.js
  //core nao tem isso pronto (so via chartjs-plugin-datalabels, uma lib
  //extra) — como e so um numero por ponto, mais simples desenhar na mao
  //do que carregar mais um script pra isso. So entra nos 2 graficos de
  //linha do Acompanhamento (via plugins: [desenharValoresDaLinha]), no
  //resto do arquivo ninguem mais usa.
  const desenharValoresDaLinha = {
    id: "desenharValoresDaLinha",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = "600 11px 'Poppins', system-ui, sans-serif";
      ctx.textAlign = "center";

      chart.data.datasets.forEach((dataset, indiceDataset) => {
        const meta = chart.getDatasetMeta(indiceDataset);
        if (meta.hidden) return;

        ctx.fillStyle = dataset.borderColor;
        meta.data.forEach((ponto, indice) => {
          const valor = dataset.data[indice];
          if (valor == null) return;
          ctx.fillText(
            valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 }),
            ponto.x,
            ponto.y - 10,
          );
        });
      });

      ctx.restore();
    },
  };

  function desenharGraficoMesTotal(grupos, meses) {
    const totais = meses.map((mes) => (grupos.get(mes.chave) ?? []).length);
    const texto = corDoTexto("--texto-2");

    graficoMesTotal?.destroy();
    graficoMesTotal = new Chart(canvasMesTotal, {
      type: "line",
      data: {
        labels: meses.map((mes) => mes.rotulo),
        datasets: [{
          data: totais,
          borderColor: "#dd5b12",
          backgroundColor: "#dd5b12",
          borderWidth: 3,
          pointRadius: 3,
          pointBackgroundColor: "#dd5b12",
          tension: 0.35,
        }],
      },
      plugins: [desenharValoresDaLinha],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 20 } },
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: texto, padding: 6 }, grid: { display: false } },
          y: {
            beginAtZero: true,
            ticks: { color: texto, precision: 0, padding: 6 },
            grid: { display: false },
          },
        },
      },
    });
  }

  function desenharGraficoMesSla(grupos, meses) {
    const texto = corDoTexto("--texto-2");

    function serieSla(urgente) {
      return meses.map((mes) => {
        const chamadosDoMes = grupos.get(mes.chave) ?? [];
        const duracoes = chamadosDoMes
          .filter((chamado) => chamado.eh_urgente === urgente && chamado.fechamento_em)
          .map((chamado) => horasUteisEntre(new Date(chamado.abertura_em), new Date(chamado.fechamento_em)));
        return duracoes.length
          ? Math.round((duracoes.reduce((soma, horas) => soma + horas, 0) / duracoes.length) * 10) / 10
          : null;
      });
    }

    graficoMesSla?.destroy();
    graficoMesSla = new Chart(canvasMesSla, {
      type: "line",
      data: {
        labels: meses.map((mes) => mes.rotulo),
        //CINZA = NORMAL, VERMELHO = URGENTE — mesma paleta de dado fixa
        //(nao token de tema) usada nos graficos empilhados das outras
        //sub-abas, pelo mesmo motivo: "normal"/"urgente" tem que parecer
        //a mesma coisa em claro ou escuro.
        datasets: [
          {
            label: "Normal",
            data: serieSla(false),
            borderColor: "#9a9aa2",
            backgroundColor: "#9a9aa2",
            borderWidth: 3,
            pointRadius: 3,
            pointBackgroundColor: "#9a9aa2",
            tension: 0.35,
          },
          {
            label: "Urgente",
            data: serieSla(true),
            borderColor: "#e5484d",
            backgroundColor: "#e5484d",
            borderWidth: 3,
            pointRadius: 3,
            pointBackgroundColor: "#e5484d",
            tension: 0.35,
          },
        ],
      },
      plugins: [desenharValoresDaLinha],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 20 } },
        plugins: {
          legend: {
            position: "top",
            align: "start",
            labels: { color: texto, boxWidth: 10, boxHeight: 10, padding: 14, font: { weight: "500" } },
          },
        },
        scales: {
          x: { ticks: { color: texto, padding: 6 }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: texto, padding: 6 }, grid: { display: false } },
        },
      },
    });
  }

  return {
    aoAbrir: () => {
      // So consulta o banco na primeira vez que a aba abre — evita uma
      // consulta pesada em toda carga do Painel se ninguem for olhar.
      if (jaAbriu) return;
      jaAbriu = true;
      carregar();
    },
  };
}

/* ==========================================================================
   ARRANQUE
   ========================================================================== */

async function montarPainel() {
  const analise = ligarAnalise();

  ligarAbas((aba) => {
    if (aba === "analise") analise.aoAbrir();
  });

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return;

  usuarioAtual = user.id;

  //SO O QUE ESTA ATIVO: as listas de apoio usam ativo=false como "removido"
  //(o Portal faz igual), entao o que foi removido nao volta a aparecer aqui —
  //EXCETO filasTodas, que e a excecao de proposito: a aba Listas precisa
  //mostrar tambem as arquivadas, pra dar pra reativar.
  const [filas, filasTodas, chamados, equipe, pessoas, setores, unidades, categorias, textos, terceiros] =
    await Promise.all([
      supabase.from("filas").select("id, nome, ordem, ativo").eq("ativo", true).order("ordem"),
      supabase.from("filas").select("id, nome, ordem, ativo").order("nome"),
      supabase.from("chamados").select(CAMPOS_CHAMADO).order("abertura_em", { ascending: false }),
      // Quem pode ser posto num chamado: a equipe de TI (mesma regra do
      // Portal e de is_equipe_ti no banco). Lista explícita, e não
      // "todo mundo que não é solicitante": o contribuinte cadastra solução
      // na Base mas não atende chamado, então não entra aqui.
      supabase.from("usuarios").select("id, nome, sobrenome, foto_path, cor_destaque")
        .in("perfil", ["analista", "admin"]).eq("ativo", true).order("nome"),
      supabase.from("usuarios")
        .select("id, nome, sobrenome, email, setor_id, unidade_id, perfil, ativo, status_aprovacao, foto_path, created_at")
        .order("nome"),
      supabase.from("setores").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("unidades").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("categorias").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("textos_rapidos").select("id, titulo, corpo").eq("ativo", true).order("titulo"),
      supabase.from("terceiros").select("id, nome, foto_path").eq("ativo", true).order("nome"),
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
    // So admin acessa o Painel (painel-guard.js): a mesma regra do botao de
    // aprovar/rejeitar cadastro na ficha de Aprovação de Acesso.
    "admin",
    terceiros.data ?? [],
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

  ligarListaSimples({
    prefixo: "terceiros",
    tabela: "terceiros",
    itens: terceiros.data ?? [],
    rotuloSingular: "Terceirizado",
    rotuloPlural: "Terceirizados",
    generoMasculino: true,
    comFoto: true,
    bucketFoto: "terceiros",
    dialog: dialogItemSimples,
  });

  ligarListaTextos(textos.data ?? []);
}

montarPainel();
