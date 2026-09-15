// Comportamento compartilhado entre páginas (tema, usuário do topo, sair).

import { supabase } from "./config/supabase-config.js";
import { pintarFoto, versaoDaMinhaFoto } from "./componentes/avatar.js";

//ENTRADA DA PAGINA: CARTOES E PAINEIS SOBEM COM FADE, EM SEQUENCIA.
//So na primeira visita de cada pagina nesta sessao: repetida a cada troca de
//tela, a animacao fazia saudacao e cartoes sumirem e voltarem — parecia que
//a pagina piscava.
const ELEMENTOS_ENTRADA = [
  ".saudacao",
  ".porta",
  ".coluna",
];

const CHAVE_ENTRADA = `entrada-vista:${window.location.pathname}`;

function entradaJaVista() {
  try {
    if (sessionStorage.getItem(CHAVE_ENTRADA)) return true;
    sessionStorage.setItem(CHAVE_ENTRADA, "1");
  } catch {
    // Sem sessionStorage: anima sempre, como antes.
  }

  return false;
}

if (!entradaJaVista()) {
  document.querySelectorAll(ELEMENTOS_ENTRADA.join(",")).forEach((elemento, indice) => {
    elemento.classList.add("entrada");
    elemento.style.setProperty("--entrada-atraso", `${indice * 70}ms`);
  });

  requestAnimationFrame(() => {
    document.querySelectorAll(".entrada")
      .forEach((elemento) => elemento.classList.add("entrada--visivel"));
  });
}

//USUARIO DO TOPO
//As iniciais vem do primeiro nome + sobrenome; o nome pode ser composto
//("João Paulo"), e ai a inicial que vale e a da primeira palavra.
function iniciais(nome, sobrenome) {
  const primeira = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  const ultima = (sobrenome ?? "").trim().split(/\s+/).pop() ?? "";

  return (primeira[0] ?? "").concat(ultima[0] ?? "").toUpperCase();
}

function preencher(seletor, texto) {
  const elemento = document.querySelector(seletor);

  if (elemento) elemento.textContent = texto;
}

//TOPO GUARDADO NESTE NAVEGADOR: nome, setor, foto e o que o menu mostra.
//Sem isso, toda troca de pagina abria o topo vazio e so preenchia depois
//da consulta ao banco (nome, foto e itens do menu "pulando" na tela). Agora
//o guardado aparece na hora e a consulta so corrige se algo mudou. Sai ao
//deslogar, e so vale para o mesmo usuario da sessao.
const CHAVE_TOPO = "topo-usuario";

function lerTopoGuardado() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_TOPO) ?? "null");
  } catch {
    return null;
  }
}

function guardarTopo(dados) {
  try {
    localStorage.setItem(CHAVE_TOPO, JSON.stringify(dados));
  } catch {
    // Sem localStorage o topo so nao aparece adiantado na proxima pagina.
  }
}

function esquecerTopo() {
  try {
    localStorage.removeItem(CHAVE_TOPO);
  } catch {
    // Nada guardado para apagar.
  }
}

supabase.auth.onAuthStateChange((_evento, sessao) => {
  if (!sessao) esquecerTopo();
});

let topoAtual = null;

//Mostra (ou volta a esconder) o que nasce hidden no HTML e so aparece para
//quem tem permissao. So esconde de novo o que ele mesmo revelou: nunca
//mexe num elemento que a pagina deixou visivel por conta propria.
function revelar(seletor, mostrar) {
  document.querySelectorAll(seletor).forEach((elemento) => {
    if (mostrar) {
      elemento.removeAttribute("hidden");
      elemento.dataset.reveladoPeloTopo = "";
    } else if ("reveladoPeloTopo" in elemento.dataset) {
      elemento.setAttribute("hidden", "");
      delete elemento.dataset.reveladoPeloTopo;
    }
  });
}

//AVATAR DO TOPO: FOTO DE "Dados pessoais"; SEM FOTO, AS INICIAIS
const avatarTopo = document.querySelector("[data-iniciais]");

function desenharAvatarTopo() {
  if (!avatarTopo || !topoAtual) return;

  pintarFoto(avatarTopo, topoAtual.fotoPath, topoAtual.letras, {
    classeFoto: "topo__avatar-foto",
    versao: versaoDaMinhaFoto(),
  });
}

