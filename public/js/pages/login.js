// Lógica da tela de login (Supabase Auth) — Fase 1.

//MOSTRAR E ESCONDER SENHA
document.querySelectorAll(".login__olho").forEach((botao) => {
  botao.addEventListener("click", () => {
    const campo = document.getElementById(botao.dataset.alvo);
    const escondida = campo.type === "password";

    campo.type = escondida ? "text" : "password";
    botao.setAttribute("aria-label", escondida ? "Esconder senha" : "Mostrar senha");
  });
});
