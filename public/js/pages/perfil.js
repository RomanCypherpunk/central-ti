// Dados pessoais: foto, nome e troca de senha.

import { supabase } from "../config/supabase-config.js";

const foto = document.querySelector("[data-foto]");
const fotoIniciais = document.querySelector("[data-foto-iniciais]");
const fotoArquivo = document.querySelector("[data-foto-arquivo]");
const fotoRemover = document.querySelector("[data-foto-remover]");
const campoNome = document.querySelector("[data-nome-campo]");
const campoSobrenome = document.querySelector("[data-sobrenome-campo]");
const campoEmail = document.querySelector("[data-email-campo]");
const campoSetor = document.querySelector("[data-setor-campo]");
const botaoSalvar = document.querySelector("[data-salvar]");
const botaoSenha = document.querySelector("[data-trocar-senha]");
const aviso = document.querySelector("[data-aviso]");

const TAMANHO_MAXIMO = 2 * 1024 * 1024;

let eu = null;

function avisar(texto, erro = false) {
  aviso.textContent = texto;
  aviso.classList.add("perfil__aviso--visivel");
  aviso.classList.toggle("perfil__aviso--erro", erro);

  if (erro) return;

  setTimeout(() => aviso.classList.remove("perfil__aviso--visivel"), 3000);
}

function iniciais(nome, sobrenome) {
  const primeira = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  const ultima = (sobrenome ?? "").trim().split(/\s+/).pop() ?? "";

  return (primeira[0] ?? "").concat(ultima[0] ?? "").toUpperCase();
}

//O bucket de avatares e publico, entao a URL e direta e serve para <img>.
//O sufixo de tempo evita o navegador mostrar a foto antiga depois da troca.
function urlDaFoto(caminho) {
  const { data } = supabase.storage.from("avatares").getPublicUrl(caminho);

  return `${data.publicUrl}?v=${Date.now()}`;
}

function desenharFoto() {
  foto.querySelector("img")?.remove();

  if (!eu.foto_path) {
    fotoIniciais.hidden = false;
    fotoRemover.hidden = true;
    return;
  }

  const imagem = document.createElement("img");
  imagem.src = urlDaFoto(eu.foto_path);
  imagem.alt = "";
  // Se o arquivo sumiu do Storage, as iniciais voltam em vez de imagem quebrada.
  imagem.addEventListener("error", () => {
    imagem.remove();
    fotoIniciais.hidden = false;
  });

  fotoIniciais.hidden = true;
  fotoRemover.hidden = false;
  foto.appendChild(imagem);
}

async function carregar() {
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return;

  const { data, error } = await supabase
    .from("usuarios")
    .select("id, nome, sobrenome, email, foto_path, setores(nome)")
    .eq("id", user.id)
    .single();

  if (error) {
    avisar("Não foi possível carregar seus dados. Recarregue a página.", true);
    return;
  }

  eu = data;

  campoNome.value = data.nome ?? "";
  campoSobrenome.value = data.sobrenome ?? "";
  campoEmail.value = data.email ?? "";
  campoSetor.value = data.setores?.nome ?? "—";
  fotoIniciais.textContent = iniciais(data.nome, data.sobrenome);

  desenharFoto();
}

//FOTO NOVA: SOBE PARA O STORAGE E O CAMINHO VAI PARA O PERFIL
fotoArquivo.addEventListener("change", async () => {
  const arquivo = fotoArquivo.files[0];

  if (!arquivo) return;

  if (arquivo.size > TAMANHO_MAXIMO) {
    avisar("A foto precisa ter até 2 MB.", true);
    fotoArquivo.value = "";
    return;
  }

  // O nome do arquivo e o id do usuario: e assim que a policy do bucket
  // garante que ninguem mexe na foto de outra pessoa.
  const extensao = arquivo.name.split(".").pop().toLowerCase();
  const caminho = `${eu.id}.${extensao}`;

  const { error: erroUpload } = await supabase.storage
    .from("avatares")
    .upload(caminho, arquivo, { upsert: true });

  if (erroUpload) {
    avisar("Não foi possível enviar a foto.", true);
    fotoArquivo.value = "";
    return;
  }

  const { error: erroPerfil } = await supabase
    .from("usuarios")
    .update({ foto_path: caminho })
    .eq("id", eu.id);

  if (erroPerfil) {
    avisar("A foto subiu, mas não foi possível salvá-la no perfil.", true);
    return;
  }

  eu.foto_path = caminho;
  fotoArquivo.value = "";
  desenharFoto();
  avisar("Foto atualizada");
});

fotoRemover.addEventListener("click", async () => {
  const { error: erroArquivo } = await supabase.storage
    .from("avatares")
    .remove([eu.foto_path]);

  if (erroArquivo) {
    avisar("Não foi possível remover a foto.", true);
    return;
  }

  const { error } = await supabase
    .from("usuarios")
    .update({ foto_path: null })
    .eq("id", eu.id);

  if (error) {
    avisar("Não foi possível remover a foto.", true);
    return;
  }

  eu.foto_path = null;
  desenharFoto();
  avisar("Foto removida");
});

//NOME
botaoSalvar.addEventListener("click", async () => {
  const nome = campoNome.value.trim();
  const sobrenome = campoSobrenome.value.trim();

  if (!nome) {
    avisar("Informe seu nome.", true);
    campoNome.focus();
    return;
  }

  if (!sobrenome) {
    avisar("Informe seu sobrenome.", true);
    campoSobrenome.focus();
    return;
  }

  if (nome === eu.nome && sobrenome === eu.sobrenome) {
    avisar("Nada para salvar");
    return;
  }

  botaoSalvar.disabled = true;

  const { error } = await supabase
    .from("usuarios")
    .update({ nome, sobrenome })
    .eq("id", eu.id);

  botaoSalvar.disabled = false;

  if (error) {
    avisar("Não foi possível salvar.", true);
    return;
  }

  eu.nome = nome;
  eu.sobrenome = sobrenome;
  fotoIniciais.textContent = iniciais(nome, sobrenome);
  // O topo da pagina mostra so o primeiro nome; sem isso ele so mudaria ao recarregar.
  document.querySelector("[data-nome]").textContent = nome;
  document.querySelector("[data-iniciais]").textContent = iniciais(nome, sobrenome);
  avisar("Nome atualizado");
});

//SENHA: REAPROVEITA O FLUXO DE RECUPERACAO QUE JA EXISTE
botaoSenha.addEventListener("click", async () => {
  botaoSenha.disabled = true;

  const { error } = await supabase.auth.resetPasswordForEmail(eu.email);

  botaoSenha.disabled = false;

  if (error) {
    avisar("Não foi possível enviar o código. Tente em alguns instantes.", true);
    return;
  }

  sessionStorage.setItem("recuperar_email", eu.email);
  window.location.href = "recuperar-senha.html";
});

carregar();
