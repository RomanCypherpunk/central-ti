import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
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

  const { data: callerProfile, error: callerProfileError } = await caller
    .from("usuarios")
    .select("perfil,status_aprovacao,ativo")
    .eq("id", callerUser.id)
    .single();
  if (callerProfileError || callerProfile?.perfil !== "admin"
    || callerProfile.status_aprovacao !== "aprovado" || !callerProfile.ativo) {
    return reply({ erro: "Somente administradores ativos podem excluir contas." }, 403);
  }

  let body: { usuario_id?: unknown };
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 1024) return reply({ erro: "Corpo muito grande." }, 413);
    body = JSON.parse(text);
  } catch {
    return reply({ erro: "Corpo do pedido inválido." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).length !== 1 || !("usuario_id" in body)
    || typeof body.usuario_id !== "string" || !UUID.test(body.usuario_id)) {
    return reply({ erro: "Usuário inválido." }, 400);
  }
  if (body.usuario_id === callerUser.id) {
    return reply({ erro: "Não é permitido excluir a própria conta." }, 409);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: allowed, error: limitError } = await admin
    .rpc("consumir_limite_exclusao_usuario", { p_ator_id: callerUser.id });
  if (limitError) return reply({ erro: "Não foi possível validar o limite de requisições." }, 503);
  if (!allowed) return reply({ erro: "Muitas tentativas. Aguarde alguns minutos." }, 429);

  const { data: target, error: targetError } = await admin
    .from("usuarios")
    .select("id,perfil,status_aprovacao,ativo,foto_path")
    .eq("id", body.usuario_id)
    .maybeSingle();
  if (targetError) return reply({ erro: "Não foi possível consultar a conta." }, 500);
  if (!target) return reply({ erro: "Conta não encontrada." }, 404);

  if (target.perfil === "admin" && target.status_aprovacao === "aprovado" && target.ativo) {
    const { count, error } = await admin.from("usuarios")
      .select("id", { count: "exact", head: true })
      .eq("perfil", "admin").eq("status_aprovacao", "aprovado").eq("ativo", true);
    if (error) return reply({ erro: "Não foi possível validar os administradores." }, 500);
    if ((count ?? 0) <= 1) return reply({ erro: "Não é permitido excluir o último administrador ativo." }, 409);
  }

  const references = [
    ["chamados", "solicitante_id"],
    ["chamado_membros", "usuario_id"],
    ["comentarios", "autor_id"],
    ["anexos", "usuario_id"],
    ["artigos", "autor_id"],
    ["artigo_feedback", "usuario_id"],
  ] as const;
  const checks = await Promise.all(references.map(([table, column]) => admin
    .from(table).select("id", { count: "exact", head: true }).eq(column, target.id)));
  if (checks.some(({ error }) => error)) return reply({ erro: "Não foi possível verificar o histórico da conta." }, 500);
  if (checks.some(({ count }) => (count ?? 0) > 0)) {
    return reply({ erro: "Esta conta possui histórico vinculado. Desative-a para preservar chamados e registros." }, 409);
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(target.id);
  if (deleteError) return reply({ erro: "Não foi possível excluir a conta." }, 500);

  if (target.foto_path) {
    const { error } = await admin.storage.from("avatares").remove([target.foto_path]);
    if (error) console.error("account-avatar-removal-failed");
  }
  return reply({ ok: true });
});
