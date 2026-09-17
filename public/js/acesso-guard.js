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
// ESPERA: o body nasce com data-carregando e a tela tem data-guarda, então o
// auth-guard deixa o esqueleto no lugar. Quem o tira é esta guarda, depois
// de confirmar a aprovação — a tela não pisca para quem está pendente.
//
// O perfil vem de sessao.js, lido uma vez só e compartilhado com o main.js.
import { exigir } from "./sessao.js";

if (await exigir((permissoes) => permissoes.aprovado, "index.html")) {
  // Aprovado: o esqueleto sai e o conteudo aparece. Reprovado, a pessoa e
  // levada embora com o esqueleto ainda na tela — nunca chega a ver o
  // conteudo de uma tela que nao e dela.
  delete document.body.dataset.carregando;
}
