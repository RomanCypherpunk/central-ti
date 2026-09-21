// Candidato: substituir public/sw.js. Não cria cache nem intercepta fetch.
// Payload legado também é ignorado: push enfileirado antes do logout pode chegar depois.
self.addEventListener("push", (event) => {
  event.waitUntil(self.registration.showNotification("Central de TI", {
    body: "Há uma atualização. Entre para consultar.",
    icon: "/assets/img/logo-laranja.png",
    tag: "central-ti-atualizacao",
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/index.html"));
});
