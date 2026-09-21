import { supabase, SUPABASE_URL } from "../config/supabase-config.js";

const BUCKETS = new Set(["artigos", "terceiros", "avatares"]);
const cache = new Map();
const imagensPendentes = new WeakMap();
let geracao = 0;
const VALIDADE = 300;

supabase.auth.onAuthStateChange(() => {
  geracao += 1;
  cache.clear();
});

export function invalidarStoragePrivado(bucket) {
  for (const chave of cache.keys()) {
    if (chave.includes(`:${bucket}:`)) cache.delete(chave);
  }
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

export function pintarImagemPrivada(img, bucket, referencia, aoFalhar = () => {}) {
  const pedido = {};
  imagensPendentes.set(img, pedido);
  img.removeAttribute("src");
  urlStoragePrivado(bucket, referencia).then(url => {
    if (imagensPendentes.get(img) === pedido) img.src = url;
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
