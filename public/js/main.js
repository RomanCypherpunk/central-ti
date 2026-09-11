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

async function preencherUsuario() {
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return;

  // Le da tabela, e nao do user_metadata: o metadata e uma foto do momento do
  // cadastro e nao acompanha quem edita o nome em "Dados pessoais".
  const { data: perfil } = await supabase
    .from("usuarios")
    .select("nome, sobrenome, perfil, setores(nome)")
    .eq("id", user.id)
    .single();

  const nome = perfil?.nome ?? user.email;
  const sobrenome = perfil?.sobrenome ?? "";

  // O Portal e a tela de quem atende: so admin ve o atalho no menu. Quem
  // nao for admin nem enxerga o item — e o portal.html barra na entrada,
  // porque esconder link no menu nao e controle de acesso.
  if (perfil?.perfil === "admin") {
    document.querySelector("[data-menu-portal]")?.removeAttribute("hidden");
  }

  // main.js roda em toda pagina autenticada, e cada uma tem so parte destes
  // campos — a saudacao, por exemplo, existe so na home.
  // So o primeiro nome aparece no topo e na saudacao; o completo fica para
  // as telas que precisam identificar a pessoa (detalhe do chamado).
  preencher("[data-nome]", nome);
  preencher("[data-saudacao-nome]", nome);
  preencher("[data-iniciais]", iniciais(nome, sobrenome));

  const setor = perfil?.setores?.nome;

  if (!setor) return;

  preencher("[data-setor]", setor);
  // A Base de Soluções mostra só o setor de quem está logado.
  preencher("[data-setor-marca]", setor);
}

preencherUsuario();

//MENU DO PERFIL
const perfil = document.querySelector(".topo__perfil");
const botaoPerfil = perfil.querySelector(".topo__usuario");
const menuPerfil = perfil.querySelector(".topo__menu");

function fecharMenuPerfil() {
  menuPerfil.classList.remove("topo__menu--aberto");
  botaoPerfil.setAttribute("aria-expanded", "false");
}

botaoPerfil.addEventListener("click", () => {
  const aberto = menuPerfil.classList.toggle("topo__menu--aberto");
  botaoPerfil.setAttribute("aria-expanded", aberto);
});

// Clique em qualquer lugar fora do perfil fecha o menu.
document.addEventListener("click", (evento) => {
  if (!perfil.contains(evento.target)) fecharMenuPerfil();
});

// Esc fecha e devolve o foco ao botao, senao o teclado fica perdido.
document.addEventListener("keydown", (evento) => {
  if (evento.key !== "Escape") return;
  if (!menuPerfil.classList.contains("topo__menu--aberto")) return;

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

botaoSair.addEventListener("click", async () => {
  botaoSair.disabled = true;

  if (!semMovimento) {
    document.body.classList.add("saindo");
    await esperarTransicao(document.body);
  }

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
