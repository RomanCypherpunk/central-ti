// Vídeo de procedimento hospedado fora (Vimeo ou YouTube, não listado).
// O que vai para o iframe é sempre uma URL montada aqui a partir do id
// extraído, nunca o texto que a pessoa colou: assim um domínio arbitrário
// não consegue entrar na página.

const ID_YOUTUBE = /^[\w-]{11}$/;
const ID_VIMEO = /^\d{6,12}$/;
const HASH_VIMEO = /^[\da-f]{6,32}$/i;

function lerUrl(texto) {
  const bruto = String(texto ?? "").trim();

  if (!bruto) return null;

  try {
    const url = new URL(/^https?:\/\//i.test(bruto) ? bruto : `https://${bruto}`);

    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function lerYoutube(url) {
  const host = url.hostname.replace(/^(www|m)\./, "");
  const partes = url.pathname.split("/").filter(Boolean);
  let id = null;

  if (host === "youtu.be") id = partes[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (partes[0] === "watch") id = url.searchParams.get("v");
    else if (["shorts", "embed", "live"].includes(partes[0])) id = partes[1];
  }

  return id && ID_YOUTUBE.test(id) ? { provedor: "youtube", id } : null;
}

function lerVimeo(url) {
  const host = url.hostname.replace(/^www\./, "");
  const partes = url.pathname.split("/").filter(Boolean);

  if (host === "player.vimeo.com" && partes[0] === "video") partes.shift();
  else if (host !== "vimeo.com") return null;

  const [id, hash] = partes;

  if (!id || !ID_VIMEO.test(id)) return null;

  // Vídeo não listado: vimeo.com/ID/HASH, ou ?h=HASH no player.
  const chave = hash ?? url.searchParams.get("h");

  return { provedor: "vimeo", id, hash: chave && HASH_VIMEO.test(chave) ? chave : null };
}

// Devolve { provedor, id, hash?, embed } ou null se o link não for aceito.
export function normalizarVideoUrl(texto) {
  const url = lerUrl(texto);

  if (!url) return null;

  const video = lerYoutube(url) ?? lerVimeo(url);

  if (!video) return null;

  if (video.provedor === "youtube") {
    return { ...video, embed: `https://www.youtube-nocookie.com/embed/${video.id}` };
  }

  const sufixo = video.hash ? `?h=${video.hash}` : "";

  return { ...video, embed: `https://player.vimeo.com/video/${video.id}${sufixo}` };
}

// Monta o <iframe> pronto; devolve null se o link não for válido.
export function montarVideoEmbed(texto, classe = "video-embed") {
  const video = normalizarVideoUrl(texto);

  if (!video) return null;

  const moldura = document.createElement("div");
  moldura.className = classe;

  const iframe = document.createElement("iframe");
  iframe.src = video.embed;
  iframe.title = "Vídeo do procedimento";
  iframe.loading = "lazy";
  iframe.allow = "fullscreen; picture-in-picture";
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = "strict-origin-when-cross-origin";

  moldura.appendChild(iframe);

  return moldura;
}
