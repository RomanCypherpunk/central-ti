// Cadastro de solução na base — Fase 1.
//
// Portado da tela equivalente do projeto GASO, com três diferenças:
//   - grava na tabela `artigos` deste projeto, não em `solucoes`;
//   - a categoria é chave estrangeira (categoria_id), não texto livre;
//   - o tipo Script/SQL não existe aqui, então bloco de código, parâmetros e
//     nível de risco ficaram de fora.

import { supabase } from "../config/supabase-config.js";

const BUCKET = "artigos";
const MAX_IMAGENS_POR_PASSO = 3;

const tipoCards = document.querySelectorAll(".tipo-card");
const registroVazio = document.getElementById("registro-vazio");
const registroCampos = document.getElementById("registro-campos");
const caminhoSecaoEl = document.getElementById("caminho-secao");
const salvarBtn = document.getElementById("salvar-btn");
const publicacaoErro = document.getElementById("publicacao-erro");

const idEdicao = new URLSearchParams(window.location.search).get("id");

let relacionadasApi = null;
let vincularAtivo = null;

//O CAMINHO DO ERP VIRA UM CAMPO SO, SEPARADO POR " | "
function montarCaminho(pagina, caminho) {
  return [pagina, caminho].filter(Boolean).join(" | ") || null;
}

function separarCaminho(modulo) {
  if (!modulo) return { pagina: "", caminho: "" };

  const indice = modulo.indexOf(" | ");

  if (indice === -1) return { pagina: "", caminho: modulo };

  return { pagina: modulo.slice(0, indice), caminho: modulo.slice(indice + 3) };
}

//SOLUCOES RELACIONADAS
document.addEventListener("click", (evento) => {
  if (!vincularAtivo) return;

  const { resultadosEl, inputEl } = vincularAtivo;

  if (!resultadosEl.contains(evento.target) && evento.target !== inputEl) {
    resultadosEl.hidden = true;
  }
});

function ativarSolucoesRelacionadas(relacionadasIniciais) {
  const inputEl = document.getElementById("vincular-input");
  const resultadosEl = document.getElementById("vincular-resultados");
  const listaEl = document.getElementById("relacionadas-lista");

  let selecionadas = [];
  let buscaTimer = null;

  function renderizarSelecionadas() {
    listaEl.innerHTML = "";

    selecionadas.forEach((item) => {
      const linha = document.createElement("div");
      linha.className = "relacionada-item";

      const titulo = document.createElement("span");
      titulo.className = "relacionada-item__titulo";
      titulo.textContent = item.titulo || "Sem título";

      const remover = document.createElement("button");
      remover.type = "button";
      remover.className = "relacionada-item__remover";
      remover.setAttribute("aria-label", "Remover vínculo");
      remover.textContent = "×";
      remover.addEventListener("click", () => {
        selecionadas = selecionadas.filter((s) => s.id !== item.id);
        renderizarSelecionadas();
      });

      linha.append(titulo, remover);
      listaEl.appendChild(linha);
    });
  }

  function esconderResultados() {
    resultadosEl.hidden = true;
    resultadosEl.innerHTML = "";
  }

  function adicionar(item) {
    if (selecionadas.some((s) => s.id === item.id)) return;

    selecionadas.push(item);
    renderizarSelecionadas();
    inputEl.value = "";
    esconderResultados();
  }

  async function buscar(termo) {
    let consulta = supabase.from("artigos").select("id,titulo").ilike("titulo", `%${termo}%`).limit(8);

    if (idEdicao) consulta = consulta.neq("id", idEdicao);

    const { data } = await consulta;
    const resultados = (data || []).filter((r) => !selecionadas.some((s) => s.id === r.id));

    resultadosEl.innerHTML = "";

    if (resultados.length === 0) {
      const vazio = document.createElement("span");
      vazio.className = "vincular-resultados__vazio";
      vazio.textContent = "Nenhuma solução encontrada.";
      resultadosEl.appendChild(vazio);
    } else {
      resultados.forEach((registro) => {
        const botao = document.createElement("button");
        botao.type = "button";
        botao.className = "vincular-resultado-item";
        botao.textContent = registro.titulo || "Sem título";
        botao.addEventListener("click", () => adicionar(registro));
        resultadosEl.appendChild(botao);
      });
    }

    resultadosEl.hidden = false;
  }

  inputEl.addEventListener("input", () => {
    const termo = inputEl.value.trim();

    clearTimeout(buscaTimer);

    if (!termo) {
      esconderResultados();
      return;
    }

    buscaTimer = setTimeout(() => buscar(termo), 80);
  });

  inputEl.addEventListener("focus", () => {
    if (inputEl.value.trim()) resultadosEl.hidden = false;
  });

  if (relacionadasIniciais && relacionadasIniciais.length > 0) {
    supabase.from("artigos").select("id,titulo").in("id", relacionadasIniciais).then(({ data }) => {
      selecionadas = data || [];
      renderizarSelecionadas();
    });
  }

  vincularAtivo = { resultadosEl, inputEl };
  relacionadasApi = { coletar: () => selecionadas.map((s) => s.id) };
}

