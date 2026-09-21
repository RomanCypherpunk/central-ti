import { supabase, SUPABASE_URL } from "../config/supabase-config.js";

const BUCKETS = new Set(["artigos", "terceiros", "avatares", "fundos-portal", "anexos"]);
const cache = new Map();
const imagensPendentes = new WeakMap();
let geracao = 0;
const VALIDADE = 300;
const PREFIXO_CACHE_IMAGENS = "central-ti-imagens-v1";
const TAMANHO_MAXIMO_CACHE_IMAGEM = 2 * 1024 * 1024;
let donoDoCache = null;

function cacheDisponivel() {
  return typeof window !== "undefined" && "caches" in window;
}

function nomeDoCache(usuarioId, bucket) {
  return `${PREFIXO_CACHE_IMAGENS}:${usuarioId}:${bucket}`;
}

async function apagarCachesDoUsuario(usuarioId) {
  if (!usuarioId || !cacheDisponivel()) return;

  const prefixo = `${PREFIXO_CACHE_IMAGENS}:${usuarioId}:`;
  const nomes = await caches.keys();
  await Promise.all(nomes.filter((nome) => nome.startsWith(prefixo)).map((nome) => caches.delete(nome)));
}

supabase.auth.onAuthStateChange((_evento, sessao) => {
  const proximoDono = sessao?.user?.id ?? null;
  const anterior = donoDoCache;
  donoDoCache = proximoDono;
  geracao += 1;
  cache.clear();

  // Imagens privadas não ficam disponíveis para quem entrar depois no mesmo
  // navegador. A limpeza é assíncrona para nunca atrasar o login ou logout.
  if (anterior && anterior !== proximoDono) apagarCachesDoUsuario(anterior).catch(() => {});
});

export function invalidarStoragePrivado(bucket) {
  for (const chave of cache.keys()) {
    if (chave.includes(`:${bucket}:`)) cache.delete(chave);
  }

  if (donoDoCache && cacheDisponivel()) caches.delete(nomeDoCache(donoDoCache, bucket)).catch(() => {});
}

export function caminhoStoragePrivado(bucket, referencia) {
  if (!BUCKETS.has(bucket) || typeof referencia !== "string" || !referencia) throw new Error("Arquivo indisponível.");
  let caminho = referencia;
  if (/^[a-z][a-z0-9+.-]*:/i.test(referencia)) {
    const url = new URL(referencia);
    if (url.origin !== new URL(SUPABASE_URL).origin || url.username || url.password) throw new Error("Origem não permitida.");
    const prefixo = ["public", "sign"].map(tipo => `/storage/v1/object/${tipo}/${bucket}/`)
      .find(valor => url.pathname.startsWith(valor));
    if (!prefixo) throw new Error("Bucket não permitido.");
    caminho = url.pathname.slice(prefixo.length).split("/").map(decodeURIComponent).join("/");
  }
  if (/[\\\u0000-\u001f\u007f]/.test(caminho)
      || caminho.split("/").some(parte => !parte || parte === "." || parte === "..")) throw new Error("Caminho inválido.");
  return caminho;
}

export async function urlStoragePrivado(bucket, referencia) {
  const caminho = caminhoStoragePrivado(bucket, referencia);
  const { data: { session }, error: erroSessao } = await supabase.auth.getSession();
  if (erroSessao || !session?.user?.id) throw new Error("Sessão expirada.");
  const chave = `${session.user.id}:${bucket}:${caminho}`;
  const anterior = cache.get(chave);
  if (anterior && anterior.expira > Date.now()) return anterior.url;
  const versao = geracao;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(caminho, VALIDADE);
  if (error || !data?.signedUrl) throw new Error("Acesso negado.");
  if (versao !== geracao) throw new Error("A sessão mudou.");
  cache.set(chave, { url: data.signedUrl, expira: Date.now() + (VALIDADE - 30) * 1000 });
  return data.signedUrl;
}

function chaveDaImagemNoCache(caminho) {
  const partes = caminho.split("/").map(encodeURIComponent).join("/");
  return new Request(`${window.location.origin}/__central-ti-imagens/${partes}`);
}

// Cache Storage persiste entre páginas, mas é separado por usuário e bucket.
// Só imagens pequenas entram nele; PDF e arquivos grandes continuam abrindo
// diretamente pelo Storage, sem ocupar o navegador do usuário.
export async function blobImagemPrivada(bucket, referencia) {
  const caminho = caminhoStoragePrivado(bucket, referencia);
  const { data: { session }, error: erroSessao } = await supabase.auth.getSession();
  const usuarioId = session?.user?.id;

  if (erroSessao || !usuarioId) throw new Error("Sessão expirada.");

  let armazenamento = null;
  let chave = null;

  if (cacheDisponivel()) {
    try {
      armazenamento = await caches.open(nomeDoCache(usuarioId, bucket));
      chave = chaveDaImagemNoCache(caminho);
      const guardada = await armazenamento.match(chave);

      if (guardada) return guardada.blob();
    } catch {
      // Se Cache Storage estiver bloqueado, a imagem ainda abre normalmente.
      armazenamento = null;
      chave = null;
    }
  }

  const resposta = await fetch(await urlStoragePrivado(bucket, caminho));
  if (!resposta.ok) throw new Error("Não foi possível carregar a imagem.");

  const blob = await resposta.blob();
  if (!blob.type.startsWith("image/")) throw new Error("Arquivo não é uma imagem.");

  if (armazenamento && chave && blob.size <= TAMANHO_MAXIMO_CACHE_IMAGEM) {
    try {
      await armazenamento.put(chave, new Response(blob, { headers: { "content-type": blob.type } }));
    } catch {
      // Quota cheia ou cache indisponível não impede que a imagem apareça.
    }
  }

  return blob;
}

export function pintarImagemPrivada(img, bucket, referencia, aoFalhar = () => {}) {
  const pedido = {};
  imagensPendentes.set(img, pedido);
  img.removeAttribute("src");
  blobImagemPrivada(bucket, referencia).then((blob) => {
    const url = URL.createObjectURL(blob);

    if (imagensPendentes.get(img) !== pedido) {
      URL.revokeObjectURL(url);
      return;
    }

    const liberar = () => URL.revokeObjectURL(url);
    img.addEventListener("load", liberar, { once: true });
    img.addEventListener("error", liberar, { once: true });
    img.src = url;
  }).catch(() => {
    if (imagensPendentes.get(img) === pedido) aoFalhar();
  });
}

export async function abrirArquivoPrivado(bucket, referencia) {
  const janela = window.open("about:blank", "_blank");
  if (janela) janela.opener = null;
  try {
    const url = await urlStoragePrivado(bucket, referencia);
    if (janela) janela.location.replace(url);
    else window.location.assign(url);
  } catch {
    janela?.close();
    window.alert("Não foi possível abrir o arquivo.");
  }
}
