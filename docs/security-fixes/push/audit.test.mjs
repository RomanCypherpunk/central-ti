// PoC executa a fonte real em VM. Nenhum acesso à rede/banco/push real.
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { timingSafeEqual } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const ticketId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const commentId = '00000000-0000-4000-8000-000000000003';
function loadEdge(file, overrides = {}) {
  const sent = [], queries = [], claims = new Set();
  const rows = {
    usuarios: [{ id: userId, nome: 'Pessoa', perfil: 'analista', ativo: true,
      status_aprovacao: 'aprovado', notificacoes_ativas: true, ...overrides.user }],
    chamados: [{ id: ticketId, titulo: 'Título real', numero: 1, solicitante_id: userId,
      categorias: { nome: 'Categoria' }, chamado_membros: [{ usuario_id: userId }] }],
    comentarios: [{ id: commentId, chamado_id: ticketId, autor_id: userId, tipo: 'humano', visibilidade: 'interno' }],
    push_subscriptions: [{ id: 'subscription', usuario_id: userId,
      endpoint: overrides.endpoint ?? 'https://fcm.googleapis.com/fcm/send/test', p256dh: 'key', auth: 'auth' }],
  };
  const client = { from(table) {
    queries.push(table);
    let filtered = rows[table] ?? [], single = false, insertion = null;
    const chain = {
      select() { return chain; },
      eq(field, value) { filtered = filtered.filter(row => row[field] === value); return chain; },
      in(field, values) { filtered = filtered.filter(row => values.includes(row[field])); return chain; },
      limit(n) { filtered = filtered.slice(0, n); return chain; },
      maybeSingle() { single = true; return chain; },
      delete() { return chain; },
      insert(value) { insertion = value; return chain; },
      then(resolve, reject) {
        if (insertion) {
          const key = JSON.stringify(insertion);
          const error = claims.has(key) ? { code: '23505' } : null;
          claims.add(key);
          return Promise.resolve({ data: null, error }).then(resolve, reject);
        }
        return Promise.resolve({ data: single ? filtered[0] ?? null : filtered, error: null }).then(resolve, reject);
      },
    };
    return chain;
  }};
  let handler;
  const source = readFileSync(file, 'utf8').replace(/^import .*;\r?\n/gm, '');
  const context = { createClient: () => client, webpush: { setVapidDetails() {},
    async sendNotification(subscription, payload) { sent.push({ subscription, payload: JSON.parse(payload) }); } },
    Deno: { env: { get: name => name === 'SUPABASE_SERVICE_ROLE_KEY' ? 'server-only-key' : 'test' },
      serve(fn) { handler = fn; } }, console: { error() {}, warn() {} },
    Response, Request, URL, TextEncoder, TextDecoder, Uint8Array, timingSafeEqual };
  vm.runInNewContext(stripTypeScriptTypes(source), context, { filename: file });
  const request = (body, auth, method = 'POST') => handler(new Request('https://local.test', {
    method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  }));
  return { request, sent, queries, context };
}
const original = 'supabase/functions/notificar-portal/index.ts';
const candidate = 'supabase/functions/notificar-portal/index.ts';

