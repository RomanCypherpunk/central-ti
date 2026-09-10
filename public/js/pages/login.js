// Lógica da tela de login (Supabase Auth) — Fase 1.

import { supabase } from "../config/supabase-config.js";

//ENTRADA DA PAGINA: LOGO, TEXTO E FORMULARIO SOBEM COM FADE, EM SEQUENCIA
const ELEMENTOS_ENTRADA = [
  ".login__logo",
  ".login__chamada-titulo",
  ".login__chamada-texto",
  ".login__titulo",
  ".login__subtitulo",
  ".login__campo",
];

document.querySelectorAll(ELEMENTOS_ENTRADA.join(",")).forEach((elemento, indice) => {
  elemento.classList.add("login__entrada");
  elemento.style.setProperty("--entrada-atraso", `${indice * 70}ms`);
});

requestAnimationFrame(() => {
  document.querySelectorAll(".login__entrada")
    .forEach((elemento) => elemento.classList.add("login__entrada--visivel"));
});

//MOSTRAR E ESCONDER SENHA
document.querySelectorAll(".login__olho").forEach((botao) => {
  botao.addEventListener("click", () => {
    const campo = document.getElementById(botao.dataset.alvo);
    const escondida = campo.type === "password";

    campo.type = escondida ? "text" : "password";
    botao.setAttribute("aria-label", escondida ? "Esconder senha" : "Mostrar senha");

    // Reinicia a animação de giro mesmo em cliques seguidos.
    botao.classList.remove("login__olho--alternado");
    void botao.offsetWidth;
    botao.classList.add("login__olho--alternado");
  });
});

const erro = document.querySelector("[data-erro='login']");

function mostrarErro(mensagem) {
  erro.textContent = mensagem;
  erro.classList.add("login__erro--visivel");
}

function esconderErro() {
  erro.textContent = "";
  erro.classList.remove("login__erro--visivel");
}

const formulario = document.querySelector(".login__formulario");
const campoEmail = document.getElementById("email");
const campoSenha = document.getElementById("senha");
const botaoEntrar = document.querySelector(".login__botao[type='submit']");

formulario.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  esconderErro();

  botaoEntrar.disabled = true;
  botaoEntrar.textContent = "Entrando…";

  const { error } = await supabase.auth.signInWithPassword({
    email: campoEmail.value.trim(),
    password: campoSenha.value,
  });

  if (error) {
    mostrarErro("E-mail ou senha incorretos.");
    botaoEntrar.disabled = false;
    botaoEntrar.textContent = "Entrar";
    return;
  }

  window.location.href = "index.html";
});

//ESQUECEU A SENHA: MANDA O CODIGO E LEVA PARA A TELA DE RECUPERACAO
const botaoEsqueci = document.querySelector("[data-acao='esqueci']");

botaoEsqueci.addEventListener("click", async () => {
  const email = campoEmail.value.trim();

  // O código precisa de um destinatário, e quem sabe qual é o e-mail é esta tela.
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    mostrarErro("Informe o e-mail corporativo para receber o código.");
    campoEmail.focus();
    return;
  }

  esconderErro();
  botaoEsqueci.disabled = true;
  botaoEsqueci.textContent = "Enviando…";

  const { error } = await supabase.auth.resetPasswordForEmail(email);

  if (error) {
    mostrarErro("Não foi possível enviar o código. Tente em alguns instantes.");
    botaoEsqueci.disabled = false;
    botaoEsqueci.textContent = "Esqueceu a senha?";
    return;
  }

  // sessionStorage, e não a URL: e-mail não deve trafegar em query string.
  sessionStorage.setItem("recuperar_email", email);
  window.location.href = "recuperar-senha.html";
});
