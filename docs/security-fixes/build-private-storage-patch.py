"""Build a reviewable patch without changing application files.

python docs/security-fixes/build-private-storage-patch.py
git apply --check docs/security-fixes/private-storage.patch
"""
from pathlib import Path
import difflib
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
changes = {}


def replace(path, old, new):
    original, current = changes.get(path, (None, None))
    if original is None:
        original = current = (ROOT / path).read_text(encoding="utf-8")
    if current.count(old) != 1:
        raise ValueError(f"Expected one replacement in {path}, got {current.count(old)}")
    changes[path] = (original, current.replace(old, new))


config = "public/js/config/supabase-config.js"
replace(config, 'const SUPABASE_URL = ', 'export const SUPABASE_URL = ')

base = "public/js/pages/base.js"
replace(base, 'import { pintarFoto } from "../componentes/avatar.js";',
        'import { pintarFoto } from "../componentes/avatar.js";\n'
        'import { pintarImagemPrivada, urlStoragePrivado, abrirArquivoPrivado } from "../componentes/storage-privado.js";')
replace(base, "return div.innerHTML;", '''return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");''')
replace(base, 'src="${escapar(img.url)}"', 'data-arquivo-artigo="${escapar(img.url)}"')
replace(base, 'href="${escapar(anexo.url)}"', 'href="#" data-arquivo-artigo="${escapar(anexo.url)}"')
replace(base, '''  painelCorpoEl.querySelectorAll(".painel-passo__imagem").forEach((img) => {
    img.addEventListener("click", () => abrirLightbox(img.src, img.alt));
  });''', '''  painelCorpoEl.querySelectorAll(".painel-passo__imagem").forEach((img) => {
    pintarImagemPrivada(img, "artigos", img.dataset.arquivoArtigo);
    img.addEventListener("click", async () => {
      try {
        abrirLightbox(await urlStoragePrivado("artigos", img.dataset.arquivoArtigo), img.alt);
      } catch {
        window.alert("Imagem indisponível para sua sessão.");
      }
    });
  });
  painelCorpoEl.querySelectorAll("a[data-arquivo-artigo]").forEach((link) => {
    link.addEventListener("click", (evento) => {
      evento.preventDefault();
      abrirArquivoPrivado("artigos", link.dataset.arquivoArtigo);
    });
  });''')
replace(base, "const resposta = await fetch(url);", 'const resposta = await fetch(await urlStoragePrivado("artigos", url));')

editor = "public/js/pages/nova-solucao.js"
replace(editor, 'import { supabase } from "../config/supabase-config.js";',
        'import { supabase } from "../config/supabase-config.js";\n'
        'import { pintarImagemPrivada } from "../componentes/storage-privado.js";')
replace(editor, '''function urlDaImagem(item) {
  return item instanceof File ? URL.createObjectURL(item) : item.url;
}

''', '')
replace(editor, '    img.src = urlDaImagem(arquivo);', '''    if (arquivo instanceof File) {
      const previa = URL.createObjectURL(arquivo);
      img.addEventListener("load", () => URL.revokeObjectURL(previa), { once: true });
      img.addEventListener("error", () => URL.revokeObjectURL(previa), { once: true });
      img.src = previa;
    } else {
      pintarImagemPrivada(img, "artigos", arquivo.url);
    }''')
replace(editor, '''  const { data } = supabase.storage.from(BUCKET).getPublicUrl(caminho);

  return data.publicUrl;''', '''  // Persistir somente o path; assinar apenas no momento de exibir/baixar.
  return caminho;''')

portal = "public/js/pages/portal.js"
replace(portal, 'import { supabase } from "../config/supabase-config.js";',
        'import { supabase } from "../config/supabase-config.js";\n'
        'import { pintarImagemPrivada } from "../componentes/storage-privado.js";')
replace(portal, '    const { data } = supabase.storage.from("terceiros").getPublicUrl(fornecedor.foto_path);\n', '')
replace(portal, '    img.src = data.publicUrl;', '''    pintarImagemPrivada(img, "terceiros", fornecedor.foto_path,
      () => { elemento.innerHTML = ICONE_TERCEIRO_SVG; });''')

painel = "public/js/pages/painel.js"
replace(painel, 'import { supabase } from "../config/supabase-config.js";',
        'import { supabase } from "../config/supabase-config.js";\n'
        'import { pintarImagemPrivada } from "../componentes/storage-privado.js";')
replace(painel, '    const { data } = supabase.storage.from(contexto.bucketFoto).getPublicUrl(editando.foto_path);\n', '')
replace(painel, '    img.src = `${data.publicUrl}?v=${Date.now()}`;', '''    pintarImagemPrivada(img, contexto.bucketFoto, editando.foto_path,
      () => { if (avatarFoto.contains(img)) avatarFoto.innerHTML = ICONE_PADRAO_FOTO; });''')

helperpath = "public/js/componentes/storage-privado.js"
changes[helperpath] = ("", (OUT / "private-storage-helper.js").read_text(encoding="utf-8").replace(
    "// Candidato: destino final public/js/componentes/storage-privado.js.\n", ""))
patch = []
for path, (old, new) in changes.items():
    if path.endswith(".js"):
        subprocess.run(["node", "--input-type=module", "--check"], input=new,
                       text=True, encoding="utf-8", check=True, capture_output=True)
    patch.extend(difflib.unified_diff(old.splitlines(keepends=True), new.splitlines(keepends=True),
                                    fromfile="a/" + path if old else "/dev/null", tofile="b/" + path))
(OUT / "private-storage.patch").write_text("".join(patch), encoding="utf-8", newline="\n")
print("Patch generated for", len(changes), "files; active files unchanged.")
