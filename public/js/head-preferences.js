// Preferências visuais aplicadas antes da primeira pintura; sem script inline para permitir CSP estrita.
try {
  const pagina = location.pathname.split("/").pop()?.replace(/\.html$/, "") || "index";
  if (pagina === "base" || pagina === "nova-solucao") {
    document.documentElement.dataset.sidebar = localStorage.getItem("sidebarColapsada") === "true" ? "colapsada" : "expandida";
  }
  if (pagina === "portal" || pagina === "painel") {
    document.documentElement.dataset.tema = localStorage.getItem("tema-portal") ?? "claro";
  }
  if (pagina === "portal") {
    const zoom = Number(localStorage.getItem("zoom-portal"));
    if (Number.isFinite(zoom) && zoom > 0) document.documentElement.style.setProperty("--zoom-portal", String(zoom));
  }
  if (pagina === "painel") {
    document.documentElement.dataset.painelSidebar = localStorage.getItem("painelSidebarColapsada") === "true" ? "colapsada" : "expandida";
  }
} catch {
  // Armazenamento indisponível: os estilos padrão continuam válidos.
}
