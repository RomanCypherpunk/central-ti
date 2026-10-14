import { prepararArquivoParaUpload } from "./otimizar-upload.js";

const VIDEOS = { "video/mp4": true, "video/webm": true, "video/quicktime": true };
const EXTENSOES = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
export function tipoVideo(arquivo) {
  if (VIDEOS[arquivo.type]) return arquivo.type;
  if (!arquivo.type || arquivo.type === "application/octet-stream") {
    return EXTENSOES[arquivo.name.toLowerCase().split(".").pop()] || null;
  }
  return null;
}
export function validarArquivoParaUpload(arquivo) {
  if (!arquivo) throw new Error("Selecione um arquivo.");
  const video = tipoVideo(arquivo);
  const pdf = arquivo.type === "application/pdf";
  const imagem = arquivo.type.startsWith("image/");
  if (!video && !pdf && !imagem) throw new Error(`${arquivo.name}: use imagem, PDF ou vídeo MP4, MOV ou WebM.`);
  const limite = video ? 50 : pdf ? 5 : 10;
  if (arquivo.size > limite * 1024 * 1024) throw new Error(`${arquivo.name}: limite de ${limite} MB.`);
}
export async function prepararArquivoParaUploadChamado(arquivo) {
  validarArquivoParaUpload(arquivo);
  const tipo = tipoVideo(arquivo);
  if (tipo) return arquivo.type === tipo ? arquivo : new File([arquivo], arquivo.name, { type: tipo, lastModified: arquivo.lastModified });
  return prepararArquivoParaUpload(arquivo);
}