function aplicarTopo(dados) {
  topoAtual = dados;

  // O Portal e a tela de quem atende: so admin ve o atalho no menu. Quem
  // nao for admin nem enxerga o item — e o portal.html barra na entrada,
  // porque esconder link no menu nao e controle de acesso.
  // Painel (configuracao do Portal): mesma regra, e sao dois elementos no
  // menu de 3 pontinhos — o divisor e o link.
  revelar("[data-menu-portal], [data-menu-painel]", dados.perfil === "admin");

  // EQUIPE DE TI: mesma regra do RLS (is_equipe_ti no banco) — admin,
  // analista ou parceiro, aprovado e ativo. Usado na Base de Soluções:
  // só quem pode cadastrar/editar vê "Nova Solução" e os botões de
  // editar/excluir do painel. Esconder não substitui o RLS — é só pra
  // não mostrar um botão que sempre vai falhar.
  revelar("[data-equipe-ti]", dados.equipeTi);

  // BASE DE SOLUÇÕES PENDENTE: quem ainda não foi aprovado só vê o botão
  // apagado, sem link — a Base já barra na entrada (acesso-guard.js) e a
  // RLS de artigos também; isto aqui só evita oferecer algo que ia
  // sempre voltar a pessoa pra cá.
  document.querySelectorAll("[data-porta-base-link]").forEach((link) => {
    if (!link.dataset.hrefOriginal && link.getAttribute("href")) {
      link.dataset.hrefOriginal = link.getAttribute("href");
    }

    link.classList.toggle("botao--desativado", !dados.aprovado);

    if (dados.aprovado) {
      if (link.dataset.hrefOriginal) link.setAttribute("href", link.dataset.hrefOriginal);
      link.removeAttribute("aria-disabled");
    } else {
      link.removeAttribute("href");
      link.setAttribute("aria-disabled", "true");
    }
  });

  // Nas outras telas o item "Soluções" do menu simplesmente some — não
  // é um destaque da home, é só navegação, não precisa do aviso visual.
  document.querySelectorAll("[data-menu-base]").forEach((item) => {
    item.hidden = !dados.aprovado;
  });

  // main.js roda em toda pagina autenticada, e cada uma tem so parte destes
  // campos — a saudacao, por exemplo, existe so na home.
  // So o primeiro nome aparece no topo e na saudacao; o completo fica para
  // as telas que precisam identificar a pessoa (detalhe do chamado).
  preencher("[data-nome]", dados.nome);
  preencher("[data-saudacao-nome]", dados.nome);
  desenharAvatarTopo();

  if (!dados.setor) return;

  preencher("[data-setor]", dados.setor);
  // A Base de Soluções mostra só o setor de quem está logado.
  preencher("[data-setor-marca]", dados.setor);
}

// Link da Base desativado: sem href ele ja nao navega; o clique tambem nao
// pode fazer nada (ex.: alguem que ainda tenha o foco nele).
document.addEventListener("click", (evento) => {
  if (evento.target.closest?.('[data-porta-base-link][aria-disabled="true"]')) {
    evento.preventDefault();
  }
});

// A tela de perfil avisa quando a foto ou o nome mudam, e o topo acompanha
// sem precisar recarregar.
window.addEventListener("perfil:atualizado", (evento) => {
  const { detail } = evento;

  if (!topoAtual) return;

  if ("fotoPath" in detail) topoAtual.fotoPath = detail.fotoPath;
  if ("iniciais" in detail) topoAtual.letras = detail.iniciais;
  if ("nome" in detail) {
    topoAtual.nome = detail.nome;
    preencher("[data-nome]", detail.nome);
  }

  guardarTopo(topoAtual);
  desenharAvatarTopo();
});

async function preencherUsuario() {
  // getSession le a sessao ja guardada, sem ida ao servidor: o topo nao
  // precisa esperar a rede para saber de quem e. Quem protege os dados e o
  // RLS, nao esta leitura.
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;

  if (!user) {
    esquecerTopo();
    return;
  }

  const guardado = lerTopoGuardado();
  const guardadoValido = guardado?.id === user.id;

  if (guardadoValido) aplicarTopo(guardado);

  // Le da tabela, e nao do user_metadata: o metadata e uma foto do momento do
  // cadastro e nao acompanha quem edita o nome em "Dados pessoais".
  const { data: perfil, error } = await supabase
    .from("usuarios")
    .select("nome, sobrenome, perfil, status_aprovacao, ativo, foto_path, setores(nome)")
    .eq("id", user.id)
    .single();

  // Falha de rede com o topo ja guardado: fica o guardado, que e melhor que
  // trocar o nome pelo e-mail e apagar os itens do menu.
  if (error && guardadoValido) return;

  const nome = perfil?.nome ?? user.email;
  const sobrenome = perfil?.sobrenome ?? "";
  const aprovado = perfil?.status_aprovacao === "aprovado" && Boolean(perfil?.ativo);

  const dados = {
    id: user.id,
    nome,
    letras: iniciais(nome, sobrenome),
    setor: perfil?.setores?.nome ?? "",
    fotoPath: perfil?.foto_path ?? null,
    perfil: perfil?.perfil ?? null,
    aprovado,
    equipeTi: ["admin", "analista", "parceiro"].includes(perfil?.perfil) && aprovado,
  };

  guardarTopo(dados);
  aplicarTopo(dados);
}