//ETIQUETAS (SINTOMAS E TABELAS)
function ativarCampoTags(containerId, inputId) {
  const container = document.getElementById(containerId);
  const input = document.getElementById(inputId);

  function adicionarTag(texto) {
    const valor = texto.trim();

    if (!valor) return;

    const tag = document.createElement("span");
    tag.className = "tag-chip";
    tag.append(valor);

    const remover = document.createElement("button");
    remover.type = "button";
    remover.className = "tag-chip__remover";
    remover.setAttribute("aria-label", "Remover");
    remover.textContent = "×";
    remover.addEventListener("click", () => tag.remove());

    tag.appendChild(remover);
    container.insertBefore(tag, input);
  }

  input.addEventListener("keydown", (evento) => {
    if (evento.key === "Enter" || evento.key === ",") {
      evento.preventDefault();
      adicionarTag(input.value);
      input.value = "";
    }
  });

  return { adicionarTag };
}

//PASSO A PASSO
let passoArrastando = null;

function ajustarAltura(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function renumerarPassos() {
  document.querySelectorAll(".passo-card").forEach((card, indice) => {
    card.querySelector(".passo-card__numero").textContent = indice + 1;
  });
}

function urlDaImagem(item) {
  return item instanceof File ? URL.createObjectURL(item) : item.url;
}

function atualizarImagensDoPasso(card) {
  const imagensArea = card.querySelector(".passo-card__imagens");
  const anexarBtn = card.querySelector(".passo-card__anexar");
  const imagens = card._imagens;

  imagensArea.innerHTML = "";
  imagensArea.hidden = imagens.length === 0;

  imagens.forEach((arquivo, indice) => {
    const item = document.createElement("div");
    item.className = "passo-card__imagem-item";

    const img = document.createElement("img");
    img.src = urlDaImagem(arquivo);
    img.alt = `Imagem ${indice + 1} do passo`;

    const remover = document.createElement("button");
    remover.type = "button";
    remover.className = "passo-card__imagem-remover";
    remover.setAttribute("aria-label", "Remover imagem");
    remover.textContent = "×";
    remover.addEventListener("click", () => {
      imagens.splice(indice, 1);
      atualizarImagensDoPasso(card);
    });

    item.append(img, remover);
    imagensArea.appendChild(item);
  });

  const atingiuLimite = imagens.length >= MAX_IMAGENS_POR_PASSO;

  anexarBtn.disabled = atingiuLimite;
  // O <span>, nao o lastChild: depois dele vem um no de texto com o recuo do
  // HTML, e escrever nele duplicaria o rotulo.
  anexarBtn.querySelector("span").textContent = atingiuLimite ? " Máximo de 3 imagens" : " Anexar imagem";
}

function adicionarImagensAoPasso(card, novosArquivos) {
  for (const arquivo of novosArquivos) {
    if (card._imagens.length >= MAX_IMAGENS_POR_PASSO) break;
    card._imagens.push(arquivo);
  }

  atualizarImagensDoPasso(card);
}

function criarPassoCard(passoInicial) {
  const card = document.createElement("div");

  card.className = "passo-card";
  card.draggable = true;
  card._imagens = passoInicial?.imagens ? passoInicial.imagens.slice() : [];
  card.innerHTML = `
    <div class="passo-card__topo">
      <span class="passo-card__handle" title="Arraste para reordenar">
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/></svg>
      </span>
      <textarea class="passo-card__texto" rows="1" placeholder="Descreva esse passo... (cole uma imagem com Ctrl+V)"></textarea>
    </div>
    <div class="passo-card__rodape">
      <span class="passo-card__numero"></span>
      <button class="passo-card__anexar" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5-9 9"/></svg><span> Anexar imagem</span>
      </button>
      <button class="passo-card__remover" type="button">Remover passo</button>
      <input class="passo-card__input-imagem" type="file" accept="image/*" multiple hidden>
    </div>
    <div class="passo-card__imagens" hidden></div>
  `;

  const textarea = card.querySelector(".passo-card__texto");

  if (passoInicial?.texto) textarea.value = passoInicial.texto;

  textarea.addEventListener("input", () => ajustarAltura(textarea));

  textarea.addEventListener("paste", (evento) => {
    const item = Array.from(evento.clipboardData.items).find((i) => i.type.startsWith("image/"));

    if (!item) return;

    evento.preventDefault();
    adicionarImagensAoPasso(card, [item.getAsFile()]);
  });

  const anexarBtn = card.querySelector(".passo-card__anexar");
  const inputImagem = card.querySelector(".passo-card__input-imagem");

  anexarBtn.addEventListener("click", () => inputImagem.click());

  inputImagem.addEventListener("change", () => {
    adicionarImagensAoPasso(card, Array.from(inputImagem.files));
    inputImagem.value = "";
  });

  atualizarImagensDoPasso(card);

  card.querySelector(".passo-card__remover").addEventListener("click", () => {
    card.remove();
    renumerarPassos();
  });

  card.addEventListener("dragstart", () => {
    passoArrastando = card;
    card.classList.add("passo-card--arrastando");
  });

  card.addEventListener("dragend", () => {
    card.classList.remove("passo-card--arrastando");
    passoArrastando = null;
    renumerarPassos();
  });

  card.addEventListener("dragover", (evento) => {
    evento.preventDefault();

    if (!passoArrastando || passoArrastando === card) return;

    const area = card.getBoundingClientRect();
    const depois = evento.clientY - area.top > area.height / 2;

    card.parentElement.insertBefore(passoArrastando, depois ? card.nextSibling : card);
  });

  return card;
}

function ativarPassoAPasso(passosIniciais) {
  const lista = document.getElementById("passos-lista");
  const addBtn = document.getElementById("add-passo");

  function adicionarPasso(passoInicial) {
    const card = criarPassoCard(passoInicial);

    lista.appendChild(card);

    if (passoInicial?.texto) ajustarAltura(card.querySelector(".passo-card__texto"));

    renumerarPassos();
  }

  addBtn.addEventListener("click", () => adicionarPasso());

  if (passosIniciais && passosIniciais.length > 0) {
    passosIniciais.forEach((passo) => adicionarPasso(passo));
  } else {
    adicionarPasso();
  }
}

//ANEXOS
function ativarAnexos(anexosIniciais) {
  const dropzone = document.getElementById("anexos-dropzone");
  const selecionarBtn = document.getElementById("anexos-selecionar");
  const input = document.getElementById("anexos-input");
  const lista = document.getElementById("anexos-lista");

  dropzone._arquivos = [];

  function adicionarArquivo(arquivo) {
    dropzone._arquivos.push(arquivo);

    const nome = arquivo instanceof File ? arquivo.name : arquivo.nome;
    const item = document.createElement("div");

    item.className = "anexo-item";
    item.innerHTML = `
      <span class="anexo-item__icone">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5-9 9"/></svg>
      </span>
      <div class="anexo-item__info">
        <span class="anexo-item__nome"></span>
        <div class="anexo-item__barra"><div class="anexo-item__progresso"></div></div>
      </div>
      <button type="button" class="anexo-item__remover" aria-label="Remover anexo">×</button>
    `;

    // textContent e nao innerHTML: nome de arquivo pode conter < ou &.
    item.querySelector(".anexo-item__nome").textContent = nome;

    const progresso = item.querySelector(".anexo-item__progresso");

    item.querySelector(".anexo-item__remover").addEventListener("click", () => {
      const indice = dropzone._arquivos.indexOf(arquivo);

      if (indice > -1) dropzone._arquivos.splice(indice, 1);

      item.remove();
    });

    lista.appendChild(item);
    requestAnimationFrame(() => { progresso.style.width = "100%"; });
  }

  function adicionarArquivos(arquivos) {
    Array.from(arquivos).forEach(adicionarArquivo);
  }

  selecionarBtn.addEventListener("click", () => input.click());

  dropzone.addEventListener("click", (evento) => {
    if (evento.target === selecionarBtn) return;
    input.click();
  });

  input.addEventListener("change", () => {
    adicionarArquivos(input.files);
    input.value = "";
  });

  ["dragover", "dragleave", "drop"].forEach((tipo) => {
    dropzone.addEventListener(tipo, (evento) => evento.preventDefault());
  });

  dropzone.addEventListener("dragover", () => dropzone.classList.add("anexos-dropzone--sobre"));
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("anexos-dropzone--sobre"));
  dropzone.addEventListener("drop", (evento) => {
    dropzone.classList.remove("anexos-dropzone--sobre");
    adicionarArquivos(evento.dataTransfer.files);
  });

  if (anexosIniciais && anexosIniciais.length > 0) adicionarArquivos(anexosIniciais);
}

