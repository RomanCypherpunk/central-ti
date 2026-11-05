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

  const publicos = (chamado.comentarios ?? [])
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

// Pendências da equipe e respostas destinadas ao atendente desta sessão.
// Usa os mesmos status exibidos nos cards, sem depender de filas ou filtros.
export function contarPendenciasDoPortal(chamados, atendenteId) {
  return chamados.filter((chamado) => {
    const status = derivarStatus(chamado).chave;
    const membros = chamado.chamado_membros ?? [];
    const terceiros = chamado.chamado_terceiros ?? [];
    return (status === "aberto" && !membros.length && !terceiros.length)
      || (status === "respondeu" && Boolean(atendenteId)
        && membros.some((membro) => membro.usuario_id === atendenteId));
  }).length;
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
  acesso_remoto, cliente_na_loja, sistema_lento_ou_fora, checklist_criacao,
  categorias(nome),
  unidades(nome),
  usuarios!chamados_solicitante_id_fkey(id, nome, sobrenome, email, perfil, status_aprovacao, setor_id, unidade_id, setores(id, nome)),
  chamado_membros(usuario_id, usuarios(id, nome, sobrenome, foto_path)),
  chamado_terceiros(terceiro_id, terceiros(id, nome, foto_path)),
  comentarios(id, autor_id, texto, visibilidade, tipo, criado_em, artigo_id, artigos(titulo, ativo), usuarios(nome, sobrenome, foto_path)),
  anexos(id, comentario_id, nome_arquivo, storage_path, criado_em)
`;

//CHECKLIST DE CRIACAO (so chamados de cadastro novos; a coluna e nula nos
//demais). Devolve null quando nao ha checklist.
export function progressoChecklist(chamado) {
  const itens = chamado.checklist_criacao;

  if (!Array.isArray(itens) || !itens.length) return null;

  const feitos = itens.filter((item) => item.feito).length;

  return { feitos, total: itens.length, percentual: Math.round((feitos / itens.length) * 100) };
}

//BARRA DE PROGRESSO DO CARD: linha fina no topo, que enche de verde conforme
//os itens sao marcados, com "1/3 (33%)" ao lado. Sem checklist, nao ha barra.
export function montarBarraChecklist(chamado) {
  const progresso = progressoChecklist(chamado);

  if (!progresso) return null;

  const barra = document.createElement("div");
  barra.className = "card__progresso";
  barra.classList.toggle("card__progresso--completo", progresso.feitos === progresso.total);
  barra.dataset.progresso = "";

  const rotulo = document.createElement("span");
  rotulo.className = "card__progresso-rotulo";
  rotulo.textContent = `${progresso.feitos}/${progresso.total}`;

  const trilho = document.createElement("div");
  trilho.className = "card__progresso-trilho";

  const preenchimento = document.createElement("div");
  preenchimento.className = "card__progresso-preenchimento";
  preenchimento.style.width = `${progresso.percentual}%`;

  trilho.appendChild(preenchimento);
  barra.append(rotulo, trilho);

  return barra;
}

//SLA EM HORAS UTEIS, NAO HORAS CORRIDAS: regra do horario de
//funcionamento do TI — seg-sex 8h as 12h e 13h as 17h48 (a hora de almoco
//da equipe NAO conta), sabado 8h as 12h, domingo sem expediente.
export const EXPEDIENTE_POR_DIA_DA_SEMANA = {
  0: [], // domingo: sem expediente
  1: [{ inicio: [8, 0], fim: [12, 0] }, { inicio: [13, 0], fim: [17, 48] }],
  2: [{ inicio: [8, 0], fim: [12, 0] }, { inicio: [13, 0], fim: [17, 48] }],
  3: [{ inicio: [8, 0], fim: [12, 0] }, { inicio: [13, 0], fim: [17, 48] }],
  4: [{ inicio: [8, 0], fim: [12, 0] }, { inicio: [13, 0], fim: [17, 48] }],
  5: [{ inicio: [8, 0], fim: [12, 0] }, { inicio: [13, 0], fim: [17, 48] }],
  6: [{ inicio: [8, 0], fim: [12, 0] }], // sabado so de manha, sem almoco
};

export function horasUteisEntre(inicio, fim) {
  const dInicio = inicio instanceof Date ? inicio : new Date(inicio);
  const dFim = fim instanceof Date ? fim : new Date(fim);

  if (!dInicio || isNaN(dInicio.getTime()) || !dFim || isNaN(dFim.getTime()) || dFim <= dInicio) {
    return 0;
  }

  let minutos = 0;
  const cursor = new Date(dInicio.getFullYear(), dInicio.getMonth(), dInicio.getDate());

  while (cursor <= dFim) {
    const janelas = EXPEDIENTE_POR_DIA_DA_SEMANA[cursor.getDay()] ?? [];
    janelas.forEach((janela) => {
      const abreDoDia = new Date(cursor);
      abreDoDia.setHours(janela.inicio[0], janela.inicio[1], 0, 0);
      const fechaDoDia = new Date(cursor);
      fechaDoDia.setHours(janela.fim[0], janela.fim[1], 0, 0);

      const comeco = dInicio > abreDoDia ? dInicio : abreDoDia;
      const termino = dFim < fechaDoDia ? dFim : fechaDoDia;

      if (termino > comeco) {
        minutos += (termino - comeco) / 60_000;
      }
    });

    cursor.setDate(cursor.getDate() + 1);
  }

  return minutos / 60;
}

//ALERTA DE SLA / TEMPO DE ESPERA DO CARD:
//- "sem_resposta_ti": usuário aguarda resposta do TI há mais de 6h úteis (vermelho: #820413 escuro / #ebd5d8 claro)
//- "sem_retorno_usuario": TI respondeu e usuário não deu retorno há mais de 6h úteis (amarelo: #926302 escuro / #efe4c8 claro)
export function alertaTempoRespostaChamado(chamado, agora = new Date()) {
  if (!chamado || chamado.fechamento_em) {
    return null;
  }

  const publicos = (chamado.comentarios ?? [])
    .filter((c) => c.visibilidade === "publico" && c.tipo === "humano")
    .sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));

  const ultimo = publicos[publicos.length - 1];

  // Caso 1: Nenhuma resposta pública ainda no chamado
  // O solicitante abriu o chamado e aguarda primeira resposta da equipe de TI
  if (!ultimo) {
    if (!chamado.abertura_em) return null;
    const inicio = new Date(chamado.abertura_em);
    const horas = horasUteisEntre(inicio, agora);
    return horas >= 6 ? "sem_resposta_ti" : null;
  }

  // Caso 2: A última mensagem pública foi do solicitante (usuário)
  // O usuário falou e aguarda retorno da equipe de TI
  if (ultimo.autor_id === chamado.solicitante_id) {
    let inicio = null;
    const indiceUltimaRespostaTI = publicos.map((c) => c.autor_id !== chamado.solicitante_id).lastIndexOf(true);
    if (indiceUltimaRespostaTI === -1) {
      inicio = new Date(chamado.abertura_em ?? ultimo.criado_em);
    } else {
      const primeiroAposTI = publicos.slice(indiceUltimaRespostaTI + 1)[0];
      inicio = new Date(primeiroAposTI?.criado_em ?? ultimo.criado_em);
    }

    const horas = horasUteisEntre(inicio, agora);
    return horas >= 6 ? "sem_resposta_ti" : null;
  }

  // Caso 3: A última mensagem pública foi do TI (equipe)
  // O TI respondeu e aguarda retorno do usuário
  const inicio = new Date(ultimo.criado_em);
  const horas = horasUteisEntre(inicio, agora);
  return horas >= 6 ? "sem_retorno_usuario" : null;
}
