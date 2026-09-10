// Lógica da tela de login (Supabase Auth) — Fase 1.

import { supabase } from "../config/supabase-config.js";

//MOSTRAR E ESCONDER SENHA
document.querySelectorAll(".login__olho").forEach((botao) => {
  botao.addEventListener("click", () => {
    const campo = document.getElementById(botao.dataset.alvo);
    const escondida = campo.type === "password";

    campo.type = escondida ? "text" : "password";
    botao.setAttribute("aria-label", escondida ? "Esconder senha" : "Mostrar senha");
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
