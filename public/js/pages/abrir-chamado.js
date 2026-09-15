// Abrir chamado.
//
// Por enquanto é a porta de entrada do "Novo chamado" da home. O caminho
// certo, quando a triagem existir, é passar por ela antes (triagem.html) e
// só chegar aqui se a base de soluções não resolver.
//
// Dois passos: escolher o tipo — cadastro de colaborador, desligamento de
// colaborador ou suporte TI — e preencher o formulário daquele tipo. O tipo
// vai na URL (?tipo=cadastro), então o voltar do navegador volta às caixas.
//
// Em todos os tipos, "Quem está abrindo" (nome, e-mail, setor e unidade) vem
// do cadastro de quem está logado e não pode ser alterado; a unidade do
// chamado é a desse cadastro.
//
// Todo chamado nasce na fila "Inbox" (a mesma para onde o reabrir devolve).
// O título é o assunto (suporte) ou "Tipo · Nome" (colaborador); a trigger
// do banco completa " | Ticket-N" (migration 20260915103000). Nos tipos de
// colaborador os campos vão organizados em dados_formulario e também numa
// descrição legível, que é o que a equipe lê na ficha do Portal.

import { supabase } from "../config/supabase-config.js";

const passoTipo = document.querySelector("[data-passo-tipo]");
const formulario = document.querySelector("[data-formulario]");
const grupos = formulario.querySelectorAll("[data-grupo]");
const aviso = document.querySelector("[data-aviso]");
const tipoIcone = document.querySelector("[data-tipo-icone]");
const tipoNome = document.querySelector("[data-tipo-nome]");
const campoArquivos = document.querySelector("[data-arquivos]");
const areaSoltar = document.querySelector("[data-soltar]");
const listaPendentes = document.querySelector("[data-pendentes]");
const botaoEnviar = document.querySelector("[data-enviar]");
const sucesso = document.querySelector("[data-sucesso]");
const sucessoTitulo = document.querySelector("[data-sucesso-titulo]");
const sucessoTexto = document.querySelector("[data-sucesso-texto]");
const botaoOutro = document.querySelector("[data-abrir-outro]");
const perfilOutro = document.querySelector("[data-perfil-outro]");
const campoRepassar = document.querySelector("[data-repassar-emails]");
const caixaExcluirEmail = document.querySelector("[data-excluir-email]");

const TAMANHO_MAXIMO = 10 * 1024 * 1024;

// padraoCategoria: como achar a categoria do tipo pelo nome (a migration
// 20260915110000 cria "Cadastro de Colaborador" e "Desligamento de
// Colaborador"). Suporte usa a categoria que a pessoa escolhe.
const TIPOS = {
  cadastro: { titulo: "Cadastro de colaborador", padraoCategoria: /cadastro|admiss/i },
  desligamento: { titulo: "Desligamento de colaborador", padraoCategoria: /deslig|demiss/i },
  suporte: { titulo: "Suporte TI", padraoCategoria: null },
};

// Categoria que o próprio sistema usa (o cadastro de usuário abre esse
// chamado sozinho): não faz sentido escolher.
const CATEGORIA_DO_SISTEMA = /aprova[cç][aã]o de acesso/i;

let usuarioId = null;
let filaDeEntradaId = null;
let categorias = [];
let pendentes = []; // { arquivo, previa: URL local da imagem, ou null }
let tipoAtual = null;

// Quem está abrindo, lido do cadastro. unidadeId vai no chamado.
let solicitante = { nome: "", email: "", setor: "", unidade: "", unidadeId: null };

function avisar(texto) {
  aviso.textContent = texto;
}

/* ==========================================================================
   LEITURA DOS CAMPOS DO TIPO ABERTO
   ========================================================================== */

function grupoAtual() {
  return formulario.querySelector(`[data-grupo="${tipoAtual}"]`);
}

function campo(nome) {
  return grupoAtual().querySelector(`[data-campo="${nome}"]`);
}

function valor(nome) {
  return campo(nome)?.value.trim() ?? "";
}

// Texto visível da opção escolhida num select ("Vendas" em vez do id).
function textoEscolhido(nome) {
  const select = campo(nome);

  return select?.value ? select.selectedOptions[0]?.textContent.trim() ?? "" : "";
}

function marcados(nome) {
  return [...grupoAtual().querySelectorAll(`input[name="${nome}"]:checked`)].map((caixa) => caixa.value);
}

