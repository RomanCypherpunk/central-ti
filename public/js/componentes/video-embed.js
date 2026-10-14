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

// Parâmetros que desligam os controles nativos (legenda, engrenagem, "mais
// vídeos", copiar link). A barra de pausa e volume é nossa, abaixo.
function urlDoPlayer(video) {
  const url = new URL(video.embed);

  if (video.provedor === "youtube") {
    url.searchParams.set("controls", "0");
    url.searchParams.set("disablekb", "1");
    url.searchParams.set("fs", "0");
    url.searchParams.set("rel", "0");
    url.searchParams.set("modestbranding", "1");
    url.searchParams.set("iv_load_policy", "3");
    url.searchParams.set("cc_load_policy", "0");
    url.searchParams.set("playsinline", "1");
    url.searchParams.set("enablejsapi", "1");
    url.searchParams.set("origin", window.location.origin);
  } else {
    url.searchParams.set("controls", "0");
    url.searchParams.set("title", "0");
    url.searchParams.set("byline", "0");
    url.searchParams.set("portrait", "0");
    url.searchParams.set("pip", "0");
    url.searchParams.set("dnt", "1");
  }

  return url;
}

// Comandos por postMessage: dispensa carregar o SDK de cada provedor.
function comandar(iframe, video, url, comando, valor) {
  let mensagem;

  if (video.provedor === "youtube") {
    if (comando === "volume") {
      comandar(iframe, video, url, valor === 0 ? "mudo" : "som");
    }

    const funcoes = {
      play: ["playVideo", []],
      pause: ["pauseVideo", []],
      mudo: ["mute", []],
      som: ["unMute", []],
      volume: ["setVolume", [Math.round(valor * 100)]]
    };
    const [func, args] = funcoes[comando];

    mensagem = { event: "command", func, args };
  } else {
    mensagem = comando === "volume"
      ? { method: "setVolume", value: valor }
      : { method: comando };
  }

  iframe.contentWindow?.postMessage(JSON.stringify(mensagem), url.origin);
}

function botao(rotulo, svg) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "video-controles__botao";
  b.setAttribute("aria-label", rotulo);
  b.innerHTML = svg;

  return b;
}

const ICONE_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICONE_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
const ICONE_VOLUME = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 4V5L7 9z"/><path d="M16 8a5 5 0 0 1 0 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

// Monta o player pronto; devolve null se o link não for válido. A moldura
// recebe `classe` (proporção e borda ficam com cada tela).
export function montarVideoEmbed(texto, classe = "video-embed") {
  const video = normalizarVideoUrl(texto);

  if (!video) return null;

  const url = urlDoPlayer(video);

  const moldura = document.createElement("div");
  moldura.className = `${classe} video-embed`;

  const iframe = document.createElement("iframe");
  iframe.src = url.href;
  iframe.title = "Vídeo do procedimento";
  iframe.loading = "lazy";
  iframe.allow = "autoplay; picture-in-picture";
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  // O clique vai para a nossa barra, não para o player (que sem controles
  // abriria o YouTube ou o Vimeo).
  iframe.tabIndex = -1;

  const controles = document.createElement("div");
  controles.className = "video-controles";

  const alternar = botao("Reproduzir", ICONE_PLAY);
  const volume = document.createElement("input");
  volume.type = "range";
  volume.className = "video-controles__volume";
  volume.min = "0";
  volume.max = "1";
  volume.step = "0.05";
  volume.value = "1";
  volume.setAttribute("aria-label", "Volume");

  let tocando = false;

  const definir = (valor) => {
    tocando = valor;
    alternar.innerHTML = tocando ? ICONE_PAUSE : ICONE_PLAY;
    alternar.setAttribute("aria-label", tocando ? "Pausar" : "Reproduzir");
    comandar(iframe, video, url, tocando ? "play" : "pause");
  };

  alternar.addEventListener("click", () => definir(!tocando));
  moldura.addEventListener("click", (evento) => {
    if (evento.target === moldura || evento.target === iframe) definir(!tocando);
  });
  volume.addEventListener("input", () => comandar(iframe, video, url, "volume", Number(volume.value)));

  const icone = document.createElement("span");
  icone.className = "video-controles__icone";
  icone.innerHTML = ICONE_VOLUME;

  controles.append(alternar, icone, volume);
  moldura.append(iframe, controles);

  return moldura;
}