//CAMPOS DO REGISTRO
function criarCampos(artigo, tipo) {
  const tipoAtual = tipo || artigo?.tipo || "erro";
  const ehProcedimento = tipoAtual === "procedimento";

  const tituloPlaceholder = ehProcedimento
    ? "Cancelamento de pedido já faturado"
    : "Erro ORA-01722 ao faturar pedido com desconto";
  const resolvePlaceholder = ehProcedimento
    ? "Passo a passo para cancelar um pedido que já passou pelo faturamento, revertendo os lançamentos gerados."
    : "Conversão inválida no campo de desconto quando o pedido tem parcelamento. Ajuste de máscara na rotina de faturamento.";

  registroCampos.innerHTML = `
    <div class="campo-titulo">
      <input class="campo-titulo-input" type="text" placeholder="${tituloPlaceholder}">
    </div>

    <div class="campo-grupo">
      <label class="campo-label">O que este registro resolve</label>
      <textarea class="campo-textarea" rows="3" placeholder="${resolvePlaceholder}"></textarea>
    </div>

    <div class="campo-grupo">
      <label class="campo-label">Sintomas e palavras-chave</label>
      <div class="tags-campo" id="tags-campo">
        <input class="tags-input" type="text" id="tags-input" placeholder="adicionar...">
      </div>
    </div>

    ${ehProcedimento ? "" : `
    <div class="campo-grupo">
      <label class="campo-label">Código ou mensagem de erro</label>
      <input class="campo-input campo-input--codigo" type="text" placeholder="ORA-01722: invalid number">
    </div>
    `}

    <div class="passo-a-passo">
      <div class="passo-a-passo__cabecalho">
        <span class="passo-a-passo__titulo">Passo a passo da solução</span>
        <span class="passo-a-passo__dica">arraste para reordenar</span>
      </div>

      <div class="passos-lista" id="passos-lista"></div>

      <button class="btn-adicionar-passo" type="button" id="add-passo">+ Adicionar passo</button>
    </div>

    <div class="campo-grupo">
      <label class="campo-label">Tabelas e campos envolvidos</label>
      <div class="tags-campo" id="tabelas-campo">
        <input class="tags-input tags-input--mono" type="text" id="tabelas-input" placeholder="adicionar...">
      </div>
    </div>

    <div class="campo-linha-dupla">
      <div class="campo-grupo">
        <label class="campo-label">Anexos</label>
        <div class="anexos-dropzone" id="anexos-dropzone">
          <span>Arraste arquivos aqui ou <button type="button" class="anexos-link" id="anexos-selecionar">selecione do computador</button></span>
          <input class="anexos-input" type="file" id="anexos-input" multiple hidden>
        </div>
        <div class="anexos-lista" id="anexos-lista"></div>
      </div>

      <div class="campo-grupo">
        <label class="campo-label">Soluções relacionadas</label>
        <div class="vincular-campo">
          <svg class="vincular-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          <input class="vincular-input" type="text" id="vincular-input" placeholder="Buscar registro para vincular...">
        </div>
        <div class="vincular-resultados" id="vincular-resultados" hidden></div>
        <div class="relacionadas-lista" id="relacionadas-lista"></div>
      </div>
    </div>
  `;

  const tagsApi = ativarCampoTags("tags-campo", "tags-input");
  const tabelasApi = ativarCampoTags("tabelas-campo", "tabelas-input");

  ativarPassoAPasso(artigo?.passos);
  ativarAnexos(artigo?.anexos);
  ativarSolucoesRelacionadas(artigo?.relacionadas);

  if (!artigo) return;

  registroCampos.querySelector(".campo-titulo-input").value = artigo.titulo || "";
  registroCampos.querySelector(".campo-textarea").value = artigo.conteudo || "";

  const codigoErroInput = registroCampos.querySelector(".campo-input--codigo");

  if (codigoErroInput) codigoErroInput.value = artigo.codigo_erro || "";

  (artigo.sintomas || []).forEach((tag) => tagsApi.adicionarTag(tag));
  (artigo.tabelas_campos || []).forEach((tag) => tabelasApi.adicionarTag(tag));
}