function escolhido(nome) {
  return grupoAtual().querySelector(`input[name="${nome}"]:checked`)?.value ?? "";
}

function simNao(nome) {
  return escolhido(nome) === "sim";
}

// "2026-09-20" -> "20/09/2026"
function dataLegivel(valorDoCampo) {
  if (!valorDoCampo) return "";

  const [ano, mes, dia] = valorDoCampo.split("-");

  return `${dia}/${mes}/${ano}`;
}

function soNumeros(texto) {
  return (texto ?? "").replace(/\D/g, "");
}

/* ==========================================================================
   MASCARAS: CPF, CEP E CELULAR SE FORMATAM ENQUANTO A PESSOA DIGITA
   ========================================================================== */

const MASCARAS = {
  cpf(digitos) {
    const d = digitos.slice(0, 11);

    if (d.length > 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
    if (d.length > 6) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    if (d.length > 3) return `${d.slice(0, 3)}.${d.slice(3)}`;

    return d;
  },

  cep(digitos) {
    const d = digitos.slice(0, 8);

    return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
  },

  // (12) 3456-7890 para fixo com 10 dígitos, (12) 91234-5678 para celular com 11.
  celular(digitos) {
    const d = digitos.slice(0, 11);

    if (!d) return "";
    if (d.length <= 2) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;

    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  },
};

formulario.querySelectorAll("[data-mascara]").forEach((entrada) => {
  entrada.addEventListener("input", () => {
    entrada.value = MASCARAS[entrada.dataset.mascara](soNumeros(entrada.value));
  });
});

/* ==========================================================================
   VALIDADORES DE FORMATO (alem de "nao pode ficar vazio")
   Cada um devolve true ou a mensagem de erro.
   ========================================================================== */

// Confere os dois digitos verificadores. CPF com todos os numeros iguais
// (111.111.111-11) passa na conta, mas nao existe.
function cpfValido(texto) {
  const d = soNumeros(texto);

  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;

  const digito = (base) => {
    const soma = [...base].reduce((total, numero, indice) => total + Number(numero) * (base.length + 1 - indice), 0);
    const resto = (soma * 10) % 11;

    return resto === 10 ? 0 : resto;
  };

  return digito(d.slice(0, 9)) === Number(d[9]) && digito(d.slice(0, 10)) === Number(d[10]);
}

const VALIDADORES = {
  cpf: (texto) => cpfValido(texto) || "CPF inválido. Confira os 11 números.",
  cep: (texto) => soNumeros(texto).length === 8 || "O CEP precisa ter 8 números.",
  celular: (texto) => [10, 11].includes(soNumeros(texto).length) || "Informe o celular com DDD. Ex.: (12) 91234-5678.",
  email: (texto) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto) || "E-mail inválido. Confira o endereço.",
  nascimento: (texto) => {
    const data = new Date(`${texto}T00:00:00`);
    const hoje = new Date();

    if (Number.isNaN(data.getTime()) || data >= hoje) return "Data de nascimento inválida.";
    if (hoje.getFullYear() - data.getFullYear() > 100) return "Data de nascimento inválida.";

    return true;
  },
};

/* ==========================================================================
   PASSOS: CAIXAS DE TIPO <-> FORMULARIO
   ========================================================================== */

function mostrarTipos() {
  tipoAtual = null;
  passoTipo.hidden = false;
  formulario.hidden = true;
  sucesso.hidden = true;
  avisar("");

  window.scrollTo({ top: 0, behavior: "instant" });
}

function mostrarFormulario(tipo) {
  tipoAtual = tipo;

  grupos.forEach((grupo) => {
    grupo.hidden = grupo.dataset.grupo !== tipo;
  });

  // A faixa do formulário repete o ícone e o nome da porta escolhida.
  const iconeDaPorta = passoTipo.querySelector(`[data-icone-tipo="${tipo}"]`);
  tipoIcone.innerHTML = iconeDaPorta.innerHTML;
  tipoNome.textContent = TIPOS[tipo].titulo;

  passoTipo.hidden = true;
  sucesso.hidden = true;
  formulario.hidden = false;
  avisar("");

  // Sempre abre no topo. O foco no primeiro campo não pode rolar a página
  // (sem preventScroll o navegador descia até ele).
  window.scrollTo({ top: 0, behavior: "instant" });
  grupoAtual()
    .querySelector("input:not([type=radio]):not([type=checkbox]), textarea")
    ?.focus({ preventScroll: true });
}

