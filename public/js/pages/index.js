// Home: "Soluções em destaque" e "Suas últimas solicitações", com dados
// reais do Supabase — antes eram três linhas e quatro linhas fixas no HTML.

import { supabase } from "../config/supabase-config.js";

const LIMITE = 4;

/* ==========================================================================
   SOLUÇÕES EM DESTAQUE
   A RLS de `artigos` já filtra por setor sozinha (is_equipe_ti() OR
   autor_id = auth.uid() OR meu_setor_id() = any(setores)) — mas is_equipe_ti
   e pode_escrever_artigo liberam GERAL para admin/analista/contribuinte, e
   este widget é "do meu setor", não "tudo que eu tenho permissão de ver".
   Por isso o filtro extra abaixo: só entra em ação para quem é solicitante
   puro (a RLS já restringia); quem tem acesso amplo continua vendo geral
   aqui, igual já via na Base inteira.
   ========================================================================== */

// Título mais longo que isso quebra a linha do card — corta com reticências
// em vez de deixar o card esticar (e "engrossar" a coluna toda).
const LIMITE_TITULO = 48;

function truncarTitulo(titulo) {
  const texto = titulo || "Sem título";

  return texto.length > LIMITE_TITULO
    ? `${texto.slice(0, LIMITE_TITULO).trimEnd()}…`
    : texto;
}

async function carregarSolucoes() {
  const lista = document.querySelector("[data-destaques]");

  if (!lista) return;

  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: setores }, { data: perfil }] = await Promise.all([
    supabase.from("setores").select("id, nome"),
    user
      ? supabase.from("usuarios").select("perfil, setor_id").eq("id", user.id).single()
      : Promise.resolve({ data: null }),
  ]);

  const nomeDoSetor = new Map((setores ?? []).map((s) => [s.id, s.nome]));

  // Só filtra quem NÃO tem acesso amplo — para os demais, a RLS já limitou
  // ao próprio setor, então buscar mais do que LIMITE não muda o resultado.
  const restringirAoSetor = perfil
    && !["admin", "analista", "contribuinte"].includes(perfil.perfil)
    && perfil.setor_id;

  const { data: artigos, error } = await supabase
    .from("artigos")
    .select("id, titulo, setores")
    .eq("ativo", true)
    .order("criado_em", { ascending: false })
    // Busca mais do que o limite quando vai filtrar depois no cliente —
    // senão os 4 mais recentes de TODOS os setores poderiam não sobrar
    // nenhum do setor da pessoa depois do corte.
    .limit(restringirAoSetor ? LIMITE * 10 : LIMITE);

  lista.replaceChildren();

  if (error) {
    const item = document.createElement("li");
    item.className = "artigos__vazio";
    item.textContent = "Não foi possível carregar as soluções.";
    lista.appendChild(item);
    return;
  }

  const filtrados = restringirAoSetor
    ? artigos.filter((artigo) => (artigo.setores ?? []).includes(perfil.setor_id))
    : artigos;

  const visiveis = filtrados.slice(0, LIMITE);

  if (!visiveis.length) {
    const item = document.createElement("li");
    item.className = "artigos__vazio";
    item.textContent = "Nenhuma solução disponível ainda.";
    lista.appendChild(item);
    return;
  }

  visiveis.forEach((artigo) => {
    // O setor mostrado na linha é so o primeiro marcado — a etiqueta é um
    // destaque visual, não a lista completa de quem enxerga a solução.
    const nomeSetor = nomeDoSetor.get(artigo.setores?.[0]) ?? "Geral";

    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "artigo";
    link.href = `base.html?id=${artigo.id}`;

    const titulo = document.createElement("span");
    titulo.className = "artigo__titulo";
    titulo.textContent = truncarTitulo(artigo.titulo);
    titulo.title = artigo.titulo || "Sem título";

    const setor = document.createElement("span");
    setor.className = "artigo__setor";
    setor.textContent = nomeSetor;

    link.append(titulo, setor);
    item.appendChild(link);
    lista.appendChild(item);
  });
}

