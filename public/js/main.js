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

  document.querySelector("[data-nome]").textContent = nome;
  // O nome da saudacao e o mesmo gravado no cadastro.
  document.querySelector("[data-saudacao-nome]").textContent = nome;
  document.querySelector("[data-iniciais]").textContent = iniciais(nome);

  const setorId = user.user_metadata?.setor_id;

  if (!setorId) return;

  const { data: setor } = await supabase
    .from("setores")
    .select("nome")
    .eq("id", setorId)
    .single();

  if (!setor) return;

  document.querySelector("[data-setor]").textContent = setor.nome;

  // A Base de Soluções mostra só o setor de quem está logado.
  const marca = document.querySelector("[data-setor-marca]");

  if (marca) marca.textContent = setor.nome;
}

preencherUsuario();

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