//ESCOLHA DO TIPO
tipoCards.forEach((card) => {
  card.addEventListener("click", () => {
    tipoCards.forEach((c) => c.classList.remove("tipo-card--ativo"));
    card.classList.add("tipo-card--ativo");

    registroVazio.hidden = true;
    registroCampos.hidden = false;

    criarCampos(undefined, card.dataset.tipo);
  });
});

//PRIORIDADE
const criticidadeBtns = document.querySelectorAll(".criticidade-btn");

criticidadeBtns.forEach((botao) => {
  botao.addEventListener("click", () => {
    criticidadeBtns.forEach((b) => b.classList.remove("criticidade-btn--ativo"));
    botao.classList.add("criticidade-btn--ativo");
  });
});

//CATEGORIA: O "+" CADASTRA UMA NOVA NA HORA
const categoriaSelect = document.getElementById("categoria-select");

async function carregarCategorias() {
  const { data } = await supabase.from("categorias").select("id,nome").eq("ativo", true).order("nome");

  categoriaSelect.innerHTML = "";

  const vazia = document.createElement("option");
  vazia.value = "";
  vazia.textContent = "Selecione a categoria";
  categoriaSelect.appendChild(vazia);

  (data || []).forEach((registro) => {
    const opcao = document.createElement("option");
    opcao.value = registro.id;
    opcao.textContent = registro.nome;
    categoriaSelect.appendChild(opcao);
  });
}