/* ==========================================================================
   SUAS ÚLTIMAS SOLICITAÇÕES
   Status na visão do solicitante — vocabulário diferente do Portal
   (que é a visão do analista). Mesma derivação, palavras trocadas:
   Portal "Aberto"             -> aqui "Aberto"
   Portal "Usuário respondeu"  -> aqui "Em andamento" (a bola virou da equipe)
   Portal "Aguardando retorno" -> aqui "Aguardando você" (a bola é sua)
   Portal "Fechado"            -> aqui "Fechado"
   ========================================================================== */

const STATUS = {
  aberto: { classe: "aberto", rotulo: "Aberto" },
  andamento: { classe: "andamento", rotulo: "Em andamento" },
  aguardando: { classe: "aguardando", rotulo: "Aguardando você" },
  fechado: { classe: "fechado", rotulo: "Fechado" },
};

function derivarStatus(chamado) {
  if (chamado.fechamento_em) return STATUS.fechado;

  const publicos = (chamado.comentarios ?? [])
    .filter((c) => c.visibilidade === "publico" && c.tipo === "humano")
    .sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));

  const ultimo = publicos[publicos.length - 1];

  if (!ultimo) return STATUS.aberto;

  // O solicitante é quem abriu o chamado; qualquer outro autor é a equipe.
  return ultimo.autor_id === chamado.solicitante_id
    ? STATUS.andamento
    : STATUS.aguardando;
}

function tituloDoChamado(chamado) {
  return chamado.titulo
    ?? `${chamado.categorias?.nome ?? "Sem categoria"} | Ticket-${chamado.numero}`;
}

function formatarData(iso) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function montarLinha(chamado) {
  const status = derivarStatus(chamado);

  // A linha inteira leva ao chamado: clicar em qualquer celula (numero,
  // status, data) abre o mesmo que clicar no assunto.
  const destino = `solicitacoes.html?chamado=${chamado.numero}`;

  const linha = document.createElement("tr");
  linha.dataset.status = status.classe;

  const numero = document.createElement("td");
  numero.className = "tabela__numero";
  numero.textContent = `#${chamado.numero}`;

  const assunto = document.createElement("td");
  const link = document.createElement("a");
  link.className = "tabela__link";
  link.href = destino;
  link.textContent = tituloDoChamado(chamado);
  assunto.appendChild(link);

  const statusCel = document.createElement("td");
  const selo = document.createElement("span");
  selo.className = `selo selo--${status.classe}`;
  selo.textContent = status.rotulo;
  statusCel.appendChild(selo);

  const data = document.createElement("td");
  data.className = "tabela__data";
  data.textContent = formatarData(chamado.abertura_em);

  linha.append(numero, assunto, statusCel, data);

  // O link do assunto continua sendo o caminho de teclado e o que aparece
  // na barra do navegador; aqui so o clique do mouse em volta dele conta.
  linha.addEventListener("click", (evento) => {
    if (evento.target.closest("a")) return;

    window.location.href = destino;
  });

  return linha;
}

