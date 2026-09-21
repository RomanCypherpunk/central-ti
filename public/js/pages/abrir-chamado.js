// Abrir chamado.
//
// Porta de entrada do "Novo chamado" da home.
//
// Escolher o tipo — cadastro de colaborador, desligamento de colaborador ou
// suporte TI — e preencher o formulário daquele tipo. O suporte tem um passo
// a mais no meio: a triagem, onde a Base de Soluções tenta resolver antes de
// virar chamado (cadastro e desligamento não passam por ela — não há solução
// pronta para procurar). O passo vai na URL (?tipo=suporte&passo=triagem),
// então o voltar do navegador refaz o caminho.
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
import { prepararArquivoParaUpload, validarArquivoParaUpload } from "../componentes/otimizar-upload.js";

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

//TRIAGEM (so no suporte TI)
const passoTriagem = document.querySelector("[data-passo-triagem]");
const triagemIcone = document.querySelector("[data-triagem-icone]");
const campoTriagem = document.querySelector("[data-triagem-texto]");
const triagemDica = document.querySelector("[data-triagem-dica]");
const resultadoTriagem = document.querySelector("[data-triagem-resultado]");
const triagemTitulo = document.querySelector("[data-triagem-titulo]");
const triagemAjuda = document.querySelector("[data-triagem-ajuda]");
const triagemLista = document.querySelector("[data-triagem-lista]");
const botaoTriagemChamado = document.querySelector("[data-triagem-chamado]");
const botaoTriagemTexto = document.querySelector("[data-triagem-chamado-texto]");

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
let solicitante = { nome: "", email: "", setor: "", unidade: "", unidadeId: null, setorId: null };

// Último acesso remoto que esta pessoa informou em um chamado anterior.
// Guardado aqui (e não só escrito no campo) porque o formulario.reset() do
// "Abrir outro chamado" apagaria o valor — mesma razão pela qual os campos
// de quem está abrindo são repreenchidos depois do reset.
let acessoRemotoSalvo = "";

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

/*CONTADOR DE CARACTERES: o maxlength sozinho trava o campo sem explicar por
  que parou de aceitar texto. O contador mostra quanto ainda cabe antes de a
  pessoa esbarrar no limite. So aparece em quem tem [data-contador] — os
  campos curtos (CPF, CEP, telefone) ja tem mascara e nao precisam.*/
formulario.querySelectorAll("[data-contador][maxlength]").forEach((entrada) => {
  const limite = Number(entrada.getAttribute("maxlength"));
  const marcador = document.createElement("span");

  marcador.className = "abrir__contador";
  entrada.insertAdjacentElement("afterend", marcador);

  const atualizar = () => {
    marcador.textContent = `${entrada.value.length}/${limite}`;
    marcador.classList.toggle("abrir__contador--cheio", entrada.value.length >= limite);
  };

  entrada.addEventListener("input", atualizar);
  atualizar();
});

