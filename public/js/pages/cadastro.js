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

//TROCA DE ETAPA
const etapas = document.querySelectorAll(".cadastro__etapa");
const contador = document.querySelector(".cadastro__contador-atual");

function mostrarEtapa(indice, direcao) {
  etapas.forEach((etapa, i) => {
    etapa.classList.remove(
      "cadastro__etapa--ativa",
      "cadastro__etapa--vem-da-direita",
      "cadastro__etapa--vem-da-esquerda"
    );

    if (i !== indice) return;

    etapa.classList.add(
      "cadastro__etapa--ativa",
      direcao === "tras" ? "cadastro__etapa--vem-da-esquerda" : "cadastro__etapa--vem-da-direita"
    );
    etapa.querySelector(".cadastro__input").focus();
  });

  contador.textContent = indice + 1;
}

// A validação dos campos entra junto com o Supabase — por enquanto avança
// sempre, senão não dá para revisar a etapa 2 com os selects ainda vazios.
document.querySelector("[data-acao='proximo']")
  .addEventListener("click", () => mostrarEtapa(1, "frente"));

document.querySelector("[data-acao='voltar']")
  .addEventListener("click", () => mostrarEtapa(0, "tras"));
