// Candidato auditado: copiar para supabase/functions/notificar-portal/index.ts.
// Aplicar push-hardening.sql antes do deploy. Manter verify_jwt = true.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";
import webpush from "npm:web-push@3";

const required = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Configuração ausente: ${name}`);
  return value;
};
const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
const supabaseUrl = required("SUPABASE_URL");
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const db = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
webpush.setVapidDetails(required("VAPID_SUBJECT"), required("VAPID_PUBLIC_KEY"), required("VAPID_PRIVATE_KEY"));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const providers = new Map([
  ["fcm.googleapis.com", /^\/(fcm\/send|wp)\//],
  ["updates.push.services.mozilla.com", /^\/wpush\//],
  ["web.push.apple.com", /^\//],
]);

function endpointPermitido(value: string) {
  try {
    if (typeof value !== "string" || value.length > 4096) return false;
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && !url.hash && Boolean(providers.get(url.hostname)?.test(url.pathname));
  } catch { return false; }
}

function autorizado(request: Request) {
  // verify_jwt=true valida a assinatura antes desta função; restringir a
  // chamada à claim assinada do papel de serviço evita depender de cópias de chave.
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return false;
  try {
    const payload = token.split(".")[1];
    if (!payload) return false;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    const claims = JSON.parse(json);
    return claims.role === "service_role" && claims.ref === projectRef;
  } catch {
    return false;
  }
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

// Limite real durante leitura: Content-Length sozinho pode estar ausente/forjado.
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid-body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2048) { await reader.cancel(); throw new Error("body-too-large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
}

async function row(table: string, fields: string, id: string) {
  const result = await db.from(table).select(fields).eq("id", id).maybeSingle();
  if (result.error) throw new Error("database-read-failed");
  return result.data;
}

async function send(userId: string, teamOnly: boolean) {
  // A inscrição existente não é autorização. Revalidar usuário e preferência agora.
  const user = await row("usuarios", "ativo,status_aprovacao,perfil,notificacoes_ativas", userId);
  if (!user?.ativo || user.status_aprovacao !== "aprovado" || !user.notificacoes_ativas) return;
  if (teamOnly && !["analista", "admin"].includes(user.perfil)) return;
  const { data: subscriptions, error } = await db.from("push_subscriptions")
    .select("id,endpoint,p256dh,auth").eq("usuario_id", userId).limit(10);
  if (error) throw new Error("subscription-read-failed");
  for (const subscription of subscriptions ?? []) {
    if (!endpointPermitido(subscription.endpoint)) continue;
    try {
      // Nunca transmitir título, nome ou número do chamado para tela bloqueada.
      await webpush.sendNotification({ endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify({ titulo: "Central de TI", corpo: "Há uma atualização. Entre para consultar." }),
      { timeout: 5000, TTL: 60 });
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        const removed = await db.from("push_subscriptions").delete().eq("id", subscription.id);
        if (removed.error) console.error("push-remove-failed");
      } else {
        // Sem endpoint, corpo de resposta externo, chave ou dados pessoais no log.
        console.error("push-delivery-failed", { status: status ?? null });
      }
    }
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return reply(405, { error: "method-not-allowed" });
  if (!autorizado(request)) return reply(401, { error: "unauthorized" });
  if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") {
    return reply(415, { error: "unsupported-content-type" });
  }
  let event: { table: string; id: string };
  try {
    const body = await readBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).sort().join(",") !== "id,table"
      || !["comentarios", "chamados"].includes(body.table)
      || typeof body.id !== "string" || !uuid.test(body.id)) return reply(400, { error: "invalid-event" });
    event = body;
  } catch { return reply(400, { error: "invalid-body" }); }
  try {
    const recipients = new Map<string, boolean>();
    if (event.table === "comentarios") {
      const comment = await row("comentarios", "chamado_id,autor_id,tipo,visibilidade", event.id);
      if (!comment || comment.tipo !== "humano" || comment.visibilidade !== "publico") {
        return reply(200, { ok: true, ignored: true });
      }
      const ticket = await row("chamados", "solicitante_id,chamado_membros(usuario_id)", comment.chamado_id);
      if (!ticket) return reply(200, { ok: true, ignored: true });
      const author = await row("usuarios", "ativo,status_aprovacao,perfil", comment.autor_id);
      if (!author?.ativo || author.status_aprovacao !== "aprovado") return reply(200, { ok: true, ignored: true });
      if (comment.autor_id === ticket.solicitante_id) {
        for (const member of ticket.chamado_membros ?? []) recipients.set(member.usuario_id, true);
      } else if (["analista", "admin"].includes(author.perfil)) {
        recipients.set(ticket.solicitante_id, false);
      }
    } else {
      const ticket = await row("chamados", "id", event.id);
      if (!ticket) return reply(404, { error: "event-not-found" });
      const { data: team, error } = await db.from("usuarios").select("id")
        .in("perfil", ["analista", "admin"]).eq("ativo", true).eq("status_aprovacao", "aprovado")
        .eq("notificacoes_ativas", true);
      if (error) throw new Error("team-read-failed");
      for (const user of team ?? []) recipients.set(user.id, true);
    }
    // PK garante deduplicação também entre duas instâncias concorrentes.
    const claim = await db.from("push_eventos_processados").insert({ tabela: event.table, registro_id: event.id });
    if (claim.error?.code === "23505") return reply(200, { ok: true, duplicate: true });
    if (claim.error) throw new Error("event-claim-failed");
    // Sem Promise.all ilimitado sobre dispositivos/usuários controlados pelo cliente.
    for (const [userId, teamOnly] of recipients) await send(userId, teamOnly);
    return reply(200, { ok: true });
  } catch {
    console.error("push-processing-failed");
    return reply(500, { error: "internal-error" });
  }
});
