// CRIAR USUARIO COM SENHA, PELO PAINEL — SO ADMIN.
//
// Por que isto e uma Edge Function e nao codigo em painel.js: criar uma
// conta de login (auth.users) com senha definida na hora so e possivel com
// a service_role key, que nunca pode ir para o navegador (ela ignora toda
// RLS — quem a tiver le/edita qualquer dado de qualquer usuario). A
// service_role so existe aqui dentro, no ambiente do servidor da function,
// nunca no bundle do site.
//
// Tambem resolve outro problema: se o ADMIN chamasse supabase.auth.signUp()
// no navegador (o mesmo client que ele usa para se autenticar), a sessao
// dele seria trocada pela da conta nova — ele proprio seria deslogado do
// Painel e logado como a pessoa que acabou de criar. Rodando no servidor,
// a criacao nao mexe em sessao nenhuma.
//
// Fluxo:
//   1. Confere que quem chamou esta autenticado E e admin (le o JWT do
//      pedido com um client comum, sem privilegio nenhum extra).
//   2. Cria o usuario em auth.users com o client service_role — isso
//      dispara o trigger handle_new_user(), que ja insere a linha em
//      usuarios (com dados minimos) E abre um chamado de "Aprovação de
//      Acesso" (o mesmo fluxo do autocadastro).
//   3. Atualiza usuarios com os campos que o admin escolheu no formulario
//      (setor, unidade, perfil, status_aprovacao). Se o admin ja marcar
//      status_aprovacao = 'aprovado', o trigger notificar_aprovacao_cadastro
//      (que ja existe, reage a UPDATE em usuarios) fecha sozinho o chamado
//      de aprovacao com uma nota — sem precisar de logica nova aqui para
//      isso.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CABECALHOS_CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
};

const PERFIS_VALIDOS = ["solicitante", "contribuinte", "analista", "admin"];
const STATUS_VALIDOS = ["pendente", "aprovado", "rejeitado"];

