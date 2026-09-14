// GUARDA DE APROVACAO: bloqueia a entrada em telas que exigem status_aprovacao
// = 'aprovado', mesmo digitando a URL direto — igual auth-guard.js bloqueia
// quem não está logado. Esconder o link no menu não é controle de acesso
// (mesmo princípio já usado no Portal, restrito a admin): a garantia de
// verdade é a RLS no banco, isto aqui só evita a tela carregar vazia/quebrada
// antes do redirecionamento.
//
// Roda depois de auth-guard.js (senão sessão nula quebra a consulta) e antes
// do script da própria página, para redirecionar antes dela buscar dados.
//
// VISIBILIDADE: auth-guard.js já revelou o body assim que confirmou a
// sessão — antes deste guard decidir. Reesconde e só revela de novo depois
// de confirmar aprovado, senão a tela pisca por um instante para quem está
// pendente.
import { supabase } from "./config/supabase-config.js";

document.body.style.visibility = "hidden";

const { data: { user } } = await supabase.auth.getUser();

if (user) {
  const { data: perfil } = await supabase
    .from("usuarios")
    .select("status_aprovacao, ativo")
    .eq("id", user.id)
    .single();

  const aprovado = perfil?.status_aprovacao === "aprovado" && perfil?.ativo;

  if (!aprovado) {
    window.location.href = "index.html";
  } else {
    document.body.style.visibility = "visible";
  }
}
