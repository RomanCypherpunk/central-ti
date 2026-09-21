// Controle de navegação fail-closed. A autorização de dados continua obrigatoriamente no RLS.
import { supabase } from "./config/supabase-config.js";

const pagina = location.pathname.split("/").pop()?.replace(/\.html$/, "") || "index";
const regras = {
  base: perfil => perfil.ativo && perfil.status_aprovacao === "aprovado",
  "nova-solucao": perfil => perfil.ativo && perfil.status_aprovacao === "aprovado"
    && ["contribuinte", "analista", "admin"].includes(perfil.perfil),
  portal: perfil => perfil.ativo && perfil.status_aprovacao === "aprovado"
    && ["analista", "admin"].includes(perfil.perfil),
  painel: perfil => perfil.ativo && perfil.status_aprovacao === "aprovado" && perfil.perfil === "admin",
};
const destinosNegados = { base: "index.html", "nova-solucao": "base.html", portal: "index.html", painel: "index.html" };

async function verificar() {
  const { data: { user }, error: erroAuth } = await supabase.auth.getUser();
  if (erroAuth || !user) {
    location.replace("login.html");
    return;
  }
  const regra = regras[pagina];
  if (regra) {
    const { data: perfil, error } = await supabase.from("usuarios")
      .select("perfil,status_aprovacao,ativo").eq("id", user.id).single();
    if (error || !perfil || !regra(perfil)) {
      location.replace(destinosNegados[pagina]);
      return;
    }
  }
  document.body.style.visibility = "visible";
}

await verificar();
supabase.auth.onAuthStateChange((evento, sessao) => {
  if (evento === "SIGNED_OUT" || !sessao) location.replace("login.html");
});
