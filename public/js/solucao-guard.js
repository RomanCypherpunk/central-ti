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
// ESPERA: o body nasce com data-carregando e a tela tem data-guarda, então o
// auth-guard deixa o esqueleto no lugar. Quem o tira é esta guarda, depois
// de confirmar o perfil.
//
// O perfil vem de sessao.js, lido uma vez só e compartilhado com o main.js.
import { exigir } from "./sessao.js";

if (await exigir((permissoes) => permissoes.escreveArtigo, "base.html")) {
  // Aprovado: o esqueleto sai e o conteudo aparece. Reprovado, a pessoa e
  // levada embora com o esqueleto ainda na tela — nunca chega a ver o
  // conteudo de uma tela que nao e dela.
  delete document.body.dataset.carregando;
}