async function carregarChamados() {
  const corpo = document.querySelector("[data-chamados]");
  const resumoEl = document.querySelector("[data-resumo-chamados]");

  if (!corpo) return;

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return;

  const { data: chamados, error } = await supabase
    .from("chamados")
    .select(`
      id, numero, titulo, solicitante_id, abertura_em, fechamento_em,
      categorias(nome),
      comentarios(autor_id, visibilidade, tipo, criado_em)
    `)
    .eq("solicitante_id", user.id)
    .order("abertura_em", { ascending: false })
    .limit(LIMITE);

  corpo.replaceChildren();

  if (error) {
    corpo.innerHTML = '<tr><td colspan="4" class="tabela__vazio">Não foi possível carregar suas solicitações.</td></tr>';
    if (resumoEl) resumoEl.textContent = "";
    return;
  }

  if (!chamados.length) {
    corpo.innerHTML = '<tr><td colspan="4" class="tabela__vazio">Você ainda não abriu nenhum chamado.</td></tr>';
    if (resumoEl) resumoEl.textContent = "";
    return;
  }

  chamados.forEach((chamado) => corpo.appendChild(montarLinha(chamado)));

  if (!resumoEl) return;

  // O resumo conta sobre TODOS os chamados abertos da pessoa, não só os
  // que aparecem na lista (que é limitada a 4) — por isso é uma segunda
  // consulta, mais leve (só a coluna que decide o status).
  const { data: todosAbertos } = await supabase
    .from("chamados")
    .select("solicitante_id, fechamento_em, comentarios(autor_id, visibilidade, tipo, criado_em)")
    .eq("solicitante_id", user.id)
    .is("fechamento_em", null);

  const contagem = { andamento: 0, aguardando: 0 };

  (todosAbertos ?? []).forEach((chamado) => {
    const status = derivarStatus(chamado);
    if (status === STATUS.andamento) contagem.andamento += 1;
    if (status === STATUS.aguardando) contagem.aguardando += 1;
  });

  const partes = [];
  if (contagem.andamento > 0) {
    partes.push(`${contagem.andamento} em andamento`);
  }
  if (contagem.aguardando > 0) {
    partes.push(`${contagem.aguardando} aguardando você`);
  }

  resumoEl.textContent = partes.join(" · ");
}

/* ==========================================================================
   FALAR COM A EQUIPE DE TI: ABRE O WEBMAIL JA NA TELA DE ESCREVER
   ==========================================================================

   O cartao de cada pessoa apontava para mailto:, que depende de haver um
   programa de e-mail configurado na maquina — em computador compartilhado
   isso costuma abrir a coisa errada, ou nada. Agora leva para o Outlook Web
   da empresa, numa aba nova, com o destinatario ja preenchido.

   Sai do site, entao pergunta antes: o aviso mostra para onde vai. */

//O CAMINHO DE "MENSAGEM NOVA" DO OUTLOOK WEB. Se um dia o endereco do
//webmail mudar, ou a versao do Exchange usar outro formato de link, e esta
//constante que muda — nada mais no arquivo sabe como a URL e montada.
const WEBMAIL = "https://webmail.exchangecorp.com.br/owa/?path=/mail/action/compose&to=";

function enderecoDoWebmail(email) {
  return WEBMAIL + encodeURIComponent(email);
}