function tipoDaUrl() {
  const tipo = new URLSearchParams(window.location.search).get("tipo");

  return Object.hasOwn(TIPOS, tipo ?? "") ? tipo : null;
}

// O voltar do navegador não deve devolver a rolagem antiga: cada passo
// começa no topo.
if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";

function irPara(tipo) {
  window.history.pushState({ tipo }, "", tipo ? `?tipo=${tipo}` : window.location.pathname);

  if (tipo) mostrarFormulario(tipo); else mostrarTipos();
}

window.addEventListener("popstate", () => {
  const tipo = tipoDaUrl();

  if (tipo) mostrarFormulario(tipo); else mostrarTipos();
});

passoTipo.querySelectorAll("[data-escolher-tipo]").forEach((caixa) => {
  caixa.addEventListener("click", () => irPara(caixa.dataset.escolherTipo));
});

formulario.querySelectorAll("[data-trocar-tipo]").forEach((botao) => {
  botao.addEventListener("click", () => irPara(null));
});

//DESLIGAMENTO: "Repassar os e-mails para" so aparece enquanto "Excluir
//e-mail" estiver desmarcado — e-mail excluido nao tem para onde repassar.
function atualizarRepassar() {
  campoRepassar.hidden = caixaExcluirEmail.checked;
}

caixaExcluirEmail.addEventListener("change", atualizarRepassar);

//PERFIL "OUTRO": abre o campo para descrever qual perfil.
formulario.querySelectorAll('input[name="perfil"]').forEach((opcao) => {
  opcao.addEventListener("change", () => {
    const outro = opcao.checked && opcao.value === "outro";

    perfilOutro.hidden = !outro;

    if (outro) perfilOutro.querySelector("input").focus();
  });
});

/* ==========================================================================
   CARGA: QUEM ESTA ABRINDO, SETORES, CATEGORIAS E FILA DE ENTRADA
   ========================================================================== */

function preencherSelects(lista, itens, rotuloVazio) {
  formulario.querySelectorAll(`[data-lista="${lista}"]`).forEach((select) => {
    const vazio = document.createElement("option");
    vazio.value = "";
    vazio.textContent = rotuloVazio;

    select.replaceChildren(vazio);

    itens.forEach((item) => {
      const opcao = document.createElement("option");
      opcao.value = item.id;
      opcao.textContent = item.nome;
      select.appendChild(opcao);
    });
  });
}

function categoriaDoTipo(tipo) {
  const padrao = TIPOS[tipo].padraoCategoria;

  return padrao ? categorias.find((categoria) => padrao.test(categoria.nome))?.id ?? null : null;
}

async function carregar() {
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return;

  usuarioId = user.id;

  // Unidades e setores vêm inteiros (e não por junção no select do usuário):
  // servem para traduzir os ids do cadastro e, os setores, para o select do
  // colaborador.
  const [unidades, setores, listaCategorias, filas, perfil] = await Promise.all([
    supabase.from("unidades").select("id, nome").order("nome"),
    supabase.from("setores").select("id, nome, ativo").order("nome"),
    supabase.from("categorias").select("id, nome").eq("ativo", true).order("nome"),
    supabase.from("filas").select("id, nome").eq("ativo", true).order("ordem"),
    supabase.from("usuarios").select("nome, sobrenome, email, unidade_id, setor_id").eq("id", user.id).single(),
  ]);

  const erro = unidades.error ?? setores.error ?? listaCategorias.error ?? filas.error ?? perfil.error;

  if (erro) {
    console.error("Erro ao carregar o formulário:", erro);
    avisar("Não foi possível carregar o formulário. Recarregue a página.");
    botaoEnviar.disabled = true;
    return;
  }

  const nomeDaUnidade = new Map((unidades.data ?? []).map((unidade) => [unidade.id, unidade.nome]));
  const nomeDoSetor = new Map((setores.data ?? []).map((setor) => [setor.id, setor.nome]));

  //QUEM ESTA ABRINDO: do cadastro, sem poder mudar.
  solicitante = {
    nome: [perfil.data.nome, perfil.data.sobrenome].filter(Boolean).join(" "),
    email: perfil.data.email ?? user.email ?? "",
    setor: nomeDoSetor.get(perfil.data.setor_id) ?? "",
    unidade: nomeDaUnidade.get(perfil.data.unidade_id) ?? "",
    unidadeId: perfil.data.unidade_id ?? null,
  };

  formulario.querySelectorAll("[data-solicitante]").forEach((entrada) => {
    entrada.value = solicitante[entrada.dataset.solicitante] || "Não informado no cadastro";
  });

  categorias = listaCategorias.data ?? [];

  preencherSelects(
    "setores",
    (setores.data ?? []).filter((setor) => setor.ativo !== false),
    "Selecione o setor",
  );

  // No suporte a pessoa escolhe a categoria; as de colaborador e a do
  // sistema ficam fora da lista, porque têm formulário (ou dono) próprio.
  preencherSelects(
    "categorias",
    categorias.filter((categoria) => !CATEGORIA_DO_SISTEMA.test(categoria.nome)
      && !TIPOS.cadastro.padraoCategoria.test(categoria.nome)
      && !TIPOS.desligamento.padraoCategoria.test(categoria.nome)),
    "Selecione a categoria",
  );

  // Chamado novo cai na fila de entrada. Sem "Inbox", a primeira fila do
  // quadro — melhor chegar em algum lugar do que não abrir.
  const listaFilas = filas.data ?? [];
  filaDeEntradaId = (listaFilas.find((fila) => fila.nome === "Inbox") ?? listaFilas[0])?.id ?? null;
}

