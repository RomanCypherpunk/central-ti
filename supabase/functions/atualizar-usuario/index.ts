import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILES = ["solicitante", "contribuinte", "analista", "admin"];
const STATUSES = ["pendente", "aprovado", "rejeitado"];
// ORIGEM PERMITIDA: por padrao "*", como era. Definindo o segredo
// ALLOWED_ORIGIN (ex.: https://ti-gasometromadeiras.vercel.app) o navegador
// passa a recusar chamadas vindas de outro site. Nao e a protecao principal
// — quem protege e o token no cabecalho Authorization, que outro site nao
// tem —, e sim uma tranca a mais.
const ORIGEM_PERMITIDA = Deno.env.get("ALLOWED_ORIGIN")?.trim() || "*";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ORIGEM_PERMITIDA,
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "600",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") return reply({ erro: "Método não permitido." }, 405);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") {
    return reply({ erro: "Tipo de conteúdo não suportado." }, 415);
  }
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization) return reply({ erro: "Não autenticado." }, 401);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user: callerUser }, error: callerError } = await caller.auth.getUser();
  if (callerError || !callerUser) return reply({ erro: "Não autenticado." }, 401);
  const { data: callerProfile, error: callerProfileError } = await caller.from("usuarios")
    .select("perfil,status_aprovacao,ativo").eq("id", callerUser.id).single();
  if (callerProfileError || callerProfile?.perfil !== "admin"
    || callerProfile.status_aprovacao !== "aprovado" || !callerProfile.ativo) {
    return reply({ erro: "Somente administradores ativos podem alterar contas." }, 403);
  }

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 4096) return reply({ erro: "Corpo muito grande." }, 413);
    body = JSON.parse(text);
  } catch { return reply({ erro: "Corpo do pedido inválido." }, 400); }
  const expected = ["ativo", "email", "nome", "perfil", "setor_id", "sobrenome", "status_aprovacao", "unidade_id", "usuario_id"];
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).sort().join(",") !== expected.join(",")
    || typeof body.usuario_id !== "string" || !UUID.test(body.usuario_id)
    || typeof body.nome !== "string" || !body.nome.trim() || body.nome.trim().length > 100
    || typeof body.sobrenome !== "string" || body.sobrenome.trim().length > 100
    || typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)
    || typeof body.ativo !== "boolean" || typeof body.perfil !== "string" || !PROFILES.includes(body.perfil)
    || typeof body.status_aprovacao !== "string" || !STATUSES.includes(body.status_aprovacao)
    || !(body.setor_id === null || (typeof body.setor_id === "string" && UUID.test(body.setor_id)))
    || !(body.unidade_id === null || (typeof body.unidade_id === "string" && UUID.test(body.unidade_id)))) {
    return reply({ erro: "Dados da conta inválidos." }, 400);
  }
  if (body.usuario_id === callerUser.id && body.ativo === false) {
    return reply({ erro: "Não é permitido desativar a própria conta." }, 409);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: target, error: targetError } = await admin.from("usuarios")
    .select("id,ativo,perfil,status_aprovacao").eq("id", body.usuario_id).maybeSingle();
  if (targetError) return reply({ erro: "Não foi possível consultar a conta." }, 500);
  if (!target) return reply({ erro: "Conta não encontrada." }, 404);
  if (target.perfil === "admin" && target.status_aprovacao === "aprovado" && target.ativo && body.ativo === false) {
    const { count, error } = await admin.from("usuarios").select("id", { count: "exact", head: true })
      .eq("perfil", "admin").eq("status_aprovacao", "aprovado").eq("ativo", true);
    if (error) return reply({ erro: "Não foi possível validar os administradores." }, 500);
    if ((count ?? 0) <= 1) return reply({ erro: "Não é permitido desativar o último administrador ativo." }, 409);
  }

  if (target.ativo !== body.ativo) {
    const { error } = await admin.auth.admin.updateUserById(target.id, {
      ban_duration: body.ativo ? "none" : "876000h",
    });
    if (error) return reply({ erro: "Não foi possível atualizar o acesso de login." }, 500);
  }
  const changes = {
    nome: body.nome.trim(), sobrenome: body.sobrenome.trim() || null,
    email: body.email.trim(), setor_id: body.setor_id, unidade_id: body.unidade_id,
    perfil: body.perfil, status_aprovacao: body.status_aprovacao, ativo: body.ativo,
  };
  const { data: updated, error: updateError } = await admin.from("usuarios").update(changes).eq("id", target.id)
    .select("id,nome,sobrenome,email,setor_id,unidade_id,perfil,ativo,status_aprovacao,foto_path").single();
  if (updateError || !updated) {
    if (target.ativo !== body.ativo) {
      await admin.auth.admin.updateUserById(target.id, { ban_duration: target.ativo ? "none" : "876000h" });
    }
    return reply({ erro: "Não foi possível salvar a conta." }, 500);
  }
  if (!body.ativo) {
    const { error } = await admin.auth.admin.signOut(target.id, "global");
    if (error) console.error("account-session-revocation-failed");
  }
  return reply({ usuario: updated });
});
