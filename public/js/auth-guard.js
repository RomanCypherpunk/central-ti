// SEM SESSAO, NAO ENTRA. Roda antes de qualquer script de tela.
//
// A sessao vem de sessao.js, que a le uma vez e empresta para os outros
// guards, o main.js e a propria pagina — antes, cada um perguntava de novo,
// e a tela esperava a fila inteira de idas a rede.

import { supabase } from "./config/supabase-config.js";
import { sessaoAtual } from "./sessao.js";

const sessao = await sessaoAtual();

if (!sessao) {
  // replace, e nao href: o voltar do navegador nao deve trazer de volta uma
  // tela que so vai redirecionar de novo.
  window.location.replace("login.html");
} else if (!document.body.dataset.guarda) {
  // Telas com guarda de perfil (Portal, Painel, Base, Nova solucao) seguram
  // o esqueleto ate a propria guarda decidir; as outras ja podem aparecer.
  delete document.body.dataset.carregando;
}

supabase.auth.onAuthStateChange((_evento, novaSessao) => {
  if (!novaSessao) {
    window.location.href = "login.html";
  }
});
