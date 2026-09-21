// Prepara arquivos antes de enviá-los ao Storage. A conversão acontece no
// navegador: o arquivo original nunca é enviado para o servidor.

export const LIMITE_PDF_BYTES = 5 * 1024 * 1024;
const MAIOR_LADO_IMAGEM = 1920;
const QUALIDADE_WEBP = 0.8;

function ePdf(arquivo) {
  return arquivo.type === "application/pdf" || arquivo.name.toLowerCase().endsWith(".pdf");
}

function eImagemRaster(arquivo) {
  return arquivo.type.startsWith("image/")
    && arquivo.type !== "image/gif"
    && arquivo.type !== "image/svg+xml";
}

function nomeWebp(nome) {
  const base = nome.replace(/\.[^.]+$/, "") || "imagem";
  return `${base}.webp`;
}

export function validarArquivoParaUpload(arquivo) {
  if (!arquivo) throw new Error("Selecione um arquivo válido.");

  if (ePdf(arquivo) && arquivo.size > LIMITE_PDF_BYTES) {
    throw new Error(`O PDF \"${arquivo.name}\" ultrapassa o limite de 5 MB.`);
  }
}

// PNG, JPEG, WebP e formatos que o navegador consiga decodificar viram WebP
// com no máximo 1920 px no maior lado. GIF e SVG são mantidos para não perder
// animação ou vetores. Se WebP não reduzir o tamanho, preservamos o original.
export async function prepararArquivoParaUpload(arquivo) {
  validarArquivoParaUpload(arquivo);

  if (!eImagemRaster(arquivo) || !window.createImageBitmap) return arquivo;

  let bitmap;

  try {
    bitmap = await window.createImageBitmap(arquivo);

    const escala = Math.min(1, MAIOR_LADO_IMAGEM / Math.max(bitmap.width, bitmap.height));
    const largura = Math.max(1, Math.round(bitmap.width * escala));
    const altura = Math.max(1, Math.round(bitmap.height * escala));
    const canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = altura;

    const contexto = canvas.getContext("2d");
    if (!contexto) return arquivo;

    contexto.drawImage(bitmap, 0, 0, largura, altura);
    const webp = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", QUALIDADE_WEBP));

    if (!webp || webp.size >= arquivo.size) return arquivo;

    return new File([webp], nomeWebp(arquivo.name), {
      type: "image/webp",
      lastModified: arquivo.lastModified,
    });
  } catch {
    // Alguns formatos de câmera não são decodificados por todos os browsers.
    // Nesses casos, o envio normal continua funcionando.
    return arquivo;
  } finally {
    bitmap?.close?.();
  }
}
