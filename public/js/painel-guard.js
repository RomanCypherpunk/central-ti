// GUARDA DO PAINEL: só admin entra, mesmo digitando a URL direto — mesma
// ideia do acesso-guard.js, trocando "aprovado" por "admin". O Painel edita
// setores, unidades, categorias, filas, textos rápidos e os dados dos
// usuários: quem atende chamado (analista) usa o Portal, mas não configura
// o sistema.
//
// Esconder o item no menu de 3 pontinhos não é controle de acesso — quem
// segura de verdade é a RLS (as policies de escrita pedem equipe de TI).
// Isto aqui evita a tela carregar e falhar em toda consulta antes de
// redirecionar.
//
// Roda depois de auth-guard.js (senão sessão nula quebra a consulta) e antes
// do painel.js, para redirecionar antes dele buscar dados.
//
// VISIBILIDADE: auth-guard.js já revelou o body ao confirmar a sessão.
// Reesconde e só revela de novo depois de confirmar admin, senão o Painel
// pisca para quem não pode vê-lo.
import { supabase } from "./config/supabase-config.js";

document.body.style.visibility = "hidden";

const { data: { user } } = await supabase.auth.getUser();

if (user) {
  const { data: perfil } = await supabase
    .from("usuarios")
    .select("perfil, ativo")
    .eq("id", user.id)
    .single();

  if (perfil?.perfil === "admin" && perfil?.ativo) {
    document.body.style.visibility = "visible";
  } else {
    window.location.href = "index.html";
  }
}