/* ==========================================================================
   VALIDACAO: MENSAGEM NO TOPO DO CARTAO E BORDA NO CAMPO
   Cada campo obrigatorio diz no HTML a propria mensagem (data-mensagem), o
   tamanho minimo (data-minimo) e, se tiver formato, o validador (data-validar).
   Escolha unica obrigatoria (perfil) usa data-escolha-obrigatoria no fieldset.
   ========================================================================== */

function marcarErro(elemento, comErro) {
  elemento.classList.toggle("abrir__input--erro", comErro);
  elemento.setAttribute("aria-invalid", String(comErro));
}

function validar() {
  const grupo = grupoAtual();
  let primeiro = null;

  const falhar = (elemento, mensagem) => {
    if (!primeiro) primeiro = { elemento, mensagem };
  };

  grupo.querySelectorAll("[data-obrigatorio]").forEach((elemento) => {
    const texto = elemento.value.trim();
    const minimo = Number(elemento.dataset.minimo || 1);
    let mensagem = texto.length < minimo ? elemento.dataset.mensagem : null;

    if (!mensagem && elemento.dataset.validar) {
      const resultado = VALIDADORES[elemento.dataset.validar](texto);
      mensagem = resultado === true ? null : resultado;
    }

    marcarErro(elemento, Boolean(mensagem));

    if (mensagem) falhar(elemento, mensagem);
  });

  grupo.querySelectorAll("[data-escolha-obrigatoria]").forEach((conjunto) => {
    const nome = conjunto.dataset.escolhaObrigatoria;
    const opcao = escolhido(nome);
    const semEscolha = !opcao;

    conjunto.classList.toggle("abrir__escolha--erro", semEscolha);

    if (semEscolha) {
      falhar(conjunto.querySelector("input"), conjunto.dataset.mensagem);
      return;
    }

    // "Outro" sem dizer qual não ajuda a equipe.
    const campoOutro = conjunto.querySelector(`[data-campo="${nome}_outro"]`);

    if (opcao === "outro" && campoOutro) {
      const vazio = !campoOutro.value.trim();

      marcarErro(campoOutro, vazio);

      if (vazio) falhar(campoOutro, "Escreva qual é o perfil de acesso.");
    }
  });

  if (!primeiro) {
    avisar("");
    return true;
  }

  avisar(primeiro.mensagem);
  primeiro.elemento.focus();

  return false;
}

// Corrigiu o campo: a borda vermelha sai na hora.
["input", "change"].forEach((tipoDeEvento) => {
  formulario.addEventListener(tipoDeEvento, (evento) => {
    const alvo = evento.target;

    if (alvo.classList?.contains("abrir__input--erro")) marcarErro(alvo, false);

    alvo.closest?.(".abrir__escolha--erro")?.classList.remove("abrir__escolha--erro");
  });
});

/* ==========================================================================
   PRINTS E ARQUIVOS: ARRASTAR, ESCOLHER OU CTRL+V
   ========================================================================== */

