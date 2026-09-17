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
// ESPERA: o body nasce com data-carregando e a tela tem data-guarda, então o
// auth-guard deixa o esqueleto no lugar. Quem o tira é esta guarda, depois
// de confirmar admin — o Painel não pisca para quem não pode vê-lo.
//
// O perfil vem de sessao.js, lido uma vez só e compartilhado com o main.js.
import { exigir } from "./sessao.js";

if (await exigir((permissoes) => permissoes.admin, "index.html")) {
  // Aprovado: o esqueleto sai e o conteudo aparece. Reprovado, a pessoa e
  // levada embora com o esqueleto ainda na tela — nunca chega a ver o
  // conteudo de uma tela que nao e dela.
  delete document.body.dataset.carregando;
}
