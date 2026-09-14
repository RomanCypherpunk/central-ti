// Home: "Soluções em destaque" e "Suas últimas solicitações", com dados
// reais do Supabase — antes eram três linhas e quatro linhas fixas no HTML.

import { supabase } from "../config/supabase-config.js";

const LIMITE = 4;

/* ==========================================================================
   SOLUÇÕES EM DESTAQUE
   A RLS de `artigos` já filtra por setor sozinha (is_equipe_ti() OR
   autor_id = auth.uid() OR meu_setor_id() = any(setores)) — quem não é
   TI só recebe o que o próprio setor pode ver, sem precisar filtrar aqui.
   ========================================================================== */

async function carregarSolucoes() {
  const lista = document.querySelector("[data-destaques]");

  if (!lista) return;

  const { data: setores } = await supabase.from("setores").select("id, nome");
  const nomeDoSetor = new Map((setores ?? []).map((s) => [s.id, s.nome]));

  const { data: artigos, error } = await supabase
    .from("artigos")
    .select("id, titulo, setores")
    .eq("ativo", true)
    .order("criado_em", { ascending: false })
    .limit(LIMITE);

  lista.replaceChildren();

  if (error) {
    const item = document.createElement("li");
    item.className = "artigos__vazio";
    item.textContent = "Não foi possível carregar as soluções.";
    lista.appendChild(item);
    return;
  }

  if (!artigos.length) {
    const item = document.createElement("li");
    item.className = "artigos__vazio";
    item.textContent = "Nenhuma solução disponível ainda.";
    lista.appendChild(item);
    return;
  }

  artigos.forEach((artigo) => {
    // O setor mostrado na linha é so o primeiro marcado — a etiqueta é um
    // destaque visual, não a lista completa de quem enxerga a solução.
    const nomeSetor = nomeDoSetor.get(artigo.setores?.[0]) ?? "Geral";

    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "artigo";
    link.href = `base.html?id=${artigo.id}`;

    const titulo = document.createElement("span");
    titulo.className = "artigo__titulo";
    titulo.textContent = artigo.titulo || "Sem título";

    const setor = document.createElement("span");
    setor.className = "artigo__setor";
    setor.textContent = nomeSetor;

    link.append(titulo, setor);
    item.appendChild(link);
    lista.appendChild(item);
  });
}

/* ==========================================================================
   SUAS ÚLTIMAS SOLICITAÇÕES
   Status na visão do solicitante — vocabulário diferente do Portal
   (que é a visão do analista). Mesma derivação, palavras trocadas:
   Portal "Aberto"             -> aqui "Aberto"
   Portal "Usuário respondeu"  -> aqui "Em andamento" (a bola virou da equipe)
   Portal "Aguardando retorno" -> aqui "Aguardando você" (a bola é sua)
   Portal "Fechado"            -> aqui "Fechado"
   ========================================================================== */

const STATUS = {
  aberto: { classe: "aberto", rotulo: "Aberto" },
  andamento: { classe: "andamento", rotulo: "Em andamento" },
  aguardando: { classe: "aguardando", rotulo: "Aguardando você" },
  fechado: { classe: "fechado", rotulo: "Fechado" },
};

function derivarStatus(chamado) {
  if (chamado.fechamento_em) return STATUS.fechado;

  const publicos = (chamado.comentarios ?? [])
    .filter((c) => c.visibilidade === "publico" && c.tipo === "humano")
    .sort((a, b) => new Date(a.criado_em) - new Date(b.criado_em));

  const ultimo = publicos[publicos.length - 1];

  if (!ultimo) return STATUS.aberto;

  // O solicitante é quem abriu o chamado; qualquer outro autor é a equipe.
  return ultimo.autor_id === chamado.solicitante_id
    ? STATUS.andamento
    : STATUS.aguardando;
}

function tituloDoChamado(chamado) {
  return chamado.titulo
    ?? `${chamado.categorias?.nome ?? "Sem categoria"} | Ticket-${chamado.numero}`;
}

function formatarData(iso) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function montarLinha(chamado) {
  const status = derivarStatus(chamado);

  const linha = document.createElement("tr");
  linha.dataset.status = status.classe;

  const numero = document.createElement("td");
  numero.className = "tabela__numero";
  numero.textContent = `#${chamado.numero}`;

  const assunto = document.createElement("td");
  const link = document.createElement("a");
  link.className = "tabela__link";
  link.href = "solicitacoes.html";
  link.textContent = tituloDoChamado(chamado);
  assunto.appendChild(link);

  const statusCel = document.createElement("td");
  const selo = document.createElement("span");
  selo.className = `selo selo--${status.classe}`;
  selo.textContent = status.rotulo;
  statusCel.appendChild(selo);

  const data = document.createElement("td");
  data.className = "tabela__data";
  data.textContent = formatarData(chamado.abertura_em);

  linha.append(numero, assunto, statusCel, data);

  return linha;
}

async function carregarChamados() {
  const corpo = document.querySelector("[data-chamados]");
  const resumoEl = document.querySelector("[data-resumo-chamados]");

  if (!corpo) return;

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return;

  const { data: chamados, error } = await supabase
    .from("chamados")
    .select(`
      id, numero, titulo, solicitante_id, abertura_em, fechamento_em,
      categorias(nome),
      comentarios(autor_id, visibilidade, tipo, criado_em)
    `)
    .eq("solicitante_id", user.id)
    .order("abertura_em", { ascending: false })
    .limit(LIMITE);

  corpo.replaceChildren();

  if (error) {
    corpo.innerHTML = '<tr><td colspan="4" class="tabela__vazio">Não foi possível carregar suas solicitações.</td></tr>';
    if (resumoEl) resumoEl.textContent = "";
    return;
  }

  if (!chamados.length) {
    corpo.innerHTML = '<tr><td colspan="4" class="tabela__vazio">Você ainda não abriu nenhum chamado.</td></tr>';
    if (resumoEl) resumoEl.textContent = "";
    return;
  }

  chamados.forEach((chamado) => corpo.appendChild(montarLinha(chamado)));

  if (!resumoEl) return;

  // O resumo conta sobre TODOS os chamados abertos da pessoa, não só os
  // que aparecem na lista (que é limitada a 4) — por isso é uma segunda
  // consulta, mais leve (só a coluna que decide o status).
  const { data: todosAbertos } = await supabase
    .from("chamados")
    .select("solicitante_id, fechamento_em, comentarios(autor_id, visibilidade, tipo, criado_em)")
    .eq("solicitante_id", user.id)
    .is("fechamento_em", null);

  const contagem = { andamento: 0, aguardando: 0 };

  (todosAbertos ?? []).forEach((chamado) => {
    const status = derivarStatus(chamado);
    if (status === STATUS.andamento) contagem.andamento += 1;
    if (status === STATUS.aguardando) contagem.aguardando += 1;
  });

  const partes = [];
  if (contagem.andamento > 0) {
    partes.push(`${contagem.andamento} em andamento`);
  }
  if (contagem.aguardando > 0) {
    partes.push(`${contagem.aguardando} aguardando você`);
  }

  resumoEl.textContent = partes.join(" · ");
}

carregarSolucoes();
carregarChamados();