const categoriasProntas = carregarCategorias();

(function ativarCadastroDeCategoria() {
  const addBtn = document.getElementById("categoria-add-btn");
  const form = document.getElementById("categoria-novo-form");
  const input = document.getElementById("categoria-novo-input");
  const confirmar = document.getElementById("categoria-novo-confirmar");
  const cancelar = document.getElementById("categoria-novo-cancelar");

  function fechar() {
    form.hidden = true;
    input.value = "";
  }

  addBtn.addEventListener("click", () => {
    form.hidden = false;
    input.focus();
  });

  cancelar.addEventListener("click", fechar);

  confirmar.addEventListener("click", async () => {
    const nome = input.value.trim();

    if (!nome) return;

    confirmar.disabled = true;

    const { data, error } = await supabase
      .from("categorias")
      .insert({ nome })
      .select("id")
      .single();

    confirmar.disabled = false;

    if (error) {
      publicacaoErro.textContent = "Não foi possível criar a categoria.";
      console.error("Erro ao cadastrar categoria:", error);
      return;
    }

    await carregarCategorias();
    categoriaSelect.value = data.id;
    fechar();
  });

  input.addEventListener("keydown", (evento) => {
    if (evento.key !== "Enter") return;

    evento.preventDefault();
    confirmar.click();
  });
})();

//ENVIO DE ARQUIVOS
async function enviarArquivo(artigoId, nomeArquivo, arquivo) {
  const caminho = `${artigoId}/${nomeArquivo}`;
  const { error } = await supabase.storage.from(BUCKET).upload(caminho, arquivo);

  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(caminho);

  return data.publicUrl;
}

async function coletarPassos(artigoId) {
  const cards = Array.from(document.querySelectorAll(".passo-card"));

  return Promise.all(cards.map(async (card, indice) => {
    const texto = card.querySelector(".passo-card__texto").value.trim();
    const arquivos = card._imagens || [];

    const imagens = await Promise.all(arquivos.map(async (arquivo, imgIndice) => {
      // O que não é File já veio do banco com url: passa direto.
      if (!(arquivo instanceof File)) return arquivo;

      const nomeArquivo = `passo-${indice + 1}-${imgIndice + 1}-${Date.now()}-${arquivo.name || "colada.png"}`;
      const url = await enviarArquivo(artigoId, nomeArquivo, arquivo);

      return { nome: arquivo.name || nomeArquivo, url };
    }));

    return { ordem: indice + 1, texto, imagens };
  }));
}

async function coletarAnexos(artigoId) {
  const dropzone = document.getElementById("anexos-dropzone");
  const arquivos = dropzone?._arquivos || [];

  return Promise.all(arquivos.map(async (arquivo, indice) => {
    if (!(arquivo instanceof File)) return arquivo;

    const nomeArquivo = `${Date.now()}-${indice + 1}-${arquivo.name}`;
    const url = await enviarArquivo(artigoId, nomeArquivo, arquivo);

    return { nome: arquivo.name, url };
  }));
}

