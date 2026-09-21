// Não cria cache nem intercepta fetch.
self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() ?? {}; } catch { /* payload inválido */ }
  const titulo = typeof payload.titulo === "string" && payload.titulo.trim()
    ? payload.titulo.trim().slice(0, 120) : "Central de TI";
  const corpo = typeof payload.corpo === "string" && payload.corpo.trim()
    ? payload.corpo.trim().slice(0, 160) : "Nova atualização";
  event.waitUntil(self.registration.showNotification(titulo, {
    body: corpo,
    icon: "/assets/img/logo-laranja.png",
    tag: "central-ti-atualizacao",
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/index.html"));
});
