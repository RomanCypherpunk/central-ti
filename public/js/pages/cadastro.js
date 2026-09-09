// Lógica da tela de cadastro (Supabase Auth) — Fase 1.

//MOSTRAR E ESCONDER SENHA
document.querySelectorAll(".cadastro__olho").forEach((botao) => {
  botao.addEventListener("click", () => {
    const campo = document.getElementById(botao.dataset.alvo);
    const escondida = campo.type === "password";

    campo.type = escondida ? "text" : "password";
    botao.setAttribute("aria-label", escondida ? "Esconder senha" : "Mostrar senha");
  });
});
