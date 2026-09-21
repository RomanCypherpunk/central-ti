// Candidato: novo public/js/componentes/push-sessao.js.
// Identificador local serve só para privacidade; autorização continua no RLS.
const CHAVE_DONO = "central-ti.push-owner";

async function registroAtual() {
  return "serviceWorker" in navigator ? navigator.serviceWorker.getRegistration("/sw.js") : null;
}

async function fecharAvisos(registro) {
  for (const aviso of await registro?.getNotifications() ?? []) aviso.close();
}

export async function reconciliarDonoPush(usuarioId) {
  const registro = await registroAtual();
  let dono = null;
  try { dono = localStorage.getItem(CHAVE_DONO); } catch { /* Rotacionar quando não se sabe o dono. */ }
  if (dono === usuarioId) return;
  const subscription = await registro?.pushManager.getSubscription();
  if (subscription) await subscription.unsubscribe();
  await fecharAvisos(registro);
  try { localStorage.removeItem(CHAVE_DONO); } catch { /* Sem persistência: rotacionar no próximo login. */ }
}

export async function inscreverPush(supabase, usuarioId, chavePublica) {
  await reconciliarDonoPush(usuarioId);
  const registro = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  const existente = await registro.pushManager.getSubscription();
  const subscription = existente ?? await registro.pushManager.subscribe({
    userVisibleOnly: true, applicationServerKey: chavePublica,
  });
  const json = subscription.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert({
    usuario_id: usuarioId, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth,
  }, { onConflict: "endpoint" });
  if (error) {
    await subscription.unsubscribe();
    throw new Error("Não foi possível salvar a inscrição de notificações.");
  }
  try { localStorage.setItem(CHAVE_DONO, usuarioId); } catch { /* Não impede uso desta sessão. */ }
}

export async function limparPushNoLogout(supabase) {
  const registro = await registroAtual();
  const subscription = await registro?.pushManager.getSubscription();
  let falha = null;
  try {
    if (subscription && supabase) {
      const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
      if (error) falha = new Error("Inscrição não removida do servidor.");
    }
  } catch (error) { falha = error; }
  finally {
    // Invalidação local também acontece quando DELETE não está disponível.
    try { if (subscription) await subscription.unsubscribe(); }
    finally {
      await fecharAvisos(registro);
      try { localStorage.removeItem(CHAVE_DONO); } catch { /* Nada para persistir. */ }
    }
  }
  if (falha) throw falha;
}
