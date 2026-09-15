// Peças que o Portal e o Painel mostram igual: status, nome, avatar, data.
// Moram aqui para os dois lerem a mesma verdade — quando o status de um
// chamado muda de regra, muda numa linha só, não em duas telas.

import { pintarFoto } from "./avatar.js";

//O STATUS NAO E UMA COLUNA: VEM DE QUEM FALOU POR ULTIMO NO CHAMADO.
//So conta conversa de verdade — nota interna entre a equipe e mensagem
//automatica de abertura nao mudam o status.
export function derivarStatus(chamado) {
  if (chamado.fechamento_em) {
    return { chave: "fechado", rotulo: "Fechado" };
  }

  const publicos = chamado.comentarios
    .filter((comentario) => comentario.visibilidade === "publico" && comentario.tipo === "humano")
    .sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));

  const ultimo = publicos[publicos.length - 1];

  if (!ultimo) {
    return { chave: "aberto", rotulo: "Aberto" };
  }

  // O solicitante e o dono do chamado; qualquer outro autor e a equipe.
  return ultimo.autor_id === chamado.solicitante_id
    ? { chave: "respondeu", rotulo: "Usuário respondeu" }
    : { chave: "aguardando", rotulo: "Aguardando retorno" };
}

//O banco guarda nome e sobrenome separados. No quadro aparece so o nome —
//e o que o analista precisa para reconhecer quem esta no card.
export function primeiroNome(pessoa) {
  return pessoa?.nome ?? "Alguém";
}

//Nome completo: para identificar a pessoa sem ambiguidade (detalhe do
//chamado) e para a busca achar por sobrenome.
export function nomeCompleto(pessoa) {
  if (!pessoa?.nome) return null;

  return [pessoa.nome, pessoa.sobrenome].filter(Boolean).join(" ");
}

export function iniciais(nome, sobrenome) {
  const primeira = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  const ultima = (sobrenome ?? "").trim().split(/\s+/).pop() ?? "";

  return (primeira[0] ?? "").concat(ultima[0] ?? "").toUpperCase();
}

//O titulo e do banco; chamados antigos sem titulo caem no formato padrao.
export function tituloDoChamado(chamado) {
  return chamado.titulo
    ?? `${chamado.categorias?.nome ?? "Sem categoria"} | Ticket-${chamado.numero}`;
}

export function formatarData(iso) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

//AVATAR DA CONVERSA: A FOTO E A QUE A PESSOA ENVIOU EM "Dados pessoais".
//Sem foto, ficam as iniciais.
//classe: qual estilo de avatar usar — o balao do chat e o circulo do card
//tem tamanhos diferentes, mas os dois mostram a mesma foto de perfil.
export function montarAvatar(pessoa, fotoPath, classe = "comentario__avatar") {
  const avatar = document.createElement("span");
  avatar.className = classe;
  // O balao mostra so o primeiro nome; o completo fica no title, ao passar o mouse.
  avatar.title = nomeCompleto(pessoa) ?? "Alguém";

  // Com foto, as iniciais nao aparecem antes dela: o quadro e a conversa se
  // redesenham a cada evento do tempo real, e a troca letras -> foto piscava.
  pintarFoto(avatar, fotoPath, iniciais(pessoa?.nome, pessoa?.sobrenome));

  return avatar;
}

//COR DE DESTAQUE: A COR QUE A PESSOA ESCOLHEU (usuarios.cor_destaque) VIRA
//UM FUNDO CLARO DO COMECO DA FOTO ATE O FIM DO NOME. Recebe o elemento que
//envolve foto e nome. Sem cor, sem fundo. O data-usuario deixa trocar a cor
//em todos os lugares da tela de uma vez, sem redesenhar o quadro.
export function aplicarCorDestaque(elemento, pessoa) {
  elemento.dataset.usuario = pessoa.id ?? "";
  elemento.classList.toggle("membro--destaque", Boolean(pessoa.cor_destaque));

  if (pessoa.cor_destaque) {
    elemento.style.setProperty("--cor-destaque", pessoa.cor_destaque);
  } else {
    elemento.style.removeProperty("--cor-destaque");
  }
}

//Cores oferecidas no detalhe do chamado. Todas fortes o bastante para o anel
//aparecer tanto no card claro quanto no escuro.
export const CORES_DESTAQUE = [
  { nome: "Laranja", valor: "#dd5b12" },
  { nome: "Vermelho", valor: "#d64545" },
  { nome: "Rosa", valor: "#d6457f" },
  { nome: "Roxo", valor: "#7c5cf0" },
  { nome: "Azul", valor: "#2c6fd6" },
  { nome: "Ciano", valor: "#0f9bb3" },
  { nome: "Verde", valor: "#2f9e44" },
  { nome: "Amarelo", valor: "#d19a0a" },
];

//A CONSULTA DO CHAMADO COM TUDO QUE A TELA MOSTRA. Portal e Painel pedem os
//mesmos campos: o detalhe é o mesmo componente nos dois.
export const CAMPOS_CHAMADO = `
  id, numero, titulo, fila_id, solicitante_id, descricao,
  eh_urgente, eh_prioridade, fechamento_em, abertura_em,
  acesso_remoto, cliente_na_loja, sistema_lento_ou_fora,
  categorias(nome),
  unidades(nome),
  usuarios!chamados_solicitante_id_fkey(id, nome, sobrenome, email, status_aprovacao, setor_id, setores(id, nome)),
  chamado_membros(usuario_id, usuarios(id, nome, sobrenome, foto_path)),
  comentarios(id, autor_id, texto, visibilidade, tipo, criado_em, usuarios(nome, sobrenome, foto_path)),
  anexos(id, comentario_id, nome_arquivo, storage_path, criado_em)
`;
