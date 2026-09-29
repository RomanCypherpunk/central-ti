// Lógica da tela de cadastro (Supabase Auth) — Fase 1.

import { supabase } from "../config/supabase-config.js";

//ENTRADA DA PAGINA: LOGO, TEXTO E FORMULARIO SOBEM COM FADE, EM SEQUENCIA
const ELEMENTOS_ENTRADA = [
  ".cadastro__logo",
  ".cadastro__chamada-titulo",
  ".cadastro__chamada-texto",
  ".cadastro__contador",
  ".cadastro__titulo",
  ".cadastro__subtitulo",
  ".cadastro__etapas",
];

ELEMENTOS_ENTRADA.forEach((seletor, indice) => {
  const elemento = document.querySelector(seletor);
  if (!elemento) return;

  elemento.classList.add("cadastro__entrada");
  elemento.style.setProperty("--entrada-atraso", `${indice * 70}ms`);
});

requestAnimationFrame(() => {
  document.querySelectorAll(".cadastro__entrada")
    .forEach((elemento) => elemento.classList.add("cadastro__entrada--visivel"));
});

//MOSTRAR E ESCONDER SENHA
document.querySelectorAll(".cadastro__olho").forEach((botao) => {
  botao.addEventListener("click", () => {
    const campo = document.getElementById(botao.dataset.alvo);
    const escondida = campo.type === "password";

    campo.type = escondida ? "text" : "password";
    botao.setAttribute("aria-label", escondida ? "Esconder senha" : "Mostrar senha");

    // Reinicia a animação de giro mesmo em cliques seguidos.
    botao.classList.remove("cadastro__olho--alternado");
    void botao.offsetWidth;
    botao.classList.add("cadastro__olho--alternado");
  });
});

