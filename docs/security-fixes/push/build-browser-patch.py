"""Gera patch revisável sem alterar public/. Executar da raiz do repositório."""
from pathlib import Path
import difflib

root = Path.cwd()
folder = root / "docs/security-fixes/push"
changes = {}

for relative in ("public/js/componentes/notificacoes.js", "public/js/pages/portal.js"):
    old = (root / relative).read_text(encoding="utf-8")
    new = old
    imported = './push-sessao.js' if 'componentes/' in relative else '../componentes/push-sessao.js'
    new = f'import {{ inscreverPush, limparPushNoLogout }} from "{imported}";\n' + new
    start = new.index("  async function inscrever() {")
    end = new.index('  item.addEventListener("click", async () => {', start)
    who = "idUsuario" if "componentes/" in relative else "atendente"
    new = new[:start] + f'''  async function inscrever() {{
    await inscreverPush(supabase, {who}, chaveVapidParaUint8Array(VAPID_CHAVE_PUBLICA));
  }}

  async function desinscrever() {{
    await limparPushNoLogout(supabase);
  }}

''' + new[end:]
    # Usuário não recebe estado ligado se a atualização da preferência falhou.
    before = f'''    ativas = true;
    desenhar();
    await supabase.from("usuarios").update({{ notificacoes_ativas: true }}).eq("id", {who});'''
    after = f'''    const {{ error: erroPreferencia }} = await supabase.from("usuarios")
      .update({{ notificacoes_ativas: true }}).eq("id", {who});
    if (erroPreferencia) {{
      await desinscrever().catch(() => {{}});
      alert("Não foi possível salvar a preferência de notificações.");
      return;
    }}
    ativas = true;
    desenhar();'''
    assert before in new, relative
    new = new.replace(before, after, 1)
    # Falha ao desativar a preferência não impede revogação local.
    before = f'''      await supabase.from("usuarios").update({{ notificacoes_ativas: false }}).eq("id", {who});
      await desinscrever();'''
    after = f'''      const {{ error: erroPreferencia }} = await supabase.from("usuarios")
        .update({{ notificacoes_ativas: false }}).eq("id", {who});
      let erroInscricao = null;
      try {{ await desinscrever(); }} catch (erro) {{ erroInscricao = erro; }}
      if (erroPreferencia || erroInscricao) {{
        alert("Notificações desativadas neste navegador; confirme a preferência ao reconectar.");
      }}'''
    assert before in new, relative
    new = new.replace(before, after, 1)
    changes[relative] = (old, new)

relative = "public/js/main.js"
old = (root / relative).read_text(encoding="utf-8")
new = 'import { limparPushNoLogout, reconciliarDonoPush } from "./componentes/push-sessao.js";\n' + old
new = new.replace('''  if (!user) {
    esquecerTopo();
    return;
  }

  const guardado''', '''  if (!user) {
    esquecerTopo();
    await limparPushNoLogout(null).catch(() => {});
    return;
  }
  await reconciliarDonoPush(user.id).catch(() => console.warn("Falha ao renovar notificações deste navegador."));

  const guardado''', 1)
new = new.replace('  await supabase.auth.signOut();', '''  await limparPushNoLogout(supabase).catch(() => console.warn("Falha ao revogar notificações; conteúdo permanece genérico."));
  await supabase.auth.signOut();''', 1)
# Callback permanece síncrono: nenhuma chamada Supabase dentro do lock de Auth.
new += '''
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    void limparPushNoLogout(null).catch(() => console.warn("Falha ao revogar notificações locais."));
  }
});
'''
assert new != old
changes[relative] = (old, new)
changes['public/sw.js'] = ((root / 'public/sw.js').read_text(encoding='utf-8'), (folder / 'sw.js').read_text(encoding='utf-8'))
changes['public/js/componentes/push-sessao.js'] = ('', (folder / 'push-sessao.js').read_text(encoding='utf-8'))

patch = []
for relative, (old, new) in changes.items():
    # O checkout mistura LF e CRLF: preservar os bytes de contexto de cada arquivo.
    if old and b'\r\n' in (root / relative).read_bytes():
        old = old.replace('\n', '\r\n')
        new = new.replace('\n', '\r\n')
    patch.extend(difflib.unified_diff(old.splitlines(True), new.splitlines(True),
        fromfile='a/' + relative if old else '/dev/null', tofile='b/' + relative))
(folder / 'browser.patch').write_bytes(''.join(patch).encode('utf-8'))
print('Gerado docs/security-fixes/push/browser.patch; public/ preservado.')
