// GUARDA DE CADASTRO DE SOLUÇÃO: contribuinte, analista e admin — quem pode
// escrever na Base de Soluções. Espelha pode_escrever_artigo() no banco, que
// é a policy de escrita de artigos.
//
// Note que a lista é DIFERENTE da do portal-guard: contribuinte cadastra
// solução mas não atende chamado. São duas permissões distintas (no banco,
// pode_escrever_artigo x is_equipe_ti), e não dois nomes para a mesma coisa.
//
// Antes esta tela só tinha o auth-guard: um solicitante que digitasse
// nova-solucao.html via o formulário inteiro e só descobria que não podia ao
// salvar, quando a RLS recusava. Redirecionar na entrada evita o trabalho
// perdido.
//
// Roda depois de auth-guard.js e antes do nova-solucao.js.
//
// VISIBILIDADE: auth-guard.js já revelou o body ao confirmar a sessão.
// Reesconde e só revela de novo depois de confirmar o perfil.
import { supabase } from "./config/supabase-config.js";

document.body.style.visibility = "hidden";

const { data: { user } } = await supabase.auth.getUser();

if (user) {
  const { data: perfil } = await supabase
    .from("usuarios")
    .select("perfil, ativo, status_aprovacao")
    .eq("id", user.id)
    .single();

  const podeEscrever = ["contribuinte", "analista", "admin"].includes(perfil?.perfil)
    && perfil?.status_aprovacao === "aprovado"
    && perfil?.ativo;

  if (podeEscrever) {
    document.body.style.visibility = "visible";
  } else {
    window.location.href = "base.html";
  }
}
