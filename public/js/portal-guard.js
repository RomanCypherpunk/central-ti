// GUARDA DO PORTAL DE CHAMADOS: só analista e admin entram, mesmo digitando
// a URL direto — mesma ideia do painel-guard.js, um degrau abaixo na
// hierarquia de perfis:
//
//   solicitante   abre chamado, lê a Base
//   contribuinte  + cadastra soluções na Base
//   analista      + ATENDE chamado aqui no Portal
//   admin         + configura o sistema no Painel
//
// Antes esta tela só tinha o auth-guard: qualquer pessoa logada que digitasse
// portal.html entrava e via a interface (vazia, porque a RLS filtra os dados,
// mas via). Esconder o link no menu nunca foi controle de acesso — quem
// segura de verdade é a RLS (is_equipe_ti nas policies de chamados). Isto
// aqui evita a tela carregar e falhar em toda consulta antes de redirecionar.
//
// Roda depois de auth-guard.js (senão sessão nula quebra a consulta) e antes
// do portal.js, para redirecionar antes dele buscar dados.
//
// VISIBILIDADE: auth-guard.js já revelou o body ao confirmar a sessão.
// Reesconde e só revela de novo depois de confirmar o perfil, senão o Portal
// pisca para quem não pode vê-lo.
import { supabase } from "./config/supabase-config.js";

document.body.style.visibility = "hidden";

const { data: { user } } = await supabase.auth.getUser();

if (user) {
  const { data: perfil } = await supabase
    .from("usuarios")
    .select("perfil, ativo, status_aprovacao")
    .eq("id", user.id)
    .single();

  const podeAtender = ["analista", "admin"].includes(perfil?.perfil)
    && perfil?.status_aprovacao === "aprovado"
    && perfil?.ativo;

  if (podeAtender) {
    document.body.style.visibility = "visible";
  } else {
    window.location.href = "index.html";
  }
}