function desenharPendentes() {
  listaPendentes.replaceChildren();
  listaPendentes.hidden = !pendentes.length;

  pendentes.forEach((pendente, indice) => {
    const item = document.createElement("div");
    item.className = "abrir__pendente";
    item.title = pendente.arquivo.name;

    if (pendente.previa) {
      const imagem = document.createElement("img");
      imagem.src = pendente.previa;
      imagem.alt = pendente.arquivo.name;
      item.appendChild(imagem);
    } else {
      item.classList.add("abrir__pendente--arquivo");

      const nome = document.createElement("span");
      nome.className = "abrir__pendente-nome";
      nome.textContent = pendente.arquivo.name;
      item.appendChild(nome);
    }

    const remover = document.createElement("button");
    remover.type = "button";
    remover.className = "abrir__pendente-remover";
    remover.textContent = "×";
    remover.setAttribute("aria-label", `Remover ${pendente.arquivo.name}`);
    remover.addEventListener("click", () => {
      if (pendente.previa) URL.revokeObjectURL(pendente.previa);

      pendentes.splice(indice, 1);
      desenharPendentes();
    });

    item.appendChild(remover);
    listaPendentes.appendChild(item);
  });
}

function adicionarArquivos(arquivos) {
  const recusados = [];

  arquivos.forEach((arquivo) => {
    const aceito = arquivo.type.startsWith("image/") || arquivo.type === "application/pdf";

    if (!aceito || arquivo.size > TAMANHO_MAXIMO) {
      recusados.push(arquivo.name);
      return;
    }

    pendentes.push({
      arquivo,
      previa: arquivo.type.startsWith("image/") ? URL.createObjectURL(arquivo) : null,
    });
  });

  avisar(recusados.length
    ? `Não foi possível anexar: ${recusados.join(", ")}. Só imagens ou PDF, até 10 MB cada.`
    : "");

  desenharPendentes();
}

function limparPendentes() {
  pendentes.forEach((pendente) => {
    if (pendente.previa) URL.revokeObjectURL(pendente.previa);
  });

  pendentes = [];
  campoArquivos.value = "";
  desenharPendentes();
}

campoArquivos.addEventListener("change", () => {
  adicionarArquivos([...campoArquivos.files]);
  // Limpa o input: escolher o mesmo arquivo de novo também precisa disparar.
  campoArquivos.value = "";
});

["dragenter", "dragover"].forEach((tipoDeEvento) => {
  areaSoltar.addEventListener(tipoDeEvento, (evento) => {
    evento.preventDefault();
    areaSoltar.classList.add("abrir__soltar--sobre");
  });
});

["dragleave", "drop"].forEach((tipoDeEvento) => {
  areaSoltar.addEventListener(tipoDeEvento, (evento) => {
    evento.preventDefault();
    areaSoltar.classList.remove("abrir__soltar--sobre");
  });
});

areaSoltar.addEventListener("drop", (evento) => {
  adicionarArquivos([...(evento.dataTransfer?.files ?? [])]);
});

//CTRL+V EM QUALQUER LUGAR COM O FORMULARIO ABERTO: um print copiado vira
//anexo. Com texto junto (planilha, por exemplo), o texto continua colando
//no campo onde o cursor está.
document.addEventListener("paste", (evento) => {
  if (formulario.hidden) return;

  const itens = [...(evento.clipboardData?.items ?? [])];
  const imagens = itens
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);

  if (!imagens.length) return;

  const temTexto = itens.some((item) => item.kind === "string" && item.type === "text/plain");

  if (!temTexto) evento.preventDefault();

  // Print colado chega sempre como "image.png": nome único para não virar
  // uma lista de anexos todos iguais.
  const agora = Date.now();

  adicionarArquivos(imagens.map((imagem, indice) => {
    const extensao = (imagem.type.split("/")[1] ?? "png").replace("jpeg", "jpg");

    return new File([imagem], `print-${agora}-${indice + 1}.${extensao}`, { type: imagem.type });
  }));
});

/* ==========================================================================
   MONTAR O CHAMADO DO TIPO ABERTO
   ========================================================================== */

// Descrição legível dos tipos de colaborador: um campo por linha, só os
// preenchidos — é o que a equipe lê na ficha do chamado no Portal.
function descricaoEmLinhas(titulo, linhas) {
  return [
    titulo,
    "",
    ...linhas.filter(([, conteudo]) => conteudo).map(([rotulo, conteudo]) => `${rotulo}: ${conteudo}`),
  ].join("\n");
}