function coletarTags(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} .tag-chip`))
    .map((chip) => chip.firstChild.textContent.trim())
    .filter(Boolean);
}

//SALVAR
salvarBtn.addEventListener("click", async () => {
  publicacaoErro.textContent = "";

  const tipoAtivo = document.querySelector(".tipo-card--ativo");

  if (!tipoAtivo) {
    publicacaoErro.textContent = "Escolha um tipo de registro antes de salvar.";
    return;
  }

  const titulo = document.querySelector(".campo-titulo-input")?.value.trim();

  if (!titulo) {
    publicacaoErro.textContent = "Preencha o título da solução.";
    return;
  }

  salvarBtn.disabled = true;
  salvarBtn.textContent = idEdicao ? "Salvando edição..." : "Salvando...";

  try {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) throw new Error("Sessão expirada.");

    const artigoId = idEdicao || crypto.randomUUID();

    // Os arquivos sobem antes do registro: o caminho no bucket usa o id.
    const [passos, anexos] = await Promise.all([
      coletarPassos(artigoId),
      coletarAnexos(artigoId)
    ]);

    const dados = {
      tipo: tipoAtivo.dataset.tipo,
      titulo,
      conteudo: document.querySelector(".campo-textarea")?.value.trim() || "",
      codigo_erro: document.querySelector(".campo-input--codigo")?.value.trim() || null,
      sintomas: coletarTags("tags-campo"),
      tabelas_campos: coletarTags("tabelas-campo"),
      passos,
      anexos,
      autor: document.getElementById("autor-input").value.trim() || null,
      categoria_id: categoriaSelect.value || null,
      modulo: montarCaminho(
        document.getElementById("caminho-pagina-input")?.value.trim(),
        document.getElementById("caminho-texto-input")?.value.trim()
      ),
      criticidade: document.querySelector(".criticidade-btn--ativo")?.dataset.criticidade || null,
      relacionadas: relacionadasApi ? relacionadasApi.coletar() : []
    };

    const { error } = idEdicao
      ? await supabase.from("artigos").update(dados).eq("id", idEdicao)
      : await supabase.from("artigos").insert({ id: artigoId, ...dados, autor_id: user.id, ativo: true });

    if (error) throw error;

    window.location.href = idEdicao ? `base.html?id=${idEdicao}` : "base.html";
  } catch (erro) {
    console.error("Erro ao salvar solução:", erro);
    publicacaoErro.textContent = "Não foi possível salvar. Tente novamente.";
  } finally {
    salvarBtn.disabled = false;
    salvarBtn.textContent = idEdicao ? "Confirmar edição" : "Salvar";
  }
});

//MODO EDICAO
async function iniciarModoEdicao() {
  if (!idEdicao) return;

  const { data, error } = await supabase.from("artigos").select("*").eq("id", idEdicao).single();

  if (error || !data) {
    console.error("Não foi possível carregar a solução para edição:", error);
    return;
  }

  document.title = "Editar solução — Central Única de TI";

  const cabecalho = document.getElementById("pagina-cabecalho");

  if (cabecalho) cabecalho.textContent = "Editar solução";

  salvarBtn.textContent = "Confirmar edição";

  const cardTipo = document.querySelector(`.tipo-card[data-tipo="${data.tipo}"]`);

  if (cardTipo) {
    tipoCards.forEach((c) => c.classList.remove("tipo-card--ativo"));
    cardTipo.classList.add("tipo-card--ativo");
    registroVazio.hidden = true;
    registroCampos.hidden = false;
    criarCampos(data, data.tipo);
  }

  const { pagina, caminho } = separarCaminho(data.modulo);

  document.getElementById("caminho-pagina-input").value = pagina;
  document.getElementById("caminho-texto-input").value = caminho;

  if (data.criticidade) {
    criticidadeBtns.forEach((b) => b.classList.remove("criticidade-btn--ativo"));
    document.querySelector(`.criticidade-btn[data-criticidade="${data.criticidade}"]`)
      ?.classList.add("criticidade-btn--ativo");
  }

  document.getElementById("autor-input").value = data.autor || "";

  await categoriasProntas;

  if (data.categoria_id) categoriaSelect.value = data.categoria_id;
}

iniciarModoEdicao();
