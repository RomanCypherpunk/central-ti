// Lógica da recuperação de senha (Supabase Auth) — Fase 1.

import { supabase } from "../config/supabase-config.js";

//O E-MAIL VEM DA TELA DE LOGIN. SEM ELE NAO DA PARA CONFERIR O CODIGO.
const email = sessionStorage.getItem("recuperar_email");

if (!email) {
  window.location.href = "login.html";
}

document.querySelector("[data-email]").textContent = email;

//ENTRADA DA PAGINA: LOGO, TEXTO E FORMULARIO SOBEM COM FADE, EM SEQUENCIA
const ELEMENTOS_ENTRADA = [
  ".recuperar__logo",
  ".recuperar__chamada-titulo",
  ".recuperar__chamada-texto",
  ".recuperar__contador",
  ".recuperar__titulo",
  ".recuperar__subtitulo",
  ".recuperar__etapas",
];

ELEMENTOS_ENTRADA.forEach((seletor, indice) => {
  const elemento = document.querySelector(seletor);
  if (!elemento) return;

  elemento.classList.add("recuperar__entrada");
  elemento.style.setProperty("--entrada-atraso", `${indice * 70}ms`);
});

requestAnimationFrame(() => {
  document.querySelectorAll(".recuperar__entrada")
    .forEach((elemento) => elemento.classList.add("recuperar__entrada--visivel"));
});

//MOSTRAR E ESCONDER SENHA
document.querySelectorAll(".recuperar__olho").forEach((botao) => {
  botao.addEventListener("click", () => {
    const campo = document.getElementById(botao.dataset.alvo);
    const escondida = campo.type === "password";

    campo.type = escondida ? "text" : "password";
    botao.setAttribute("aria-label", escondida ? "Esconder senha" : "Mostrar senha");

    // Reinicia a animação de giro mesmo em cliques seguidos.
    botao.classList.remove("recuperar__olho--alternado");
    void botao.offsetWidth;
    botao.classList.add("recuperar__olho--alternado");
  });
});

//TROCA DE ETAPA
const etapas = document.querySelectorAll(".recuperar__etapa");
const contador = document.querySelector(".recuperar__contador-atual");

function mostrarEtapa(indice, direcao) {
  etapas.forEach((etapa, i) => {
    etapa.classList.remove(
      "recuperar__etapa--ativa",
      "recuperar__etapa--vem-da-direita",
      "recuperar__etapa--vem-da-esquerda"
    );

    if (i !== indice) return;

    etapa.classList.add(
      "recuperar__etapa--ativa",
      direcao === "tras" ? "recuperar__etapa--vem-da-esquerda" : "recuperar__etapa--vem-da-direita"
    );
    etapa.querySelector(".recuperar__input").focus();
  });

  contador.textContent = indice + 1;
}

//MENSAGENS DE ERRO
const erroEtapa1 = document.querySelector("[data-erro='etapa1']");
const erroEtapa2 = document.querySelector("[data-erro='etapa2']");

function mostrarErro(elemento, mensagem) {
  elemento.textContent = mensagem;
  elemento.classList.add("recuperar__erro--visivel");
}

function esconderErro(elemento) {
  elemento.textContent = "";
  elemento.classList.remove("recuperar__erro--visivel");
}

//CAMPOS
const campoCodigo = document.getElementById("codigo");
const campoSenha = document.getElementById("senha");
const campoConfirmar = document.getElementById("confirmar");

//SO DIGITOS NO CAMPO DO CODIGO
campoCodigo.addEventListener("input", () => {
  campoCodigo.value = campoCodigo.value.replace(/\D/g, "");
});

//ETAPA 1: CONFERIR O CODIGO CONTRA O QUE O SUPABASE ENVIOU
const botaoVerificar = document.querySelector("[data-acao='verificar']");

botaoVerificar.addEventListener("click", async () => {
  const codigo = campoCodigo.value.trim();

  if (codigo.length !== 6) {
    mostrarErro(erroEtapa1, "Digite os 6 dígitos do código.");
    return;
  }

  esconderErro(erroEtapa1);
  botaoVerificar.disabled = true;
  botaoVerificar.textContent = "Verificando…";

  // Confere o código e, dando certo, abre a sessão que autoriza trocar a senha.
  const { error } = await supabase.auth.verifyOtp({
    email,
    token: codigo,
    type: "recovery",
  });

  botaoVerificar.disabled = false;
  botaoVerificar.textContent = "Verificar código";

  if (error) {
    mostrarErro(erroEtapa1, "Código inválido ou expirado. Confira o e-mail ou peça outro.");
    return;
  }

  mostrarEtapa(1, "frente");
});

//REENVIAR O CODIGO
const botaoReenviar = document.querySelector("[data-acao='reenviar']");

botaoReenviar.addEventListener("click", async () => {
  botaoReenviar.disabled = true;
  botaoReenviar.textContent = "Enviando…";

  const { error } = await supabase.auth.resetPasswordForEmail(email);

  botaoReenviar.textContent = "Enviar de novo";

  if (error) {
    mostrarErro(erroEtapa1, "Não foi possível reenviar o código. Tente em alguns instantes.");
    botaoReenviar.disabled = false;
    return;
  }

  mostrarErro(erroEtapa1, "Código reenviado. Confira o e-mail.");
  // Espera antes de liberar outro envio: o Supabase limita a frequência.
  setTimeout(() => { botaoReenviar.disabled = false; }, 60000);
});

document.querySelector("[data-acao='voltar']")
  .addEventListener("click", () => mostrarEtapa(0, "tras"));

//ETAPA 2: GRAVAR A NOVA SENHA
const SENHA_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

const formulario = document.querySelector(".recuperar__formulario");
const botaoSalvar = document.querySelector(".recuperar__botao[type='submit']");

formulario.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  if (!SENHA_REGEX.test(campoSenha.value)) {
    mostrarErro(erroEtapa2, "A senha precisa de no mínimo 8 caracteres, com maiúscula, número e símbolo.");
    return;
  }
  if (campoSenha.value !== campoConfirmar.value) {
    mostrarErro(erroEtapa2, "As senhas não coincidem.");
    return;
  }

  esconderErro(erroEtapa2);
  botaoSalvar.disabled = true;
  botaoSalvar.textContent = "Salvando…";

  const { error } = await supabase.auth.updateUser({ password: campoSenha.value });

  if (error) {
    mostrarErro(erroEtapa2, "Não foi possível salvar a nova senha. Tente novamente.");
    botaoSalvar.disabled = false;
    botaoSalvar.textContent = "Salvar nova senha";
    return;
  }

  sessionStorage.removeItem("recuperar_email");
  window.location.href = "index.html";
});