function dadosDoSolicitante() {
  const { nome, email, setor, unidade } = solicitante;

  return { nome, email, setor, unidade };
}

function montarChamado() {
  // Comum aos três: a unidade do chamado é a do cadastro de quem abre.
  const base = {
    unidade_id: solicitante.unidadeId,
    cliente_na_loja: false,
    sistema_lento_ou_fora: false,
    acesso_remoto: null,
  };

  if (tipoAtual === "suporte") {
    const assunto = valor("assunto");

    return {
      ...base,
      titulo: assunto,
      descricao: valor("descricao"),
      categoria_id: valor("categoria"),
      cliente_na_loja: simNao("cliente_na_loja"),
      sistema_lento_ou_fora: simNao("sistema_lento_ou_fora"),
      dados_formulario: { origem: "abrir-chamado", tipo: "suporte", solicitante: dadosDoSolicitante(), assunto },
    };
  }

  const titulo = TIPOS[tipoAtual].titulo;
  const nome = valor("nome");

  if (tipoAtual === "cadastro") {
    const perfilEscolhido = escolhido("perfil");
    const perfil = perfilEscolhido === "outro" ? `Outro: ${valor("perfil_outro")}` : perfilEscolhido;

    const colaborador = {
      nome,
      cargo: valor("cargo"),
      setor_id: valor("setor"),
      setor: textoEscolhido("setor"),
      gestor: valor("gestor"),
      nascimento: valor("nascimento"),
      cpf: valor("cpf"),
      cep: valor("cep"),
      celular: valor("celular"),
      perfil_acesso: perfil,
      copiar_acessos_do_login: valor("copiar_acessos"),
      precisa_de: marcados("acessos"),
      observacoes: valor("observacoes"),
    };

    return {
      ...base,
      titulo: `${titulo} · ${nome}`,
      descricao: descricaoEmLinhas(titulo, [
        ["Nome", colaborador.nome],
        ["Cargo", colaborador.cargo],
        ["Setor", colaborador.setor],
        ["Gestor responsável", colaborador.gestor],
        ["Data de nascimento", dataLegivel(colaborador.nascimento)],
        ["CPF", colaborador.cpf],
        ["CEP", colaborador.cep],
        ["Celular", colaborador.celular],
        ["Perfil de acesso (ERP)", colaborador.perfil_acesso],
        ["Copiar acessos do login", colaborador.copiar_acessos_do_login],
        ["Precisa de", colaborador.precisa_de.join(", ") || "Nenhum marcado"],
        ["Observações", colaborador.observacoes],
      ]),
      categoria_id: categoriaDoTipo(tipoAtual),
      dados_formulario: { origem: "abrir-chamado", tipo: "cadastro", solicitante: dadosDoSolicitante(), colaborador },
    };
  }

  const providencias = marcados("providencias");

  const colaborador = {
    nome,
    email: valor("email"),
    setor_id: valor("setor"),
    setor: textoEscolhido("setor"),
    providencias,
    // Com "Excluir e-mail" marcado o campo fica escondido: um valor digitado
    // antes de marcar não pode ir no chamado.
    repassar_emails: providencias.includes("Excluir e-mail") ? "" : valor("repassar_emails"),
    observacoes: valor("observacoes"),
  };

  return {
    ...base,
    titulo: `${titulo} · ${nome}`,
    descricao: descricaoEmLinhas(titulo, [
      ["Nome", colaborador.nome],
      ["E-mail", colaborador.email],
      ["Setor", colaborador.setor],
      ["Providências", colaborador.providencias.join(", ") || "Nenhuma marcada"],
      ["Repassar os e-mails para", colaborador.repassar_emails],
      ["Observações", colaborador.observacoes],
    ]),
    categoria_id: categoriaDoTipo(tipoAtual),
    dados_formulario: { origem: "abrir-chamado", tipo: "desligamento", solicitante: dadosDoSolicitante(), colaborador },
  };
}

/* ==========================================================================
   ENVIO
   ========================================================================== */

// Nome de arquivo sem acento, espaço ou símbolo: o Storage recusa alguns
// caracteres no caminho, e "Relatório (1).pdf" viraria erro de upload.
function nomeSeguro(nome) {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_");
}