Deno.serve(async (req) => {
  const responder = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CABECALHOS_CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CABECALHOS_CORS });
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);
  if (req.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") {
    return responder({ erro: "Tipo de conteúdo não suportado." }, 415);
  }

  const autorizacao = req.headers.get("Authorization") ?? "";

  if (!autorizacao) return responder({ erro: "Não autenticado." }, 401);

  // CLIENT COMUM (chave anon): so serve para descobrir quem esta chamando,
  // a partir do token que o navegador do admin mandou. Sem privilegio
  // nenhum alem do que o proprio token ja da.
  const clienteChamador = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: autorizacao } },
  });

  const { data: { user: quemChamou }, error: erroAuth } = await clienteChamador.auth.getUser();

  if (erroAuth || !quemChamou) return responder({ erro: "Não autenticado." }, 401);

  const { data: perfilDeQuemChamou, error: erroPerfil } = await clienteChamador
    .from("usuarios")
    .select("perfil, status_aprovacao, ativo")
    .eq("id", quemChamou.id)
    .single();

  const ehAdmin = !erroPerfil
    && perfilDeQuemChamou?.perfil === "admin"
    && perfilDeQuemChamou?.status_aprovacao === "aprovado"
    && perfilDeQuemChamou?.ativo;

  // Cinturao e suspensorio: o RLS de usuarios/storage ja bloqueava um nao-
  // admin nas outras rotas, mas aqui NADA passa por RLS (service_role
  // ignora tudo) — entao a checagem manual e a UNICA linha de defesa.
  if (!ehAdmin) return responder({ erro: "Só administradores podem criar contas." }, 403);

  const clienteAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: permitido, error: erroLimite } = await clienteAdmin
    .rpc("consumir_limite_criacao_usuario", { p_ator_id: quemChamou.id });
  if (erroLimite) return responder({ erro: "Não foi possível validar o limite de requisições." }, 503);
  if (!permitido) return responder({ erro: "Muitas tentativas. Aguarde alguns minutos." }, 429);

  let corpo: {
    nome?: string; sobrenome?: string; email?: string; senha?: string;
    setor_id?: string | null; unidade_id?: string | null;
    perfil?: string; status_aprovacao?: string; ativo?: boolean;
  };

  try {
    const texto = await req.text();
    if (new TextEncoder().encode(texto).length > 16_384) return responder({ erro: "Corpo muito grande." }, 413);
    corpo = JSON.parse(texto);
  } catch {
    return responder({ erro: "Corpo do pedido inválido." }, 400);
  }

  const nome = corpo.nome?.trim();
  const email = corpo.email?.trim().toLowerCase();
  const senha = corpo.senha ?? "";
  const perfil = corpo.perfil ?? "solicitante";
  const statusAprovacao = corpo.status_aprovacao ?? "pendente";

  if (!nome || nome.length > 100) return responder({ erro: "Nome inválido." }, 400);
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return responder({ erro: "E-mail inválido." }, 400);
  if (senha.length < 8 || senha.length > 128 || !/[a-z]/.test(senha) || !/[A-Z]/.test(senha)
    || !/[0-9]/.test(senha) || !/[^A-Za-z0-9]/.test(senha)) {
    return responder({ erro: "A senha precisa ter 8 caracteres, maiúscula, minúscula, número e símbolo." }, 400);
  }
  if (corpo.sobrenome && corpo.sobrenome.trim().length > 100) return responder({ erro: "Sobrenome inválido." }, 400);
  if (corpo.setor_id && !UUID.test(corpo.setor_id)) return responder({ erro: "Setor inválido." }, 400);
  if (corpo.unidade_id && !UUID.test(corpo.unidade_id)) return responder({ erro: "Unidade inválida." }, 400);
  if (!PERFIS_VALIDOS.includes(perfil)) return responder({ erro: "Perfil inválido." }, 400);
  if (!STATUS_VALIDOS.includes(statusAprovacao)) return responder({ erro: "Status de cadastro inválido." }, 400);

  // CLIENT COM SERVICE_ROLE: a unica parte deste arquivo com privilegio
  // real. Fica isolado nesta variavel para o resto do codigo continuar
  // obvio sobre o que tem poder de ignorar RLS.
  // Dispara handle_new_user() (insere em usuarios + abre o chamado de
  // Aprovação de Acesso) — mesmo caminho do autocadastro por cadastro.html.
  const { data: criado, error: erroCriar } = await clienteAdmin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true, // Conta criada pelo admin: nao precisa confirmar e-mail.
    user_metadata: {
      nome,
      sobrenome: corpo.sobrenome?.trim() || undefined,
      setor_id: corpo.setor_id || undefined,
      unidade_id: corpo.unidade_id || undefined,
    },
  });

  if (erroCriar || !criado?.user) {
    const mensagem = erroCriar?.message?.includes("already been registered")
      ? "Já existe uma conta com este e-mail."
      : "Não foi possível criar a conta.";
    return responder({ erro: mensagem }, 400);
  }

  // AGORA OS CAMPOS QUE O ADMIN ESCOLHEU: handle_new_user() ja gravou nome/
  // sobrenome/email/unidade/setor com o que veio no metadata, mas perfil e
  // status_aprovacao nao existem la (ficam nos valores padrao da tabela) —
  // e setor/unidade podem ter sido deixados em branco no formulario, o que
  // deve limpar o que o trigger inferiu.
  const { data: usuarioFinal, error: erroAtualizar } = await clienteAdmin
    .from("usuarios")
    .update({
      setor_id: corpo.setor_id || null,
      unidade_id: corpo.unidade_id || null,
      perfil,
      status_aprovacao: statusAprovacao,
      ativo: corpo.ativo ?? true,
    })
    .eq("id", criado.user.id)
    .select("id, nome, sobrenome, email, setor_id, unidade_id, perfil, ativo, status_aprovacao, foto_path")
    .single();

  if (erroAtualizar || !usuarioFinal) {
    // Falha fechada: uma conta sem o perfil escolhido não pode ficar ativa/orfã.
    const { error: erroLimpeza } = await clienteAdmin.auth.admin.deleteUser(criado.user.id);
    if (erroLimpeza) console.error("criar-usuario: falha ao remover conta parcial");
    return responder({ erro: "Não foi possível concluir a criação da conta." }, 500);
  }

  return responder({ usuario: usuarioFinal }, 201);
});
