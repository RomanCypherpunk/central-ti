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
// ESPERA: o body nasce com data-carregando, e o auth-guard deixa esse
// esqueleto no lugar quando a tela tem guarda de perfil (data-guarda no
// body). Quem tira o esqueleto é esta guarda, depois de confirmar — assim o
// Portal não pisca para quem não pode vê-lo.
//
// O perfil vem de sessao.js, que já o leu (ou está lendo) para o main.js: a
// conferência aqui não custa mais uma ida ao banco.
import { exigir } from "./sessao.js";

if (await exigir((permissoes) => permissoes.equipeTi, "index.html")) {
  // Aprovado: o esqueleto sai e o conteudo aparece. Reprovado, a pessoa e
  // levada embora com o esqueleto ainda na tela — nunca chega a ver o
  // conteudo de uma tela que nao e dela.
  delete document.body.dataset.carregando;
}
