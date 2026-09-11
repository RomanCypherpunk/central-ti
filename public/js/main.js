// Comportamento compartilhado entre páginas (tema, usuário do topo, sair).

import { supabase } from "./config/supabase-config.js";

//ENTRADA DA PAGINA: CARTOES E PAINEIS SOBEM COM FADE, EM SEQUENCIA
const ELEMENTOS_ENTRADA = [
  ".saudacao",
  ".porta",
  ".coluna",
];

document.querySelectorAll(ELEMENTOS_ENTRADA.join(",")).forEach((elemento, indice) => {
  elemento.classList.add("entrada");
  elemento.style.setProperty("--entrada-atraso", `${indice * 70}ms`);
});

requestAnimationFrame(() => {
  document.querySelectorAll(".entrada")
    .forEach((elemento) => elemento.classList.add("entrada--visivel"));
});

//TEMA: SOL E LUA
const botoesTema = document.querySelectorAll(".topo__tema-botao");

function aplicarTema(tema) {
  document.documentElement.dataset.tema = tema;
  localStorage.setItem("tema", tema);

  botoesTema.forEach((botao) => {
    const ativo = botao.dataset.tema === tema;
    botao.classList.toggle("topo__tema-botao--ativo", ativo);
    botao.setAttribute("aria-pressed", ativo);
  });
}

botoesTema.forEach((botao) => {
  botao.addEventListener("click", () => aplicarTema(botao.dataset.tema));
});

// O <head> já aplicou o tema salvo antes da pintura; aqui só marca o botão certo.
aplicarTema(document.documentElement.dataset.tema);

//USUARIO DO TOPO
function escrever(seletor, texto) {
  const elemento = document.querySelector(seletor);

  if (elemento) elemento.textContent = texto;
}

function iniciais(nome) {
  const partes = nome.trim().split(/\s+/);
  const primeira = partes[0] ?? "";
  const ultima = partes.length > 1 ? partes[partes.length - 1] : "";

  return (primeira[0] ?? "").concat(ultima[0] ?? "").toUpperCase();
}

async function preencherUsuario() {
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return;

  const nome = user.user_metadata?.nome ?? user.email;

  // Nem toda pagina tem o cabecalho: escreve so onde o elemento existe.
  escrever("[data-nome]", nome);
  // O nome da saudacao e o mesmo gravado no cadastro.
  escrever("[data-saudacao-nome]", nome);
  escrever("[data-iniciais]", iniciais(nome));

  const setorId = user.user_metadata?.setor_id;

  if (!setorId) return;

  const { data: setor } = await supabase
    .from("setores")
    .select("nome")
    .eq("id", setorId)
    .single();

  if (!setor) return;

  escrever("[data-setor]", setor.nome);

  // A Base de Soluções mostra só o setor de quem está logado.
  escrever("[data-setor-marca]", setor.nome);
}

preencherUsuario();

//MENU DO PERFIL
// Paginas sem o cabecalho (a base, por exemplo) nao tem nada disso.
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

  await supabase.auth.signOut();
  // O auth-guard escuta a queda da sessão e redireciona para o login.
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