preencherUsuario();

//MENU DO PERFIL
// A base e a nova solução não têm cabeçalho: sem as guardas, o erro aqui
// interrompe o arquivo e o menu lateral lá embaixo nunca chega a rodar.
const perfil = document.querySelector(".topo__perfil");
const botaoPerfil = perfil?.querySelector(".topo__usuario");
const menuPerfil = perfil?.querySelector(".topo__menu");

function fecharMenuPerfil() {
  menuPerfil?.classList.remove("topo__menu--aberto");
  botaoPerfil?.setAttribute("aria-expanded", "false");
}

botaoPerfil?.addEventListener("click", () => {
  const aberto = menuPerfil.classList.toggle("topo__menu--aberto");
  botaoPerfil.setAttribute("aria-expanded", aberto);
});

// Clique em qualquer lugar fora do perfil fecha o menu.
document.addEventListener("click", (evento) => {
  if (perfil && !perfil.contains(evento.target)) fecharMenuPerfil();
});

// Esc fecha e devolve o foco ao botao, senao o teclado fica perdido.
document.addEventListener("keydown", (evento) => {
  if (evento.key !== "Escape") return;
  if (!menuPerfil?.classList.contains("topo__menu--aberto")) return;

  fecharMenuPerfil();
  botaoPerfil.focus();
});

//SAIR
const botaoSair = document.querySelector("[data-acao='sair']");
const semMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Espera a transição terminar. O timeout é rede de segurança: se a transição
// não disparar por algum motivo, a saída não trava.
function esperarTransicao(elemento) {
  return new Promise((resolver) => {
    elemento.addEventListener("transitionend", resolver, { once: true });
    setTimeout(resolver, 400);
  });
}

botaoSair?.addEventListener("click", async () => {
  botaoSair.disabled = true;

  if (!semMovimento) {
    document.body.classList.add("saindo");
    await esperarTransicao(document.body);
  }

  // O proximo a entrar neste navegador nao pode ver o topo de quem saiu.
  esquecerTopo();
  await supabase.auth.signOut();
  // O auth-guard escuta a queda da sessão e redireciona para o login.
});

//COPIAR E-MAIL DA EQUIPE
document.querySelectorAll(".equipe__copiar").forEach((botao) => {
  const rotuloOriginal = botao.getAttribute("aria-label");

  botao.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(botao.dataset.email);
    } catch {
      return; // Sem permissão de clipboard: não finge que copiou.
    }

    botao.classList.add("equipe__copiar--copiado");
    botao.setAttribute("aria-label", "E-mail copiado");

    setTimeout(() => {
      botao.classList.remove("equipe__copiar--copiado");
      botao.setAttribute("aria-label", rotuloOriginal);
    }, 1500);
  });
});

//MENU LATERAL: RECOLHER E EXPANDIR
// Só a base e a nova solução têm sidebar; nas outras telas isso não faz nada.
const sidebarColapsarBtn = document.getElementById("sidebar-colapsar");
const sidebarLogo = document.querySelector(".sidebar__logo");

function sidebarColapsada() {
  return document.documentElement.dataset.sidebar === "colapsada";
}

function aplicarColapso(colapsada) {
  document.documentElement.dataset.sidebar = colapsada ? "colapsada" : "expandida";

  if (sidebarColapsarBtn) {
    sidebarColapsarBtn.setAttribute("aria-expanded", String(!colapsada));
    sidebarColapsarBtn.setAttribute("aria-label", colapsada ? "Expandir menu" : "Recolher menu");
  }

  // Recolhida sobra um quadrado de 28px: a marca inteira não cabe, só o símbolo.
  if (sidebarLogo) {
    sidebarLogo.src = colapsada ? "assets/img/logo-icone.svg" : "assets/img/logo-claro.svg";
  }
}

if (sidebarColapsarBtn) {
  aplicarColapso(localStorage.getItem("sidebarColapsada") === "true");

  sidebarColapsarBtn.addEventListener("click", () => {
    const novoEstado = !sidebarColapsada();

    localStorage.setItem("sidebarColapsada", String(novoEstado));
    aplicarColapso(novoEstado);
  });
}