test.skip('PoC histórica: sem sessão, chamado inexistente e título forjado geravam push', async () => {
  const app = loadEdge(original);
  const result = await app.request({ table: 'chamados', record: { id: commentId, titulo: 'Título forjado', numero: 77 } });
  assert.equal(result.status, 200);
  assert.equal(app.sent.length, 1);
  assert.equal(app.sent[0].payload.titulo, 'Título forjado');
});
test.skip('PoC histórica: replay duplicava e preferência desligada era ignorada', async () => {
  const app = loadEdge(original, { user: { notificacoes_ativas: false } });
  const forged = { table: 'chamados', record: { id: ticketId, titulo: 'Forjado', numero: 77 } };
  await app.request(forged); await app.request(forged);
  assert.equal(app.sent.length, 2);
});
test.skip('PoC histórica: endpoint arbitrário era encaminhado à biblioteca de rede', async () => {
  const app = loadEdge(original, { endpoint: 'https://collector.invalid/private' });
  await app.request({ table: 'chamados', record: { id: ticketId, titulo: 'Teste', numero: 1 } });
  assert.equal(app.sent[0].subscription.endpoint, 'https://collector.invalid/private');
});
test.skip('PoC histórica: comentário interno podia ser forjado como público sem releitura', async () => {
  const app = loadEdge(original);
  await app.request({ table: 'comentarios', record: { id: commentId, chamado_id: ticketId,
    autor_id: userId, tipo: 'humano', visibilidade: 'publico' } });
  assert.equal(app.sent.length, 1);
  assert.ok(!app.queries.includes('comentarios'));
});
test('Candidato: sem credencial/credencial comum não consulta banco', async () => {
  const app = loadEdge(candidate);
  for (const auth of [undefined, 'Bearer user-jwt', 'Bearer sb_publishable_public']) {
    assert.equal((await app.request({ table: 'chamados', id: ticketId }, auth)).status, 401);
  }
  assert.equal(app.queries.length, 0);
  assert.equal(app.sent.length, 0);
});
test('Candidato: descarta payload arbitrário, método errado e comentário interno real', async () => {
  const app = loadEdge(candidate);
  const auth = 'Bearer server-only-key';
  assert.equal((await app.request({ table: 'chamados', id: ticketId, record: {} }, auth)).status, 400);
  assert.equal((await app.request({ table: 'chamados', id: ticketId }, auth, 'PUT')).status, 405);
  assert.equal((await app.request({ table: 'comentarios', id: commentId }, auth)).status, 200);
  assert.equal(app.sent.length, 0);
});
test('Candidato: evento legítimo envia genérico uma vez, inclusive replay concorrente', async () => {
  const app = loadEdge(candidate);
  const results = await Promise.all(Array.from({ length: 3 }, () => app.request(
    { table: 'chamados', id: ticketId }, 'Bearer server-only-key')));
  assert.ok(results.every(result => result.status === 200));
  assert.equal(app.sent.length, 1);
  assert.equal(app.sent[0].payload.titulo, 'Central de TI');
  assert.ok(!JSON.stringify(app.sent).includes('Título real'));
});
test('Candidato: não envia para desativado/rejeitado/opt-out nem endpoint externo', async () => {
  for (const override of [{ user: { ativo: false } }, { user: { status_aprovacao: 'rejeitado' } },
    { user: { notificacoes_ativas: false } }, { endpoint: 'https://collector.invalid/private' },
    { endpoint: 'https://fcm.googleapis.com.evil.invalid/fcm/send/test' },
    { endpoint: 'https://fcm.googleapis.com:8443/fcm/send/test' }]) {
    const app = loadEdge(candidate, override);
    await app.request({ table: 'chamados', id: ticketId }, 'Bearer server-only-key');
    assert.equal(app.sent.length, 0);
  }
});
test('SW implantado e candidato ignoram inclusive payload legado', async () => {
  for (const [file, expected] of [['public/sw.js', 'Central de TI'], ['docs/security-fixes/push/sw.js', 'Central de TI']]) {
    const listeners = {}, shown = [];
    vm.runInNewContext(readFileSync(file, 'utf8'), { self: { addEventListener(name, fn) { listeners[name] = fn; },
      registration: { async showNotification(title, options) { shown.push({ title, options }); } } } });
    let waiting;
    listeners.push({ data: { json: () => ({ titulo: 'Título sensível', corpo: 'Nome sensível' }) }, waitUntil(p) { waiting = p; } });
    await waiting;
    assert.equal(shown[0].title, expected);
  }
});
test('Candidato browser: erro RLS de inscrição não vira sucesso; logout invalida apesar de erro DELETE', async () => {
  const source = readFileSync('docs/security-fixes/push/push-sessao.js', 'utf8').replace(/export /g, '');
  let unsubscribed = 0, closed = 0;
  const subscription = { async unsubscribe() { unsubscribed++; },
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys: { p256dh: 'key', auth: 'key' } }) };
  const registration = { pushManager: { async getSubscription() { return subscription; } },
    async getNotifications() { return [{ close() { closed++; } }]; } };
  const storage = new Map([['central-ti.push-owner', userId]]);
  const context = vm.createContext({ navigator: { serviceWorker: { async getRegistration() { return registration; },
    async register() { return registration; } } }, localStorage: { getItem: k => storage.get(k),
      setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) } });
  vm.runInContext(source, context);
  const failedDB = { from() { return { async upsert() { return { error: { code: '42501' } }; },
    delete() { return { async eq() { return { error: { code: '42501' } }; } }; } }; } };
  await assert.rejects(context.inscreverPush(failedDB, userId, new Uint8Array()), /salvar/);
  assert.equal(unsubscribed, 1);
  await assert.rejects(context.limparPushNoLogout(failedDB), /servidor/);
  assert.equal(unsubscribed, 2); assert.equal(closed, 1);
  assert.equal(storage.size, 0);
});
