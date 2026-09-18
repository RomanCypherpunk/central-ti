// SERVICE WORKER DO PORTAL DE CHAMADOS: so isso, mostrar a notificacao
// que chega por Web Push. E o que mantem a notificacao funcionando com a
// aba em segundo plano/minimizada — diferente de rodar tudo dentro da
// aba (que o navegador suspende quando ela nao esta em primeiro plano).
//
// Registrado so por portal.js, so quando a pessoa liga o interruptor de
// notificacoes no menu do quadro.

self.addEventListener("push", (evento) => {
  let dados = { titulo: "Portal de Chamados", corpo: "Você tem uma atualização." };

  try {
    dados = evento.data.json();
  } catch {
    // Payload sem JSON valido: fica no texto padrao acima.
  }

  evento.waitUntil(
    self.registration.showNotification(dados.titulo, {
      body: dados.corpo,
      icon: "/assets/img/logo-laranja.png",
    }),
  );
});

// Clicar na notificacao leva pro Portal, reaproveitando uma aba ja aberta
// se existir em vez de abrir uma nova toda vez.
self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();

  evento.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((janelas) => {
      const aberta = janelas.find((janela) => janela.url.includes("/portal.html"));

      if (aberta) return aberta.focus();

      return self.clients.openWindow("/portal.html");
    }),
  );
});
