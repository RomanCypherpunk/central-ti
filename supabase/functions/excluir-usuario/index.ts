import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  const { data: callerProfile, error: callerProfileError } = await caller
    .from("usuarios")
    .select("perfil,status_aprovacao,ativo")
    .eq("id", callerUser.id)
    .single();
  if (callerProfileError || callerProfile?.perfil !== "admin"
    || callerProfile.status_aprovacao !== "aprovado" || !callerProfile.ativo) {
    return reply({ erro: "Somente administradores ativos podem excluir contas." }, 403);
  }

  let body: { usuario_id?: unknown; destino_id?: unknown };
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 1024) return reply({ erro: "Corpo muito grande." }, 413);
    body = JSON.parse(text);
  } catch {
    return reply({ erro: "Corpo do pedido inválido." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || !["usuario_id", "destino_id,usuario_id"].includes(Object.keys(body).sort().join(","))
    || typeof body.usuario_id !== "string" || !UUID.test(body.usuario_id)
    || (body.destino_id !== undefined && (typeof body.destino_id !== "string" || !UUID.test(body.destino_id)))) {
    return reply({ erro: "Usuário inválido." }, 400);
  }
  if (body.usuario_id === callerUser.id || body.usuario_id === body.destino_id) {
    return reply({ erro: "Não é permitido excluir a própria conta." }, 409);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: allowed, error: limitError } = await admin
    .rpc("consumir_limite_exclusao_usuario", { p_ator_id: callerUser.id });
  if (limitError) return reply({ erro: "Não foi possível validar o limite de requisições." }, 503);
  if (!allowed) return reply({ erro: "Muitas tentativas. Aguarde alguns minutos." }, 429);

  const { data: transfer, error: transferError } = await admin.rpc(
    "transferir_historico_e_reservar_exclusao",
    { p_ator_id: callerUser.id, p_usuario_id: body.usuario_id, p_destino_id: body.destino_id ?? null },
  );
  const result = transfer as { ok?: boolean; code?: string; foto_path?: string | null } | null;
  if (transferError) return reply({ erro: "Não foi possível transferir o histórico da conta." }, 500);
  if (!result?.ok) {
    const messages: Record<string, string> = {
      "target-not-found": "Conta não encontrada.",
      "invalid-target": "Escolha contas diferentes e não exclua a própria conta.",
      "invalid-destination": "A conta de destino precisa estar ativa e aprovada.",
      "team-destination-required": "Contas da equipe devem ser transferidas para outro analista ou administrador.",
      "last-admin": "Não é permitido excluir o último administrador ativo.",
    };
    return reply({ erro: messages[result?.code ?? ""] ?? "Não foi possível preparar a exclusão." }, 409);
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(body.usuario_id);
  if (deleteError) return reply({ erro: "Não foi possível excluir a conta." }, 500);

  if (result.foto_path) {
    const { error } = await admin.storage.from("avatares").remove([result.foto_path]);
    if (error) console.error("account-avatar-removal-failed");
  }
  return reply({ ok: true });
});