// Sobe os anexos depois que o chamado existe: o caminho começa pelo id dele,
// que é o que a policy do bucket usa para liberar só o dono do chamado.
// Devolve quantos falharam.
async function enviarAnexos(chamadoId) {
  if (!pendentes.length) return 0;

  const inicio = Date.now();

  const enviados = await Promise.all(pendentes.map(async ({ arquivo }, indice) => {
    const caminho = `${chamadoId}/${inicio}-${indice + 1}-${nomeSeguro(arquivo.name)}`;
    const { error } = await supabase.storage
      .from("anexos")
      .upload(caminho, arquivo, { contentType: arquivo.type });

    if (error) {
      console.error("Falha ao enviar anexo:", arquivo.name, error);
      return null;
    }

    return {
      chamado_id: chamadoId,
      usuario_id: usuarioId,
      storage_path: caminho,
      nome_arquivo: arquivo.name,
    };
  }));

  const linhas = enviados.filter(Boolean);

  if (!linhas.length) return pendentes.length;

  const { error } = await supabase.from("anexos").insert(linhas);

  if (error) {
    console.error("Falha ao registrar anexos:", error);
    return pendentes.length;
  }

  return pendentes.length - linhas.length;
}

function mostrarSucesso(numero, anexosQueFalharam) {
  formulario.hidden = true;
  passoTipo.hidden = true;
  sucesso.hidden = false;

  sucessoTitulo.textContent = `Chamado #${numero} aberto`;
  sucessoTexto.textContent = anexosQueFalharam
    ? `A equipe de TI já recebeu, mas ${anexosQueFalharam} ${anexosQueFalharam === 1 ? "anexo não foi enviado" : "anexos não foram enviados"}. Você pode mandar de novo pela conversa em Minhas solicitações.`
    : "A equipe de TI já recebeu. Você acompanha e responde pela tela de Minhas solicitações.";

  window.scrollTo({ top: 0, behavior: "smooth" });
}

formulario.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  if (!tipoAtual || !validar()) return;

  if (!usuarioId || !filaDeEntradaId) {
    avisar("Não foi possível preparar o chamado. Recarregue a página e tente de novo.");
    return;
  }

  // A unidade do chamado vem do cadastro: sem ela, a equipe não sabe de onde é.
  if (!solicitante.unidadeId) {
    avisar("Seu cadastro está sem unidade. Fale com a equipe de TI para completar antes de abrir o chamado.");
    return;
  }

  botaoEnviar.disabled = true;
  botaoEnviar.textContent = pendentes.length ? "Enviando anexos…" : "Abrindo…";

  const { data: chamado, error } = await supabase
    .from("chamados")
    .insert({
      solicitante_id: usuarioId,
      fila_id: filaDeEntradaId,
      ...montarChamado(),
    })
    .select("id, numero")
    .single();

  if (error) {
    console.error("Erro ao abrir chamado:", error);
    avisar("Não foi possível abrir o chamado. Tente de novo em instantes.");
    botaoEnviar.disabled = false;
    botaoEnviar.textContent = "Abrir chamado";
    return;
  }

  const anexosQueFalharam = await enviarAnexos(chamado.id);

  botaoEnviar.disabled = false;
  botaoEnviar.textContent = "Abrir chamado";

  mostrarSucesso(chamado.numero, anexosQueFalharam);
});

//ABRIR OUTRO: tudo limpo e de volta às caixas de tipo. Os campos de quem
//está abrindo são preenchidos de novo (o reset do formulário os apagaria).
botaoOutro.addEventListener("click", () => {
  formulario.reset();
  limparPendentes();
  perfilOutro.hidden = true;
  atualizarRepassar();

  formulario.querySelectorAll(".abrir__input--erro").forEach((elemento) => marcarErro(elemento, false));
  formulario.querySelectorAll(".abrir__escolha--erro").forEach((conjunto) => conjunto.classList.remove("abrir__escolha--erro"));
  formulario.querySelectorAll("[data-solicitante]").forEach((entrada) => {
    entrada.value = solicitante[entrada.dataset.solicitante] || "Não informado no cadastro";
  });

  irPara(null);
});

// Entrou com ?tipo=... na URL (ou recarregou no meio do formulário): já abre o tipo.
const tipoInicial = tipoDaUrl();

if (tipoInicial) mostrarFormulario(tipoInicial); else mostrarTipos();

carregar();
