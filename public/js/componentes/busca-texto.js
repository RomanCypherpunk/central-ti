// BUSCA DE TEXTO EM PORTUGUES, PARA LISTAS GRANDES.
//
// A logica de "entender" a palavra e a mesma da triagem do Abrir chamado
// (abrir-chamado.js): sem acento, radical da palavra ("cancelar" acha
// "cancelamento"), prefixo enquanto digita ("impre" acha "impressora"),
// tolerancia a erro de digitacao ("impresora") e sinonimos ("pc" acha
// "computador").
//
// O que muda e a escala. A triagem compara a frase com algumas dezenas de
// artigos; Tickets finalizados pode ter ~14 mil chamados, cada um com a
// conversa inteira. Comparar cada palavra digitada com cada palavra de cada
// chamado a cada tecla travaria a tela. Por isso aqui ha um INDICE
// INVERTIDO: cada palavra do vocabulario aponta para os documentos onde
// aparece. A busca percorre o vocabulario (algumas dezenas de milhares de
// palavras distintas) uma vez por termo, e nao os documentos.

export function normalizar(texto) {
  return (texto ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

// Palavras que aparecem em quase tudo e nao ajudam a achar nada.
const PALAVRAS_VAZIAS = new Set([
  "a", "o", "as", "os", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das",
  "e", "ou", "em", "no", "na", "nos", "nas", "ao", "aos", "pelo", "pela", "por",
  "para", "pra", "com", "sem", "que", "se", "sobre", "ate", "mas", "meu", "minha",
  "seu", "sua", "eu", "ele", "ela", "voce", "vc", "esse", "essa", "este", "esta",
  "isso", "isto", "estou", "estao", "ta", "foi", "era", "tem", "tenho", "ter",
  "vai", "vou", "fica", "ficou", "nao", "sim", "ja", "so", "mais", "muito",
  "bom", "dia", "tarde", "noite", "obrigado", "obrigada", "ola", "oi",
]);

// Mesmos grupos da triagem: o que a pessoa chama de uma coisa e o chamado
// chama de outra.
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
  ["email", "emails", "outlook", "correio", "caixa-de-entrada", "assinatura"],
  ["sistema", "erp", "programa", "software", "aplicativo", "app"],
  ["nota", "nf", "nfe", "nfce", "danfe", "faturamento", "faturar", "emitir", "emissao", "fiscal"],
  ["boleto", "cobranca", "pagamento", "financeiro"],
  ["estoque", "inventario", "saldo", "produto"],
  ["caixa", "pdv", "frente", "venda", "vendas"],
  ["telefone", "ramal", "celular", "ligacao", "voip"],
  ["teams", "reuniao", "chamada"],
  ["excel", "planilha", "arquivo", "pasta", "documento"],
  ["backup", "restaurar", "recuperar", "perdi", "apagou"],
  ["erro", "falha", "bug", "problema", "alerta"],
  ["entrega", "romaneio", "carga", "expedicao", "logistica", "transporte"],
  ["orcamento", "pedido", "pre-venda", "prevenda", "proposta"],
  ["cancelar", "cancelamento", "cancelado", "excluir", "estornar", "estorno"],
  ["retornar", "retorno", "devolucao", "devolver", "troca", "trocar"],
];

// Terminacao maior primeiro, e so corta se sobrarem 4 letras ("mento" nao
// come "momento"). Mesma lista da triagem.
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

export function radical(palavra) {
  for (const fim of TERMINACOES) {
    if (palavra.length - fim.length >= 4 && palavra.endsWith(fim)) {
      return palavra.slice(0, -fim.length);
    }
  }

  return palavra;
}

// Quantas letras teriam que mudar para uma palavra virar a outra.
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

const IRMAS_DA_PALAVRA = new Map();

GRUPOS_DE_SINONIMOS.forEach((grupo) => {
  grupo.forEach((palavra) => {
    [palavra, radical(palavra)].forEach((chave) => {
      const irmas = IRMAS_DA_PALAVRA.get(chave) ?? new Set();

      grupo.forEach((outra) => { if (outra !== palavra) irmas.add(outra); });
      IRMAS_DA_PALAVRA.set(chave, irmas);
    });
  });
});

// Palavras de um texto, como o indice e a busca enxergam. Numeros entram
// de qualquer tamanho (numero de ticket, ramal); letras, a partir de 2.
export function palavrasDe(texto) {
  return normalizar(texto)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((palavra) => (/^\d+$/.test(palavra) ? true : palavra.length >= 2 && !PALAVRAS_VAZIAS.has(palavra)));
}

// O quanto a palavra do vocabulario serve para o termo digitado.
function semelhanca(termo, raizTermo, palavra, raizPalavra) {
  if (termo === palavra) return 1;

  // Enquanto digita: "impre" ja acha "impressora". A partir de 3 letras,
  // senao "a" acharia meio vocabulario.
  if (termo.length >= 3 && palavra.startsWith(termo)) return 0.9;
  if (palavra.length >= 4 && termo.startsWith(palavra)) return 0.85;

  if (raizTermo.length >= 4 && raizTermo === raizPalavra) return 0.85;

  const menor = Math.min(termo.length, palavra.length);
  const tolerancia = menor >= 8 ? 2 : menor >= 5 ? 1 : 0;

  if (tolerancia && distancia(termo, palavra) <= tolerancia) return 0.7;

  return 0;
}

const PESO_SINONIMO = 0.6;

export function criarIndiceDeBusca() {
  // palavra -> Map<id, maior peso de campo onde ela aparece>
  const vocabulario = new Map();
  const raizes = new Map();
  // id -> palavras do documento (para poder tirar o documento depois)
  const palavrasDoDocumento = new Map();

  function remover(id) {
    const palavras = palavrasDoDocumento.get(id);

    if (!palavras) return;

    palavras.forEach((palavra) => {
      const documentos = vocabulario.get(palavra);

      documentos?.delete(id);
      if (documentos && !documentos.size) {
        vocabulario.delete(palavra);
        raizes.delete(palavra);
      }
    });
    palavrasDoDocumento.delete(id);
  }

  // campos: [{ texto, peso }]. Indexar de novo um id substitui o anterior.
  function adicionar(id, campos) {
    remover(id);

    const doDocumento = new Set();

    campos.forEach(({ texto, peso }) => {
      palavrasDe(texto).forEach((palavra) => {
        let documentos = vocabulario.get(palavra);

        if (!documentos) {
          documentos = new Map();
          vocabulario.set(palavra, documentos);
          raizes.set(palavra, radical(palavra));
        }

        if ((documentos.get(id) ?? 0) < peso) documentos.set(id, peso);
        doDocumento.add(palavra);
      });
    });

    palavrasDoDocumento.set(id, doDocumento);
  }

  // Cada termo vira um mapa id -> pontos, e as palavras do vocabulario que
  // o atenderam (para destacar na tela).
  function pontuarTermo(termo) {
    const pontos = new Map();
    const achadas = new Set();

    function somar(palavra, fator) {
      vocabulario.get(palavra)?.forEach((peso, id) => {
        const valor = peso * fator;

        if ((pontos.get(id) ?? 0) < valor) pontos.set(id, valor);
      });
      achadas.add(palavra);
    }

    // Numero: so igual. "12" nao pode achar o ramal 1234 nem o ticket 120.
    if (/^\d+$/.test(termo)) {
      if (vocabulario.has(termo)) somar(termo, 1);
      return { pontos, achadas };
    }

    const raizTermo = radical(termo);

    vocabulario.forEach((_documentos, palavra) => {
      const s = semelhanca(termo, raizTermo, palavra, raizes.get(palavra));

      if (s) somar(palavra, s);
    });

    // SINONIMO SO COMO PLANO B. Num historico, precisao vale mais que
    // alcance: quem procura "roteador" quer o chamado do roteador, nao os
    // milhares que falam de "rede" e "internet" (testado: 2.814 resultados
    // em 5 mil). Se a palavra digitada nao aparece em lugar nenhum, ai sim
    // os sinonimos entram — "pc" acha "computador".
    // Valem menos que a palavra escrita, e so por igualdade ou radical:
    // sinonimo com erro de digitacao seria chute demais.
    if (pontos.size) return { pontos, achadas };

    const irmas = IRMAS_DA_PALAVRA.get(termo) ?? IRMAS_DA_PALAVRA.get(raizTermo);

    irmas?.forEach((irma) => {
      if (vocabulario.has(irma)) somar(irma, PESO_SINONIMO);

      const raizIrma = radical(irma);

      vocabulario.forEach((_documentos, palavra) => {
        if (raizIrma.length >= 4 && raizes.get(palavra) === raizIrma && palavra !== irma) {
          somar(palavra, PESO_SINONIMO * 0.9);
        }
      });
    });

    return { pontos, achadas };
  }

  // Devolve { ids: Map<id, pontos>, achadas: Set, aproximado }.
  // Todos os termos precisam aparecer (E). Se nenhum documento tem todos,
  // cai para "qualquer termo" (OU) e marca como aproximado — melhor mostrar
  // o que chega perto do que uma lista vazia.
  function buscar(consulta) {
    const termos = [...new Set(palavrasDe(consulta))];
    const achadas = new Set();

    if (!termos.length) return { ids: null, achadas, aproximado: false, termos };

    const porTermo = termos.map((termo) => {
      const resultado = pontuarTermo(termo);

      resultado.achadas.forEach((palavra) => achadas.add(palavra));
      return resultado.pontos;
    });

    const todos = new Map();

    porTermo[0].forEach((valor, id) => {
      if (porTermo.every((mapa) => mapa.has(id))) {
        todos.set(id, porTermo.reduce((soma, mapa) => soma + mapa.get(id), 0));
      }
    });

    if (todos.size) return { ids: todos, achadas, aproximado: false, termos };

    const algum = new Map();

    porTermo.forEach((mapa) => {
      mapa.forEach((valor, id) => algum.set(id, (algum.get(id) ?? 0) + valor));
    });

    return { ids: algum, achadas, aproximado: algum.size > 0, termos };
  }

  return { adicionar, remover, buscar, tem: (id) => palavrasDoDocumento.has(id) };
}

// Monta o texto com as palavras achadas destacadas em <mark>. Sempre por
// nos de texto: o conteudo vem de chamado (digitado por usuario), entao
// nunca pode passar por innerHTML.
export function destacar(elemento, texto, achadas) {
  elemento.replaceChildren();

  if (!achadas?.size) {
    elemento.textContent = texto;
    return;
  }

  const padrao = /[\p{L}\p{N}]+/gu;
  let ultimo = 0;
  let pedaco;

  while ((pedaco = padrao.exec(texto))) {
    if (!achadas.has(normalizar(pedaco[0]))) continue;

    if (pedaco.index > ultimo) elemento.append(texto.slice(ultimo, pedaco.index));

    const marca = document.createElement("mark");
    marca.textContent = pedaco[0];
    elemento.append(marca);
    ultimo = pedaco.index + pedaco[0].length;
  }

  if (ultimo < texto.length) elemento.append(texto.slice(ultimo));
}

// Um pedaco do texto em volta da primeira palavra achada, para mostrar por
// que aquele chamado apareceu ("…a impressora do caixa 2 parou…").
export function trechoEmVolta(texto, achadas, folga = 70) {
  if (!texto || !achadas?.size) return null;

  const padrao = /[\p{L}\p{N}]+/gu;
  let pedaco;

  while ((pedaco = padrao.exec(texto))) {
    if (!achadas.has(normalizar(pedaco[0]))) continue;

    const inicio = Math.max(0, pedaco.index - folga);
    const fim = Math.min(texto.length, pedaco.index + pedaco[0].length + folga);
    const miolo = texto.slice(inicio, fim).replace(/\s+/g, " ").trim();

    return `${inicio > 0 ? "…" : ""}${miolo}${fim < texto.length ? "…" : ""}`;
  }

  return null;
}
