// Avatar de pessoa: a foto enviada em "Dados pessoais" ou, sem foto, as
// iniciais. Topo, Portal, Painel, Solicitações e Perfil desenham por aqui.
//
// O que evita a foto piscar:
// - Com foto, as iniciais NÃO aparecem enquanto a imagem carrega: o círculo
//   fica só com a cor de fundo e a foto entra por cima. Antes as letras
//   apareciam e eram trocadas pela foto a cada redesenho (troca de página,
//   busca, tempo real) — era essa troca que piscava.
// - Sem loading="lazy": avatar é pequeno e está na tela; o lazy atrasava até
//   a foto que o navegador já tinha em cache.
// - URL estável (nada de Date.now() a cada carga), para o cache valer entre
//   páginas. Quem troca a própria foto ganha uma versão nova
//   (marcarMinhaFotoTrocada), porque o arquivo é gravado por cima do mesmo
//   caminho e sem isso o navegador mostraria a antiga.
// - Redesenhar com a mesma URL não recria a imagem.
// As iniciais só aparecem sem foto ou quando o arquivo falha.

import { invalidarStoragePrivado, pintarImagemPrivada } from "./storage-privado.js";

const CHAVE_VERSAO = "avatar-versao";

export function versaoDaMinhaFoto() {
  try {
    return localStorage.getItem(CHAVE_VERSAO);
  } catch {
    return null;
  }
}

export function marcarMinhaFotoTrocada() {
  const versao = String(Date.now());
  invalidarStoragePrivado("avatares");

  try {
    localStorage.setItem(CHAVE_VERSAO, versao);
  } catch {
    // Sem localStorage a versão nova vale só para esta página.
  }

  return versao;
}

//elemento: o circulo do avatar (cada tela tem a sua classe e o seu tamanho).
//classeFoto: classe da <img>, para as telas que estilizam a foto por classe.
//versao: forca uma URL nova depois de trocar a foto.
export function pintarFoto(elemento, fotoPath, letras, { classeFoto = "", versao = null } = {}) {
  if (!fotoPath) {
    delete elemento.dataset.fotoUrl;
    elemento.textContent = letras;
    return;
  }

  const referencia = versao ? `${fotoPath}?v=${encodeURIComponent(versao)}` : fotoPath;

  if (elemento.dataset.fotoUrl === referencia && elemento.querySelector("img")) return;

  elemento.dataset.fotoUrl = referencia;

  const foto = document.createElement("img");

  if (classeFoto) foto.className = classeFoto;
  foto.alt = "";
  foto.decoding = "async";
  // Arquivo sumido do Storage: as iniciais no lugar, nunca imagem quebrada.
  // So vale se o circulo ainda estiver esperando esta mesma foto.
  foto.addEventListener("error", () => {
    if (elemento.dataset.fotoUrl !== referencia) return;

    delete elemento.dataset.fotoUrl;
    elemento.textContent = letras;
  }, { once: true });
  pintarImagemPrivada(foto, "avatares", fotoPath, () => {
    if (elemento.dataset.fotoUrl !== referencia) return;
    delete elemento.dataset.fotoUrl;
    elemento.textContent = letras;
  });

  elemento.replaceChildren(foto);
}
