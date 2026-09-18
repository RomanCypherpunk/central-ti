// NOTIFICACOES DO NAVEGADOR (WEB PUSH DE VERDADE): interruptor
// compartilhado por qualquer tela do lado do solicitante (Home, Base de
// Soluções, Dados pessoais, Abrir chamado, Suas solicitações) — liga uma
// vez em qualquer uma delas, e o navegador recebe o aviso de "atendente
// respondeu seu chamado" (Edge Function notificar-portal) mesmo estando
// em outra tela, porque quem recebe o push é o Service Worker (sw.js),
// não a aba em si.
//
// O Portal e o Painel NÃO usam este módulo — o Portal já tem seu próprio
// interruptor equivalente no menu de 3 pontinhos (portal.js), com os
// gatilhos do lado do atendente. Mesma preferência no banco
// (usuarios.notificacoes_ativas) e mesma tabela (push_subscriptions),
// dois pontos de entrada de propósito — ligar/desligar em qualquer um
// dos dois lados não deveria afetar visualmente o outro, mas afeta a
// mesma coluna (é a preferência da PESSOA, não da tela).
//
// Chamado por main.js (compartilhado por quase toda página autenticada),
// condicionado à presença do elemento no HTML — não faz nada nas telas
// que não têm o item de menu.

const VAPID_CHAVE_PUBLICA = "BIGSZJ5WgPPZ4QiousUz386eNLUY-GKuKmne3VzyZfL9RLx-kUNHOMa3nD1KzxmNy2njaxw4URNqE7A_1934ho8";

function chaveVapidParaUint8Array(chaveBase64) {
  const preenchimento = "=".repeat((4 - (chaveBase64.length % 4)) % 4);
  const base64 = (chaveBase64 + preenchimento).replace(/-/g, "+").replace(/_/g, "/");
  const bruto = window.atob(base64);

  return Uint8Array.from([...bruto].map((caractere) => caractere.charCodeAt(0)));
}

export function ligarNotificacoes(supabase, idUsuario, ativasNoCadastro) {
  const item = document.querySelector("[data-acao-notificacoes]");

  if (!item) return;

  const suportado = "serviceWorker" in navigator && "PushManager" in window;

  let ativas = Boolean(ativasNoCadastro) && suportado && Notification.permission === "granted";

  function desenhar() {
    item.setAttribute("aria-checked", String(ativas));
  }

  desenhar();

  // Preferencia dizia "ligado" mas a permissao do navegador nao existe (ou
  // foi revogada depois) — sem isto o interruptor mentiria "ligado" sem
  // nenhuma notificacao nunca aparecer.
  if (ativasNoCadastro && suportado && Notification.permission !== "granted") {
    supabase.from("usuarios").update({ notificacoes_ativas: false }).eq("id", idUsuario);
  }

  async function inscrever() {
    const registro = await navigator.serviceWorker.register("/sw.js");
    const existente = await registro.pushManager.getSubscription();
    const subscription = existente ?? await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: chaveVapidParaUint8Array(VAPID_CHAVE_PUBLICA),
    });

    const json = subscription.toJSON();

    await supabase.from("push_subscriptions").upsert({
      usuario_id: idUsuario,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    }, { onConflict: "endpoint" });
  }

  async function desinscrever() {
    if (!("serviceWorker" in navigator)) return;

    const registro = await navigator.serviceWorker.getRegistration("/sw.js");
    const subscription = await registro?.pushManager.getSubscription();

    if (!subscription) return;

    await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
    await subscription.unsubscribe();
  }

  item.addEventListener("click", async () => {
    if (ativas) {
      ativas = false;
      desenhar();
      await supabase.from("usuarios").update({ notificacoes_ativas: false }).eq("id", idUsuario);
      await desinscrever();
      return;
    }

    if (!suportado) {
      alert("Este navegador não suporta notificações.");
      return;
    }

    const permissao = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();

    if (permissao !== "granted") {
      alert("Notificações bloqueadas no navegador. Permita o site nas configurações do navegador para ativar.");
      return;
    }

    try {
      await inscrever();
    } catch (erro) {
      console.error("Não foi possível ativar as notificações:", erro);
      alert("Não foi possível ativar as notificações. Tente de novo.");
      return;
    }

    ativas = true;
    desenhar();
    await supabase.from("usuarios").update({ notificacoes_ativas: true }).eq("id", idUsuario);
  });

  // Preferencia ja estava ligada ao carregar a pagina (outra sessao, ou
  // recarregou): garante que a inscricao deste navegador tambem existe —
  // o navegador pode ter perdido a subscription (ex.: dados do site
  // limpos) sem a preferencia no banco saber disso.
  if (ativas) {
    inscrever().catch((erro) => console.warn("Não foi possível confirmar a inscrição de notificações:", erro));
  }
}