//PULSO NO SELECT QUANDO UMA OPCAO E ESCOLHIDA
document.querySelectorAll(".cadastro__select").forEach((select) => {
  select.addEventListener("change", () => {
    select.classList.remove("cadastro__select--escolhido");
    void select.offsetWidth;
    select.classList.add("cadastro__select--escolhido");
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

//MENSAGENS DE ERRO
const erroEtapa1 = document.querySelector("[data-erro='etapa1']");
const erroEtapa2 = document.querySelector("[data-erro='etapa2']");

function mostrarErro(elemento, mensagem) {
  elemento.textContent = mensagem;
  elemento.classList.add("cadastro__erro--visivel");
}

function esconderErro(elemento) {
  elemento.textContent = "";
  elemento.classList.remove("cadastro__erro--visivel");
}

//CAMPOS
const campoNome = document.getElementById("nome");
const campoSobrenome = document.getElementById("sobrenome");
const campoSetor = document.getElementById("setor");
const campoUnidade = document.getElementById("unidade");
const campoEmail = document.getElementById("email");
const campoSenha = document.getElementById("senha");
const campoConfirmar = document.getElementById("confirmar");

// RESTO DA ANTIGA ETAPA DE CODIGO. Quando o cadastro exigia confirmar o
// e-mail, esta chave guardava o e-mail pendente na aba para reabrir a tela
// do codigo ao recarregar. A etapa nao existe mais, mas quem estava no meio
// de um cadastro na hora da troca ainda pode ter a chave na aba — apagar
// aqui evita qualquer resto de estado antigo.
sessionStorage.removeItem("central-ti:cadastro-pendente");

//POPULAR SETOR E UNIDADE A PARTIR DO SUPABASE
async function popularSelect(select, tabela) {
  const { data, error } = await supabase
    .from(tabela)
    .select("id, nome")
    .eq("ativo", true)
    .order("nome");

  if (error) {
    mostrarErro(erroEtapa1, "Não foi possível carregar as opções. Recarregue a página.");
    return;
  }

  data.forEach((registro) => {
    const opcao = document.createElement("option");
    opcao.value = registro.id;
    opcao.textContent = registro.nome;
    select.appendChild(opcao);
  });
}

popularSelect(campoSetor, "setores");
popularSelect(campoUnidade, "unidades");

//VALIDACAO DA ETAPA 1
function validarEtapa1() {
  if (!campoNome.value.trim()) {
    mostrarErro(erroEtapa1, "Informe seu nome.");
    return false;
  }
  if (!campoSobrenome.value.trim()) {
    mostrarErro(erroEtapa1, "Informe seu sobrenome.");
    return false;
  }
  if (!campoSetor.value) {
    mostrarErro(erroEtapa1, "Selecione o setor.");
    return false;
  }
  if (!campoUnidade.value) {
    mostrarErro(erroEtapa1, "Selecione a unidade.");
    return false;
  }
  esconderErro(erroEtapa1);
  return true;
}

//VALIDACAO DA ETAPA 2
const SENHA_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,128}$/;

function validarEtapa2() {
  // QUALQUER DOMINIO SERVE, de propósito: parceiros e terceiros (Movelex,
  // Gmail, Hotmail) também abrem chamado. Quem controla o acesso não é o
  // domínio do e-mail — é a aprovação do TI (status_aprovacao).
  if (!/^\S+@\S+\.\S+$/.test(campoEmail.value.trim())) {
    mostrarErro(erroEtapa2, "Informe um e-mail válido.");
    return false;
  }
  if (!SENHA_REGEX.test(campoSenha.value)) {
    mostrarErro(erroEtapa2, "A senha precisa de 8 caracteres, com minúscula, maiúscula, número e símbolo.");
    return false;
  }
  if (campoSenha.value !== campoConfirmar.value) {
    mostrarErro(erroEtapa2, "As senhas não coincidem.");
    return false;
  }
  esconderErro(erroEtapa2);
  return true;
}

document.querySelector("[data-acao='proximo']")
  .addEventListener("click", () => {
    if (validarEtapa1()) mostrarEtapa(1, "frente");
  });

document.querySelector("[data-acao='voltar']")
  .addEventListener("click", () => mostrarEtapa(0, "tras"));

//ENVIO DO CADASTRO
const formulario = document.querySelector(".cadastro__formulario");
const botaoCriar = document.querySelector(".cadastro__botao[type='submit']");

const MENSAGENS_ERRO_SUPABASE = {
  user_already_exists: "Já existe uma conta com esse e-mail.",
  weak_password: "A senha é fraca demais. Escolha uma senha mais forte.",
};

formulario.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  if (!validarEtapa1()) {
    mostrarEtapa(0, "tras");
    return;
  }
  if (!validarEtapa2()) return;

  botaoCriar.disabled = true;
  botaoCriar.textContent = "Criando conta…";

  const { data, error } = await supabase.auth.signUp({
    email: campoEmail.value.trim(),
    password: campoSenha.value,
    options: {
      data: {
        nome: campoNome.value.trim(),
        sobrenome: campoSobrenome.value.trim(),
        setor_id: campoSetor.value,
        unidade_id: campoUnidade.value,
      },
    },
  });

  if (error) {
    botaoCriar.disabled = false;
    botaoCriar.textContent = "Criar conta";
    mostrarErro(erroEtapa2, MENSAGENS_ERRO_SUPABASE[error.code] ?? "Não foi possível criar a conta. Tente novamente.");
    return;
  }

  // SEM CODIGO POR E-MAIL: com a confirmacao desligada no Supabase, o
  // cadastro ja devolve a sessao — a pessoa entra direto, e o chamado de
  // Aprovação de Acesso nasce no mesmo instante (handle_new_user no banco).
  // O botao continua desabilitado: a pagina vai mudar.
  if (data.session) {
    window.location.href = "index.html";
    return;
  }

  // Sem sessao, o servidor ainda exige confirmar o e-mail: a opcao "Confirm
  // email" continua ligada no painel do Supabase. A conta foi criada, mas a
  // pessoa nao consegue entrar — nao adianta mandar para o login. Avisa com
  // clareza em vez de fingir que deu certo.
  botaoCriar.disabled = false;
  botaoCriar.textContent = "Criar conta";
  console.warn("Cadastro criado sem sessão: a confirmação de e-mail ainda está ligada no Supabase (Authentication > Providers > Email > Confirm email).");
  mostrarErro(erroEtapa2, "Sua conta foi criada, mas ainda não pôde ser liberada para entrar. Avise a equipe de TI.");
});
