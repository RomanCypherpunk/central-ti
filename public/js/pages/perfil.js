// Dados pessoais: foto, nome e troca de senha.

import { supabase } from "../config/supabase-config.js";
import { marcarMinhaFotoTrocada } from "../componentes/avatar.js";
import { pintarImagemPrivada } from "../componentes/storage-privado.js";
import { prepararArquivoParaUpload } from "../componentes/otimizar-upload.js";

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
const linkVoltar = document.querySelector("[data-voltar]");

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

//O avatar do topo e do main.js: ele escuta este evento e se redesenha.
function avisarTopo(detalhe) {
  window.dispatchEvent(new CustomEvent("perfil:atualizado", { detail: detalhe }));
}

//VOLTAR PARA ONDE A PESSOA ESTAVA. "Dados pessoais" e aberto do menu de
//varias telas (Início, Base, Portal, Painel…), entao nao ha uma so pagina
//"anterior" fixa para linkar — o historico do navegador e que sabe qual foi.
//
//So volta se o registro anterior for realmente daqui: history.back() sem
//essa checagem levaria para fora do site (ou para nada) em quem abriu a
//tela direto por um link salvo, favorito ou aba nova. Nesses casos cai no
//destino de reserva do proprio link (index.html).
function podeVoltarNoHistorico() {
  if (window.history.length <= 1) return false;

  try {
    return new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}

function voltar() {
  if (podeVoltarNoHistorico()) window.history.back();
  else window.location.href = linkVoltar.href;
}

linkVoltar.addEventListener("click", (evento) => {
  // Ctrl/Cmd/Shift/Alt ou botao do meio: a pessoa escolheu abrir em outra
  // aba ou janela. O href="index.html" ja resolve isso sozinho.
  if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
  if (evento.button !== 0) return;

  evento.preventDefault();
  voltar();
});

function desenharFoto() {
  foto.querySelector("img")?.remove();

  if (!eu.foto_path) {
    fotoIniciais.hidden = false;
    fotoRemover.hidden = true;
    return;
  }

  const imagem = document.createElement("img");
  pintarImagemPrivada(imagem, "avatares", eu.foto_path, () => {
    imagem.remove();
    fotoIniciais.hidden = false;
  });
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
  let arquivo = fotoArquivo.files[0];

  if (!arquivo) return;

  arquivo = await prepararArquivoParaUpload(arquivo);

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
    .upload(caminho, arquivo, { upsert: true, contentType: arquivo.type, cacheControl: "3600" });

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
  // Gravou por cima do mesmo caminho: versao nova para esta tela, o topo e
  // as proximas paginas deixarem a foto antiga do cache.
  marcarMinhaFotoTrocada();
  desenharFoto();
  avisarTopo({ fotoPath: caminho });
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
  avisarTopo({ fotoPath: null });
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
  // As iniciais passam pelo main.js: escrever direto no avatar apagaria a
  // foto. Ainda assim atualiza aqui, porque a proxima tela (Início, Base,
  // Portal…) le o topo guardado antes do main.js confirmar com o banco —
  // ver CHAVE_TOPO em main.js.
  avisarTopo({ iniciais: iniciais(nome, sobrenome), nome });

  // Salvou: volta para onde a pessoa estava, igual ao salvar uma solucao
  // (nova-solucao.js) — sem toast de "Nome atualizado" no meio do caminho,
  // porque a pagina muda antes de dar tempo de ler.
  voltar();
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