//CONFIRMACAO DO SITE, no lugar do confirm() do navegador. Devolve uma
//promessa que diz se a pessoa confirmou.
//
//A resposta vem do CLIQUE em cada botao, e nao so do evento "close" do
//<dialog>: os tres caminhos estao ligados, o que chegar primeiro responde
//e desliga o resto. Clique nos botoes, clique no fundo escurecido (fora do
//cartao) e o "close" que cobre so o Esc, que fecha a janela sem passar por
//nenhum dos outros dois.
function confirmarNoSite({ pessoa, texto, destino }) {
  const janela = document.querySelector("[data-confirmacao]");
  const botaoConfirmar = document.querySelector("[data-confirmacao-confirmar]");
  const botaoCancelar = document.querySelector("[data-confirmacao-cancelar]");
  const foto = document.querySelector("[data-confirmacao-foto]");

  document.querySelector("[data-confirmacao-nome]").textContent = pessoa.nome;
  document.querySelector("[data-confirmacao-cargo]").textContent = pessoa.cargo;
  document.querySelector("[data-confirmacao-texto]").textContent = texto;
  // O e-mail cabe numa linha so nos nomes de hoje, mas um endereco mais
  // longo quebraria em qualquer letra ("...com.b" / "r"). O <wbr> antes do
  // arroba oferece um ponto de quebra decente: o nome numa linha, o
  // dominio na outra.
  const caixaDestino = document.querySelector("[data-confirmacao-destino]");
  const [conta, ...dominio] = destino.split("@");

  caixaDestino.replaceChildren(document.createTextNode(conta));

  if (dominio.length) {
    caixaDestino.appendChild(document.createElement("wbr"));
    caixaDestino.appendChild(document.createTextNode(`@${dominio.join("@")}`));
  }

  // A MESMA FOTO DO CARTAO, e nao um segundo carregamento: cloneNode traz a
  // imagem ja baixada e tambem o [hidden] que o onerror pos nela, entao uma
  // foto quebrada continua quebrada aqui e as iniciais aparecem no lugar.
  foto.dataset.iniciais = pessoa.iniciais;
  foto.replaceChildren();
  if (pessoa.imagem) foto.appendChild(pessoa.imagem.cloneNode(true));

  janela.returnValue = "";
  // O foco cai no primeiro botao (Cancelar): Enter sem querer nao leva
  // ninguem para fora do site.
  janela.showModal();

  return new Promise((resolver) => {
    let respondido = false;

    function responder(confirmou) {
      if (respondido) return;

      respondido = true;
      botaoConfirmar.removeEventListener("click", aoConfirmar);
      botaoCancelar.removeEventListener("click", aoCancelar);
      janela.removeEventListener("click", aoCliqueFora);
      janela.removeEventListener("close", aoFechar);

      if (janela.open) janela.close();

      resolver(confirmou);
    }

    function aoConfirmar() { responder(true); }
    function aoCancelar() { responder(false); }
    function aoFechar() { responder(janela.returnValue === "confirmar"); }

    // O <dialog> preenche a tela toda com o ::backdrop; clicar nele conta
    // como clique no proprio <dialog>, e nao no <form> de dentro — por
    // isso o teste e o target ser exatamente a janela, e nao closest().
    // Clicar no cartao (no <form>) nunca bate aqui.
    function aoCliqueFora(evento) {
      if (evento.target === janela) responder(false);
    }

    botaoConfirmar.addEventListener("click", aoConfirmar);
    botaoCancelar.addEventListener("click", aoCancelar);
    janela.addEventListener("click", aoCliqueFora);
    janela.addEventListener("close", aoFechar);
  });
}

function ligarContatoDaEquipe() {
  document.querySelectorAll(".equipe__link").forEach((link) => {
    // O e-mail ja esta no cartao, no botao de copiar ao lado.
    const email = link.closest(".equipe__pessoa")?.querySelector("[data-email]")?.dataset.email;

    if (!email) return;

    const fotoDoCartao = link.querySelector(".equipe__foto");
    const pessoa = {
      nome: link.querySelector(".equipe__nome")?.textContent.trim() ?? "Equipe de TI",
      cargo: link.querySelector(".equipe__cargo")?.textContent.trim() ?? "",
      iniciais: fotoDoCartao?.dataset.iniciais ?? "",
      imagem: fotoDoCartao?.querySelector("img") ?? null,
    };
    const destino = enderecoDoWebmail(email);

    // O href deixa de ser mailto: assim o navegador mostra o destino real
    // ao passar o mouse, e Ctrl+clique ou o botao do meio abrem o webmail
    // direto, como em qualquer link.
    link.href = destino;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    link.addEventListener("click", async (evento) => {
      // Ctrl/Cmd/Shift/Alt ou botao do meio: a pessoa ja disse como quer
      // abrir. Perguntar de novo so atrapalharia.
      if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
      if (evento.button !== 0) return;

      evento.preventDefault();

      const confirmou = await confirmarNoSite({
        pessoa,
        texto: "O webmail abre numa aba nova, com a mensagem já endereçada para:",
        destino: email,
      });

      if (!confirmou) return;

      // noopener: a aba nova nao ganha acesso a esta pela window.opener.
      window.open(destino, "_blank", "noopener");
    });
  });
}

carregarSolucoes();
carregarChamados();
ligarContatoDaEquipe();
document.querySelectorAll(".equipe img").forEach((img) => {
  img.addEventListener("error", () => { img.hidden = true; });
});