// Editou o acesso remoto herdado? A dica ("veio do seu último chamado")
// deixa de valer — o valor agora é o que a pessoa acabou de digitar.
formulario.querySelector('[data-campo="acesso_remoto"]')?.addEventListener("input", () => {
  const dica = document.querySelector("[data-acesso-remoto-dica]");

  if (dica) dica.hidden = true;
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
   PASSOS: CAIXAS DE TIPO -> TRIAGEM (so suporte) -> FORMULARIO
   ========================================================================== */

function mostrarTipos() {
  tipoAtual = null;
  passoTipo.hidden = false;
  passoTriagem.hidden = true;
  formulario.hidden = true;
  sucesso.hidden = true;
  avisar("");

  window.scrollTo({ top: 0, behavior: "instant" });
}

//TRIAGEM: só o suporte passa por ela. A pessoa escreve o que precisa, a
//Base de Soluções tenta resolver na hora e o chamado só fica liberado
//depois dessa tentativa.
function mostrarTriagem() {
  tipoAtual = "suporte";

  triagemIcone.innerHTML = passoTipo.querySelector("[data-icone-tipo=suporte]").innerHTML;

  passoTipo.hidden = true;
  formulario.hidden = true;
  sucesso.hidden = true;
  passoTriagem.hidden = false;

  window.scrollTo({ top: 0, behavior: "instant" });
  campoTriagem.focus({ preventScroll: true });

  // Adianta a leitura da base enquanto a pessoa escreve.
  carregarArtigos();
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
  passoTriagem.hidden = true;
  sucesso.hidden = true;
  formulario.hidden = false;
  avisar("");

  // O que a pessoa escreveu na triagem já vai na descrição: ela não digita
  // duas vezes a mesma coisa. Só preenche campo vazio, para não apagar o
  // que ela mesma escreveu ao voltar para a triagem e vir de novo.
  const descricao = campo("descricao");

  if (tipo === "suporte" && textoDaTriagem && descricao && !descricao.value.trim()) {
    descricao.value = textoDaTriagem;
  }

  // Sempre abre no topo. O foco no primeiro campo não pode rolar a página
  // (sem preventScroll o navegador descia até ele).
  window.scrollTo({ top: 0, behavior: "instant" });
  grupoAtual()
    .querySelector("input:not([type=radio]):not([type=checkbox]), textarea")
    ?.focus({ preventScroll: true });
}

//O passo vive na URL (?tipo=suporte&passo=triagem), então o voltar do
//navegador refaz o caminho: formulário -> triagem -> caixas de tipo.
function passoDaUrl() {
  const parametros = new URLSearchParams(window.location.search);
  const tipo = parametros.get("tipo");

  if (!Object.hasOwn(TIPOS, tipo ?? "")) return { tipo: null, triagem: false };

  return { tipo, triagem: parametros.get("passo") === "triagem" };
}

// O voltar do navegador não deve devolver a rolagem antiga: cada passo
// começa no topo.
if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";

function aplicarPasso(tipo, triagem) {
  if (!tipo) mostrarTipos();
  else if (triagem) mostrarTriagem();
  else mostrarFormulario(tipo);
}

function irPara(tipo, { triagem = false } = {}) {
  const endereco = tipo
    ? `?tipo=${tipo}${triagem ? "&passo=triagem" : ""}`
    : window.location.pathname;

  window.history.pushState({ tipo, triagem }, "", endereco);
  aplicarPasso(tipo, triagem);
}

window.addEventListener("popstate", () => {
  const { tipo, triagem } = passoDaUrl();

  aplicarPasso(tipo, triagem);
});

passoTipo.querySelectorAll("[data-escolher-tipo]").forEach((caixa) => {
  const tipo = caixa.dataset.escolherTipo;

  // Suporte passa pela triagem; cadastro e desligamento vão direto ao
  // formulário — não há solução pronta para procurar, o pedido é sempre
  // trabalho da equipe.
  caixa.addEventListener("click", () => irPara(tipo, { triagem: tipo === "suporte" }));
});

// "Voltar" no formulário do suporte devolve a triagem (a pessoa pode rever
// as soluções); nos outros casos, e na própria triagem, volta às caixas.
document.querySelectorAll("[data-trocar-tipo]").forEach((botao) => {
  const naTriagem = Boolean(botao.closest("[data-passo-triagem]"));

  botao.addEventListener("click", () => {
    if (!naTriagem && tipoAtual === "suporte") irPara("suporte", { triagem: true });
    else irPara(null);
  });
});

/* ==========================================================================
   TRIAGEM: A BASE DE SOLUCOES ANTES DO CHAMADO
   ==========================================================================

   A busca roda enquanto a pessoa escreve, aqui no navegador. Os artigos são
   lidos uma vez (são poucos; a Base de Soluções carrega todos do mesmo
   jeito) e o RLS já limita ao que ela pode ver.

   Ninguém escreve igual ao título do artigo, então comparar texto com texto
   acharia quase nada. A busca tenta entender o pedido em quatro camadas:

   1. Tira o ruído: acento, pontuação e palavras que não dizem nada
      ("preciso", "de", "não está").
   2. Entende sinônimos do dia a dia: "pc", "máquina" e "computador" são a
      mesma coisa; "travando" e "lento" também.
   3. Aceita plural e erro de digitação: "impressoras" acha "impressora",
      "impresora" também.
   4. Cobra abrangência: achar 1 palavra de 6 não é achar a solução. Quanto
      maior a parte do pedido que o artigo cobre, mais alto ele fica — e o
      que cobre pouco nem aparece, para não recomendar qualquer coisa.
   ========================================================================== */

let artigos = null;
let lendoArtigos = null;
//Por que a busca nao achou nada: fica visivel na tela quando da zero. Sem
//isso, "nao encontrei nada" tanto podia ser pedido sem solucao quanto base
//vazia, erro de permissao ou coluna faltando — e nao havia como saber qual.
let erroDaBase = "";
//Administrador ve a base inteira na triagem; os demais perfis, so o setor
//deles. Vem do mesmo cadastro que o topo e os guards ja leram.
let souAdmin = false;
let textoDaTriagem = "";
let esperaBusca = null;

// Menos que isso ainda não é um pedido: "impressora" tem 10, "pc lento" 8.
const MINIMO_PARA_BUSCAR = 6;

function carregarArtigos() {
  if (artigos) return Promise.resolve(artigos);
  if (lendoArtigos) return lendoArtigos;

  lendoArtigos = supabase
    .from("artigos")
    .select("id, titulo, conteudo, tipo, codigo_erro, modulo, sintomas, passos, anexos, setores")
    .eq("ativo", true)
    .then(({ data, error }) => {
      lendoArtigos = null;

      if (error) {
        console.warn("Triagem: não foi possível ler a base de soluções.", error);
        erroDaBase = error.message ?? "erro ao ler a base";
        return [];
      }

      erroDaBase = "";

      artigos = data ?? [];

      return artigos;
    });

  return lendoArtigos;
}

function normalizar(texto) {
  return (texto ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

//PALAVRAS QUE NAO AJUDAM A ACHAR NADA. Aparecem em quase todo pedido
//("preciso que", "nao esta funcionando") e, se contassem, empurrariam para
//cima qualquer artigo comprido.
const PALAVRAS_VAZIAS = new Set([
  "a", "o", "as", "os", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das",
  "e", "ou", "em", "no", "na", "nos", "nas", "ao", "aos", "pelo", "pela", "por",
  "para", "pra", "com", "sem", "que", "se", "sobre", "ate", "desde", "mas",
  "meu", "minha", "meus", "minhas", "seu", "sua", "nosso", "nossa", "dele", "dela",
  "eu", "ele", "ela", "voce", "vc", "vcs", "nos", "aqui", "ali", "la", "esse", "essa",
  "este", "esta", "isso", "isto", "aquele", "aquela",
  "estou", "esta", "estao", "ta", "to", "tao", "sou", "somos", "foi", "era",
  "tem", "tenho", "temos", "ter", "tinha", "vai", "vou", "fica", "ficou",
  "fazer", "faz", "fiz", "quero", "queria", "preciso", "precisa", "precisava",
  "pode", "posso", "podia", "consigo", "consegue", "deu", "dar", "acontece",
  "muito", "mais", "menos", "ja", "so", "ainda", "sempre", "nunca", "agora",
  "hoje", "ontem", "amanha", "depois", "antes", "quando", "onde", "como", "qual",
  "quais", "porque", "por que", "favor", "ajuda", "urgente", "bom", "dia", "tarde", "noite",
  "nao", "sim", "todos", "toda", "todo", "outra", "outro", "coisa", "algo", "alguem",
]);

//O QUE A PESSOA CHAMA DE UMA COISA E O ARTIGO CHAMA DE OUTRA. Cada linha é
//um grupo: qualquer palavra do grupo também procura pelas irmãs, valendo um
//pouco menos que a palavra escrita.
const GRUPOS_DE_SINONIMOS = [
  ["computador", "pc", "maquina", "desktop", "notebook", "note", "cpu", "gabinete"],
  ["monitor", "tela", "display"],
  ["teclado", "teclas", "tecla"],
  ["mouse", "cursor"],
  ["impressora", "imprimir", "impressao", "impresso", "cupom", "bobina", "etiqueta", "toner", "cartucho"],
  ["internet", "rede", "wifi", "conexao", "conectar", "cabo", "sinal", "roteador", "offline"],
  ["lento", "lentidao", "travando", "travou", "travado", "demorando", "demora", "devagar", "congelando", "lerdo"],
  ["parado", "caiu", "fora", "indisponivel", "inoperante", "sumiu", "desligou"],
  ["senha", "password", "login", "logar", "acesso", "acessar", "bloqueado", "bloqueio", "desbloquear", "resetar", "redefinir", "expirou", "usuario"],
  ["email", "emails", "outlook", "correio", "mensagem", "caixa-de-entrada", "assinatura"],
  ["sistema", "erp", "nl", "programa", "software", "aplicativo", "app"],
  ["nota", "nf", "nfe", "nfce", "danfe", "faturamento", "faturar", "emitir", "emissao", "fiscal"],
  ["boleto", "cobranca", "titulo", "pagamento", "financeiro"],
  ["estoque", "inventario", "saldo", "produto", "cadastro"],
  ["caixa", "pdv", "frente", "venda", "vendas", "cliente", "atendimento"],
  ["telefone", "ramal", "celular", "ligacao", "voip"],
  ["teams", "reuniao", "chamada", "video"],
  ["excel", "planilha", "arquivo", "pasta", "documento"],
  ["backup", "restaurar", "recuperar", "perdi", "apagou", "sumido"],
  ["erro", "falha", "bug", "problema", "mensagem", "alerta", "codigo"],
  ["entrega", "romaneio", "carga", "expedicao", "logistica", "transporte"],
  ["orcamento", "pedido", "pre-venda", "prevenda", "proposta"],
  ["cancelar", "cancelamento", "cancelado", "excluir", "estornar", "estorno"],
  ["retornar", "retorno", "devolucao", "devolver", "troca", "trocar", "reverter"],
];

//O mapa é montado depois de `radical` existir (mais abaixo), então fica numa
//função chamada uma vez, na primeira busca.
const IRMAS_DA_PALAVRA = new Map();

function montarSinonimos() {
  if (IRMAS_DA_PALAVRA.size) return;

  GRUPOS_DE_SINONIMOS.forEach((grupo) => {
    grupo.forEach((palavra) => {
      // Guardado pela palavra e pelo radical dela: quem escrever "devolvendo"
      // também cai no grupo de "devolver".
      [palavra, radical(palavra)].forEach((chave) => {
        const irmas = IRMAS_DA_PALAVRA.get(chave) ?? new Set();

        grupo.forEach((outra) => { if (outra !== palavra) irmas.add(outra); });
        IRMAS_DA_PALAVRA.set(chave, irmas);
      });
    });
  });
}

function palavrasDe(texto) {
  return normalizar(texto)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((palavra) => palavra.length >= 3 && !PALAVRAS_VAZIAS.has(palavra));
}

//DISTANCIA DE EDICAO: quantas letras teriam que mudar para uma palavra virar
//a outra. É o que faz "impresora" achar "impressora".
function distancia(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;

  let linha = [...Array(b.length + 1).keys()];

  for (let i = 1; i <= a.length; i += 1) {
    const nova = [i];

    for (let j = 1; j <= b.length; j += 1) {
      nova[j] = a[i - 1] === b[j - 1]
        ? linha[j - 1]
        : 1 + Math.min(linha[j - 1], linha[j], nova[j - 1]);
    }

    linha = nova;
  }

  return linha[b.length];
}

//RADICAL DA PALAVRA: corta a terminação e deixa o miolo, que é onde mora o
//sentido. Quem pede escreve o verbo ("cancelar um pedido"); quem cadastrou a
//solução escreveu o substantivo ("Cancelamento de pedido"). Sem isto as duas
//palavras não se encontravam de jeito nenhum — nem por prefixo, nem por
//distância de letras — e a solução certa ficava invisível.
//
//A ordem da lista importa: terminação maior primeiro, senão "cancelamento"
//perderia só o "o" e viraria "cancelament". O corte só vale se sobrarem 4
//letras, para "mento" não comer "momento".
const TERMINACOES = [
  "issimos", "issimas", "issimo", "issima",
  "amentos", "imentos", "amento", "imento",
  "acoes", "icoes", "coes", "acao", "icao", "cao",
  "adores", "adoras", "ador", "adora",
  "izacao", "izar", "izado",
  "antes", "ante", "ancia", "ancias",
  "eiros", "eiras", "eiro", "eira",
  "aveis", "iveis", "avel", "ivel",
  "mente",
  "ados", "adas", "idos", "idas", "ado", "ada", "ido", "ida",
  "ando", "endo", "indo",
  "aram", "eram", "iram", "aria", "eria", "iria",
  "amos", "emos", "imos",
  "ar", "er", "ir", "as", "es", "os", "a", "e", "o", "s",
];

function radical(palavra) {
  for (const fim of TERMINACOES) {
    if (palavra.length - fim.length >= 4 && palavra.endsWith(fim)) {
      return palavra.slice(0, -fim.length);
    }
  }

  return palavra;
}

//O QUANTO DUAS PALAVRAS SAO A MESMA COISA: 1 igual, menos que isso conforme
//a semelhança. O radical cobre a família da palavra (cancelar, cancelamento,
//cancelado); o prefixo cobre plural e conjugação ("impressoras", "travando");
//a distância cobre o erro de digitação.
function semelhanca(escrita, doArtigo) {
  if (escrita === doArtigo) return 1;

  const menor = Math.min(escrita.length, doArtigo.length);

  if (menor >= 4 && (escrita.startsWith(doArtigo) || doArtigo.startsWith(escrita))) return 0.9;

  const raizEscrita = radical(escrita);
  const raizDoArtigo = radical(doArtigo);

  if (raizEscrita.length >= 4 && raizEscrita === raizDoArtigo) return 0.85;

  const tolerancia = menor >= 8 ? 2 : menor >= 5 ? 1 : 0;

  if (tolerancia && distancia(escrita, doArtigo) <= tolerancia) return 0.75;

  return 0;
}

//ONDE A PALAVRA APARECE MUDA O PESO: no título é do que o artigo trata; no
//conteúdo pode ser um detalhe de passagem.
const PESO_DOS_CAMPOS = [
  { campo: "titulo", peso: 3 },
  { campo: "codigo", peso: 3 },
  { campo: "sintomas", peso: 2.5 },
  { campo: "modulo", peso: 1.5 },
  { campo: "conteudo", peso: 1.2 },
];

//O artigo pronto para comparar: cada campo virando lista de palavras. Feito
//uma vez por artigo, não a cada tecla.
function prepararArtigo(artigo) {
  if (artigo.__palavras) return artigo;

  artigo.__palavras = {
    titulo: palavrasDe(artigo.titulo),
    conteudo: palavrasDe([
      artigo.conteudo,
      // O passo a passo e onde mora o vocabulario de quem faz: "F5", "aba
      // fiscal", "reiniciar o servico". Fora do indice, uma busca que
      // usasse essas palavras nao achava a solucao que as ensina.
      ...(artigo.passos ?? []).map((passo) => passo?.texto ?? ""),
    ].filter(Boolean).join(" ")),
    sintomas: palavrasDe((artigo.sintomas ?? []).join(" ")),
    modulo: palavrasDe(artigo.modulo),
    codigo: palavrasDe(artigo.codigo_erro),
  };
  artigo.__titulo = normalizar(artigo.titulo);

  return artigo;
}

//A melhor nota que uma palavra escrita tira num artigo, olhando campo a
//campo. As irmãs de sinônimo entram valendo 70%: acertar a palavra que a
//pessoa usou vale mais do que acertar a prima dela.
function notaDaPalavra(palavra, preparado) {
  const tentativas = [{ termo: palavra, ajuste: 1 }];
  const irmas = IRMAS_DA_PALAVRA.get(palavra) ?? IRMAS_DA_PALAVRA.get(radical(palavra)) ?? [];

  irmas.forEach((irma) => {
    tentativas.push({ termo: irma, ajuste: 0.7 });
  });

  let melhor = 0;

  PESO_DOS_CAMPOS.forEach(({ campo, peso }) => {
    preparado.__palavras[campo].forEach((doArtigo) => {
      tentativas.forEach(({ termo, ajuste }) => {
        const nota = semelhanca(termo, doArtigo) * peso * ajuste;

        if (nota > melhor) melhor = nota;
      });
    });
  });

  return melhor;
}

function pontuar(artigo, palavras, textoInteiro) {
  const preparado = prepararArtigo(artigo);

  let soma = 0;
  let acertos = 0;

  palavras.forEach((palavra) => {
    const nota = notaDaPalavra(palavra, preparado);

    if (nota > 0) acertos += 1;
    soma += nota;
  });

  if (!acertos) return 0;

  // COBERTURA: de quantas palavras do pedido o artigo dá conta. Um artigo
  // que responde a 4 de 5 palavras está falando do mesmo assunto; um que
  // responde a 1 de 5 provavelmente só repete uma palavra comum.
  const cobertura = acertos / palavras.length;

  // Quanto mais a pessoa escreve, mais palavras soltas entram no pedido
  // ("do caixa 2", "desde ontem", "do pedido 4471") — e nenhuma solução vai
  // cobrir todas. Por isso a exigência não é uma fração fixa: pedido curto
  // precisa casar quase tudo; pedido longo precisa casar pelo menos duas
  // palavras e um terço do que foi escrito. Sem isso, frase comprida (que é
  // como as pessoas escrevem de verdade) nunca achava nada.
  const minimoDeAcertos = palavras.length <= 2
    ? palavras.length
    : Math.max(2, Math.ceil(palavras.length * 0.3));

  if (acertos < minimoDeAcertos) return 0;

  // O título dizer quase a mesma frase é o sinal mais forte que existe.
  const frase = preparado.__titulo.includes(textoInteiro) || textoInteiro.includes(preparado.__titulo)
    ? 6
    : 0;

  return (soma + frase) * (0.4 + 0.6 * cobertura);
}

// Abaixo disso é palpite: melhor dizer que não achou do que recomendar algo
// que não tem a ver.
const NOTA_MINIMA = 2.2;

//NADA DE OUTRO SETOR. A policy do banco ja faz isso para o solicitante
//comum, mas a equipe de TI e o autor enxergam a base inteira — e recomendar
//aqui uma solucao de outro setor seria mandar a pessoa mexer no que nao e o
//trabalho dela.
//
//Solucao SEM setor marcado vale para todos: a coluna `setores` nasceu depois
//da base (migration 20260914120000), entao tudo que foi cadastrado antes
//ficou com a lista vazia. Exigir o setor na lista derrubava justamente as
//solucoes mais antigas, que sao a maioria — a triagem respondia "nao
//encontrei nada" para qualquer busca.
function doMeuSetor(artigo) {
  // ADMINISTRADOR VE A BASE INTEIRA: e quem cadastra e mantem as solucoes,
  // e atende chamado de qualquer setor. A regra de setor existe para nao
  // mandar quem e de Vendas mexer no que e do Financeiro — nao se aplica a
  // quem cuida dos dois.
  if (souAdmin) return true;

  const setoresDoArtigo = artigo.setores ?? [];

  if (!setoresDoArtigo.length) return true;

  return Boolean(solicitante.setorId) && setoresDoArtigo.includes(solicitante.setorId);
}

function procurarSolucoes(texto, lista) {
  montarSinonimos();

  const palavras = [...new Set(palavrasDe(texto))];

  if (!palavras.length) return [];

  const textoInteiro = normalizar(texto).replace(/\s+/g, " ").trim();

  return lista
    .filter(doMeuSetor)
    .map((artigo) => ({ artigo, pontos: pontuar(artigo, palavras, textoInteiro) }))
    .filter((item) => item.pontos >= NOTA_MINIMA)
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, 4)
    .map((item) => item.artigo);
}

function resumoDoArtigo(artigo) {
  const texto = (artigo.conteudo ?? "").replace(/\s+/g, " ").trim();

  return texto.length > 160 ? `${texto.slice(0, 160)}…` : texto;
}

//A SOLUCAO ABRE AQUI MESMO. Sair da triagem para a Base levaria embora o
//texto que a pessoa escreveu e o caminho de volta; o passo a passo aparece
//dentro do proprio cartao, e um de cada vez, para a tela nao virar uma
//parede de texto.
function montarPassos(passos) {
  const lista = document.createElement("ol");
  lista.className = "triagem__passos";

  if (!passos?.length) {
    const vazio = document.createElement("p");
    vazio.className = "triagem__resumo";
    vazio.textContent = "Esta solução ainda não tem passo a passo cadastrado.";

    return vazio;
  }

  passos.forEach((passo) => {
    const item = document.createElement("li");

    const texto = document.createElement("p");
    texto.className = "triagem__passo-texto";
    texto.textContent = passo.texto ?? "";
    item.appendChild(texto);

    (passo.imagens ?? []).forEach((imagem) => {
      const foto = document.createElement("img");
      foto.className = "triagem__passo-imagem";
      foto.src = imagem.url ?? imagem;
      foto.alt = imagem.nome ?? "";
      foto.loading = "lazy";
      item.appendChild(foto);
    });

    lista.appendChild(item);
  });

  return lista;
}

function montarDetalhe(artigo) {
  const detalhe = document.createElement("div");
  detalhe.className = "triagem__detalhe";
  detalhe.hidden = true;

  const onde = [artigo.modulo, artigo.codigo_erro].filter(Boolean).join(" · ");

  if (onde) {
    const linha = document.createElement("p");
    linha.className = "triagem__onde";
    linha.textContent = onde;
    detalhe.appendChild(linha);
  }

  if (artigo.conteudo?.trim()) {
    const conteudo = document.createElement("p");
    conteudo.className = "triagem__conteudo";
    conteudo.textContent = artigo.conteudo.trim();
    detalhe.appendChild(conteudo);
  }

  detalhe.appendChild(montarPassos(artigo.passos));

  // Anexo é arquivo (PDF, planilha): abre fora, porque não há como mostrar
  // aqui dentro — mas é escolha da pessoa, não um desvio do caminho dela.
  if (artigo.anexos?.length) {
    const anexos = document.createElement("ul");
    anexos.className = "triagem__anexos";

    artigo.anexos.forEach((anexo) => {
      const item = document.createElement("li");
      const link = document.createElement("a");

      link.href = anexo.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = anexo.nome ?? "Anexo";
      item.appendChild(link);
      anexos.appendChild(item);
    });

    detalhe.appendChild(anexos);
  }

  return detalhe;
}

function desenharSolucoes(encontradas) {
  triagemLista.replaceChildren();

  encontradas.forEach((artigo) => {
    const item = document.createElement("li");
    item.className = "triagem__item";

    const cabecalho = document.createElement("button");
    cabecalho.type = "button";
    cabecalho.className = "triagem__solucao";
    cabecalho.setAttribute("aria-expanded", "false");

    const selo = document.createElement("span");
    selo.className = "triagem__selo";
    selo.textContent = artigo.tipo === "erro" ? "Erro" : "Procedimento";

    const titulo = document.createElement("span");
    titulo.className = "triagem__titulo";
    titulo.textContent = artigo.titulo ?? "Sem título";

    const resumo = document.createElement("span");
    resumo.className = "triagem__resumo";
    resumo.textContent = resumoDoArtigo(artigo);

    const acao = document.createElement("span");
    acao.className = "triagem__ver";
    acao.textContent = "Ver solução";

    cabecalho.append(selo, titulo, resumo, acao);

    const detalhe = montarDetalhe(artigo);

    cabecalho.addEventListener("click", () => {
      const abrindo = detalhe.hidden;

      // Uma de cada vez: abrir a segunda fecha a primeira.
      triagemLista.querySelectorAll(".triagem__detalhe").forEach((outro) => { outro.hidden = true; });
      triagemLista.querySelectorAll(".triagem__solucao").forEach((outro) => {
        outro.setAttribute("aria-expanded", "false");
        outro.querySelector(".triagem__ver").textContent = "Ver solução";
      });

      detalhe.hidden = !abrindo;
      cabecalho.setAttribute("aria-expanded", String(abrindo));
      acao.textContent = abrindo ? "Fechar solução" : "Ver solução";
      item.classList.toggle("triagem__item--aberto", abrindo);

      triagemLista.querySelectorAll(".triagem__item").forEach((outro) => {
        if (outro !== item) outro.classList.remove("triagem__item--aberto");
      });
    });

    item.append(cabecalho, detalhe);
    triagemLista.appendChild(item);
  });
}

//QUANDO DA ZERO, A TELA DIZ POR QUE. Ajuda quem usa (reescrever com outras
//palavras) e ajuda a TI a perceber base vazia ou erro de permissao, que de
//fora parecem a mesma coisa: "nao encontrei nada".
function motivoDeNaoAchar(lista) {
  if (erroDaBase) {
    return `Não consegui ler a base de soluções (${erroDaBase}). Abra o chamado que a equipe resolve.`;
  }

  if (!lista.length) return "A base de soluções não tem nenhuma solução cadastrada ainda.";

  const procuradas = lista.filter(doMeuSetor).length;

  if (!procuradas) {
    return `Nenhuma das ${lista.length} soluções da base está marcada para o seu setor.`;
  }

  // Administrador procura na base inteira, então falar em "seu setor"
  // confundiria: para ele os dois números são o mesmo.
  const onde = souAdmin
    ? `${procuradas} soluções da base`
    : `${procuradas} de ${lista.length} soluções (as do seu setor)`;

  return `Procurei nas ${onde}. Tente outras palavras ou abra o chamado.`;
}

async function buscarSolucoes() {
  const texto = campoTriagem.value.trim();

  textoDaTriagem = texto;

  // Pedido curto demais: ainda não dá para procurar nada, e o chamado
  // continua fechado — a pessoa não passou pela tentativa.
  if (texto.length < MINIMO_PARA_BUSCAR) {
    resultadoTriagem.hidden = true;
    triagemLista.replaceChildren();
    triagemDica.textContent = "Escreva com as suas palavras. Procuramos na base de soluções sozinhos.";
    return;
  }

  triagemDica.textContent = "Procurando soluções…";

  const lista = await carregarArtigos();

  // Enquanto a base carregava a pessoa continuou escrevendo: vale o último
  // texto, não este.
  if (campoTriagem.value.trim() !== texto) return;

  const encontradas = procurarSolucoes(texto, lista);

  desenharSolucoes(encontradas);

  triagemTitulo.textContent = encontradas.length
    ? "Isso pode resolver"
    : "Não encontrei nada parecido";
  triagemAjuda.textContent = encontradas.length
    ? "clique numa solução para ver o passo a passo aqui"
    : "ninguém cadastrou uma solução para isso ainda";
  triagemDica.textContent = encontradas.length
    ? "Continue escrevendo para afinar a busca."
    : motivoDeNaoAchar(lista);
  botaoTriagemTexto.textContent = encontradas.length
    ? "Nenhuma resolveu, abrir chamado"
    : "Abrir chamado para o TI";

  resultadoTriagem.hidden = false;
}

//A CADA TECLA, MAS NAO A CADA TECLA: 250ms parado é o suficiente para a
//pessoa ter terminado a palavra, e evita redesenhar a lista no meio dela.
campoTriagem.addEventListener("input", () => {
  clearTimeout(esperaBusca);
  esperaBusca = setTimeout(buscarSolucoes, 250);
});

botaoTriagemChamado.addEventListener("click", () => {
  textoDaTriagem = campoTriagem.value.trim();
  irPara("suporte");
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

// Põe o acesso remoto guardado no campo e explica de onde ele veio — sem a
// dica a pessoa estranha um IP que não digitou. A dica some se ela editar,
// porque aí o valor passa a ser dela, não herdado.
function aplicarAcessoRemotoSalvo() {
  const campo = formulario.querySelector('[data-campo="acesso_remoto"]');
  const dica = document.querySelector("[data-acesso-remoto-dica]");

  if (!campo || !acessoRemotoSalvo) return;

  campo.value = acessoRemotoSalvo;
  if (dica) dica.hidden = false;
}

async function carregar() {
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return;

  usuarioId = user.id;

  // Unidades e setores vêm inteiros (e não por junção no select do usuário):
  // servem para traduzir os ids do cadastro e, os setores, para o select do
  // colaborador.
  const [unidades, setores, listaCategorias, filas, perfil, ultimoAcesso] = await Promise.all([
    supabase.from("unidades").select("id, nome").order("nome"),
    supabase.from("setores").select("id, nome, ativo").order("nome"),
    supabase.from("categorias").select("id, nome").eq("ativo", true).order("nome"),
    supabase.from("filas").select("id, nome").eq("ativo", true).order("ordem"),
    supabase.from("usuarios").select("nome, sobrenome, email, unidade_id, setor_id, perfil, status_aprovacao, ativo").eq("id", user.id).single(),
    // ÚLTIMO ACESSO REMOTO INFORMADO por esta pessoa: quase sempre é o mesmo
    // computador, então o campo já vem preenchido em vez de exigir que ela
    // redigite o IP a cada chamado. Pega o mais recente que NÃO seja nulo —
    // abrir um chamado sem preencher não apaga o que ela já informou antes.
    supabase.from("chamados")
      .select("acesso_remoto")
      .eq("solicitante_id", user.id)
      .not("acesso_remoto", "is", null)
      .order("abertura_em", { ascending: false })
      .limit(1),
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

  //ADMINISTRADOR VE A BASE INTEIRA NA TRIAGEM; os demais perfis, so o setor
  //deles. Vem do mesmo cadastro que ja e lido aqui.
  souAdmin = perfil.data.perfil === "admin"
    && perfil.data.status_aprovacao === "aprovado"
    && Boolean(perfil.data.ativo);

  //PORTAS DE CADASTRO/DESLIGAMENTO: so quem gerencia gente (mesma lista de
  //pode_abrir_chamado_de_colaborador() no banco, que e quem realmente
  //barra — isto aqui e so pra nao oferecer um botao que a RLS ia recusar).
  const nomeDoSetorLogado = nomeDoSetor.get(perfil.data.setor_id) ?? "";
  const gerenciaGente = souAdmin || [
    "Recursos Humanos", "Líder de Logística", "Líder de Vendas", "Gestor da Unidade",
  ].includes(nomeDoSetorLogado);

  document.querySelectorAll("[data-porta-colaborador]").forEach((porta) => {
    porta.hidden = !gerenciaGente;
  });

  // Sobrou so o Suporte TI: o grid de 3 colunas deixaria a porta unica
  // esticada e colada a esquerda. .portas--unica centraliza e trava a
  // largura dela — ver o CSS em abrir-chamado.css.
  document.querySelector(".portas--tres")
    ?.classList.toggle("portas--unica", !gerenciaGente);

  //QUEM ESTA ABRINDO: do cadastro, sem poder mudar.
  solicitante = {
    nome: [perfil.data.nome, perfil.data.sobrenome].filter(Boolean).join(" "),
    email: perfil.data.email ?? user.email ?? "",
    setor: nomeDoSetor.get(perfil.data.setor_id) ?? "",
    unidade: nomeDaUnidade.get(perfil.data.unidade_id) ?? "",
    unidadeId: perfil.data.unidade_id ?? null,
    // Usado pela triagem: so recomenda solucao marcada para este setor.
    setorId: perfil.data.setor_id ?? null,
  };

  formulario.querySelectorAll("[data-solicitante]").forEach((entrada) => {
    entrada.value = solicitante[entrada.dataset.solicitante] || "Não informado no cadastro";
  });

  // De propósito fora do check de erro acima: é uma conveniência, não um
  // dado necessário para abrir chamado. Se essa consulta falhar o campo só
  // fica vazio, em vez de travar o formulário inteiro.
  acessoRemotoSalvo = ultimoAcesso.data?.[0]?.acesso_remoto ?? "";
  aplicarAcessoRemotoSalvo();

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

    try {
      validarArquivoParaUpload(arquivo);
    } catch {
      recusados.push(`${arquivo.name} (PDFs têm limite de 5 MB)`);
      return;
    }

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
//
// O corte no fim é uma rede de segurança: esta descrição é MONTADA, não
// digitada, então o tamanho final depende dos maxlength somados dos campos.
// Hoje o pior caso cabe (cadastro ~1104, desligamento ~1028), mas afrouxar um
// maxlength no HTML sem refazer essa conta faria o banco recusar o chamado —
// aqui o texto é cortado em vez de o envio falhar. Os campos vão inteiros em
// dados_formulario de qualquer forma.
const LIMITE_DESCRICAO = 1200;

function descricaoEmLinhas(titulo, linhas) {
  const texto = [
    titulo,
    "",
    ...linhas.filter(([, conteudo]) => conteudo).map(([rotulo, conteudo]) => `${rotulo}: ${conteudo}`),
  ].join("\n");

  if (texto.length <= LIMITE_DESCRICAO) return texto;

  return `${texto.slice(0, LIMITE_DESCRICAO - 1).trimEnd()}…`;
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
      // O trigger no banco prefixa o número do ticket ("#46 - Impressora com
      // erro"). Assunto em branco vira null de propósito: é o sinal para o
      // banco cair no formato com a categoria ("#46 - Pedidos: Enzo").
      titulo: assunto || null,
      descricao: valor("descricao"),
      categoria_id: valor("categoria"),
      cliente_na_loja: simNao("cliente_na_loja"),
      sistema_lento_ou_fora: simNao("sistema_lento_ou_fora"),
      // Campo vazio grava null, e não "": assim a busca pelo último acesso
      // remoto informado (is not null) ignora os chamados sem preenchimento.
      acesso_remoto: valor("acesso_remoto") || null,
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
      // Sem título: quem monta é o trigger no banco, que precisa do número do
      // ticket ("#46 - Cadastro de Colaborador: Enzo") — e o número só existe
      // depois do insert. O nome do colaborador vai em dados_formulario.
      titulo: null,
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
    titulo: null,
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
    const arquivoOtimizado = await prepararArquivoParaUpload(arquivo);
    const caminho = `${chamadoId}/${inicio}-${indice + 1}-${nomeSeguro(arquivoOtimizado.name)}`;
    const { error } = await supabase.storage
      .from("anexos")
      .upload(caminho, arquivoOtimizado, { contentType: arquivoOtimizado.type, cacheControl: "31536000" });

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

  aplicarAcessoRemotoSalvo();

  irPara(null);
});

// Entrou com ?tipo=... na URL (ou recarregou no meio da triagem/do
// formulário): já abre no passo certo.
const passoInicial = passoDaUrl();

aplicarPasso(passoInicial.tipo, passoInicial.triagem);

carregar();
