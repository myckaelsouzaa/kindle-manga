process.env.ADMIN_EMAILS = 'Myckael@Exemplo.com';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
process.env.SESSION_SECRET = 'x'.repeat(40);
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
const assert = require('assert'), crypto = require('crypto');
const W = './';
const { createPremium } = require(W + 'index.js');

class HttpError extends Error { constructor(s, m, c) { super(m); this.status = s; this.code = c; } }
const fail = (s, m, c) => new HttpError(s, m, c);
const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222', U3 = '33333333-3333-4333-8333-333333333333';
const db = { usuarios: [
  { id: U1, email: 'free@x.com', role: 'free', subscription_status: 'inactive' },
  { id: U2, email: 'myckael@exemplo.com', role: 'free', subscription_status: 'inactive' },
  { id: U3, email: 'lapsed@x.com', role: 'premium', subscription_status: 'active', subscription_expires_at: new Date(Date.now() - 1000).toISOString() }
], pagamentos_usuario: [] };
let seq = 0;
const match = (row, params) => Object.entries(params).every(([k, v]) => !String(v).startsWith('eq.') || String(row[k]) === String(v).slice(3));
async function supabase(table, params = {}, opts = {}) {
  const rows = db[table], method = opts.method || 'GET', body = opts.body && JSON.parse(opts.body);
  if (method === 'GET') return rows.filter(r => match(r, params)).slice(0, Number(params.limit) || 99);
  if (method === 'POST') {
    if (rows.some(r => r.provider === body.provider && r.provider_ref === body.provider_ref)) return [];
    const row = { id: `p${++seq}`, ...body }; rows.push(row); return [row];
  }
  if (method === 'PATCH') { const hit = rows.filter(r => match(r, params)); hit.forEach(r => Object.assign(r, body)); return hit; }
  if (method === 'DELETE') { db[table] = rows.filter(r => !match(r, params)); return null; }
}
const eq = v => `eq.${v}`;
const readRaw = async req => req.raw, readJson = async req => req.json;
const p = createPremium({ supabase, eq, fail, readJson, readRaw });
const { session, guards, permissions, controller } = p;
const req = (token, extra = {}) => ({ headers: token ? { authorization: `Bearer ${token}` } : {}, ...extra });
const signed = (obj, secret = 'whsec_test_secret', t = Math.floor(Date.now() / 1000)) => {
  const raw = Buffer.from(JSON.stringify(obj));
  return { raw, headers: { 'stripe-signature': `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}` } };
};
const rejects = async (fn, status, code) => { try { await fn(); } catch (e) { assert.equal(e.status, status); if (code) assert.equal(e.code, code); return; } assert.fail('deveria falhar'); };

(async () => {
  // sessao
  const tok = session.sign(U1);
  assert.equal(session.verify(tok), U1);
  assert.equal(session.verify(tok.slice(0, -2) + 'xx'), null);
  assert.equal(session.verify(session.sign(U1, -10)), null);
  assert.equal(session.verify(''), null);

  // papeis
  assert.equal(permissions.effectiveRole(db.usuarios[1]), 'admin');          // admin por e-mail do ambiente
  assert.equal(permissions.effectiveRole({ email: 'a@a', role: 'admin' }), 'admin');
  assert.equal(permissions.effectiveRole(db.usuarios[2]), 'free');           // premium vencido
  assert.ok(!permissions.can('free', 'save') && !permissions.can('free', 'download') && permissions.can('free', 'read'));
  assert.ok(permissions.can('premium', 'download') && permissions.can('admin', 'save'));

  // guarda
  const ok = async () => [200, {}];
  const save = guards.owner('save')(ok);
  await rejects(() => save({ req: req(''), params: [U1] }), 401, 'session_required');
  await rejects(() => save({ req: req(tok), params: [U2] }), 403, 'forbidden');
  await rejects(() => save({ req: req(tok), params: [U1] }), 403, 'premium_required');
  assert.deepEqual(await guards.owner(null)(ok)({ req: req(tok), params: [U1] }), [200, {}]); // free le/remove
  assert.deepEqual(await save({ req: req(session.sign(U2)), params: [U2] }), [200, {}]);       // admin
  await rejects(() => guards.owner('download')(ok)({ req: req(session.sign(U3)), params: [U3] }), 403, 'premium_required');

  // webhook: assinatura
  await rejects(() => controller.webhook({ req: { ...signed({ type: 'x' }, 'outro'), } }), 400);
  const pi = (id, extra = {}) => ({ type: 'payment_intent.succeeded', data: { object: { id, amount: 500, amount_received: 500, metadata: { usuario_id: U1, metodo: 'pix' }, ...extra } } });
  const r1 = await controller.webhook({ req: signed(pi('pi_1')) });
  assert.equal(r1[0], 200);
  const u = db.usuarios[0];
  assert.equal(u.role, 'premium'); assert.equal(u.subscription_status, 'active');
  const first = u.subscription_expires_at;
  assert.ok(new Date(first) - Date.now() > 29.9 * 864e5);
  // idempotencia: mesmo evento nao estende de novo
  await controller.webhook({ req: signed(pi('pi_1')) });
  assert.equal(u.subscription_expires_at, first); assert.equal(db.pagamentos_usuario.length, 1);
  // pagamento diferente soma 30 dias
  await controller.webhook({ req: signed(pi('pi_2')) });
  assert.ok(new Date(u.subscription_expires_at) - new Date(first) > 29.9 * 864e5);
  // premium agora acessa salvar/baixar
  assert.deepEqual(await guards.owner('download')(ok)({ req: req(tok), params: [U1] }), [200, {}]);
  // pagamento de assinatura (com invoice) e ignorado em payment_intent
  await controller.webhook({ req: signed(pi('pi_3', { invoice: 'in_1' })) }); assert.equal(db.pagamentos_usuario.length, 2);
  // invoice.paid vincula assinatura
  const inv = { type: 'invoice.paid', data: { object: { id: 'in_9', amount_paid: 500, customer: 'cus_1', subscription: 'sub_1', lines: { data: [{ metadata: { usuario_id: U1 }, period: { end: Math.floor(Date.now() / 1000) + 31 * 86400 } }] } } } };
  await controller.webhook({ req: signed(inv) });
  assert.equal(u.payment_subscription_id, 'sub_1'); assert.equal(u.payment_customer_id, 'cus_1'); assert.equal(db.pagamentos_usuario.length, 3);
  // cancelamento mantem acesso ate o fim do periodo
  await controller.webhook({ req: signed({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } }) });
  assert.equal(u.subscription_status, 'canceled'); assert.equal(permissions.effectiveRole(u), 'premium');
  assert.equal(permissions.publicSubscription(u).renews, false);
  // usuario inexistente nao quebra o webhook
  const ghost = pi('pi_g'); ghost.data.object.metadata.usuario_id = '99999999-9999-4999-8999-999999999999';
  assert.equal((await controller.webhook({ req: signed(ghost) }))[0], 200);
  // admin pago continua admin
  await controller.webhook({ req: signed(pi('pi_a', { metadata: { usuario_id: U2 } })) });
  // premium vencido e rebaixado ao carregar
  const lapsed = await p.service.loadUser(U3); assert.equal(lapsed.role, 'free'); assert.equal(db.usuarios[2].subscription_status, 'expired');
  // checkout: admin nao compra
  await rejects(() => controller.checkoutPix({ user: db.usuarios[1], role: 'admin' }), 409, 'already_admin');
  await rejects(() => controller.checkoutCard({ user: { ...u, subscription_status: 'active' }, role: 'premium' }), 409, 'already_subscribed');
  await rejects(() => controller.googlePay({ req: { json: { token: '{"id":"x"}' } }, user: db.usuarios[0], role: 'free' }), 422, 'invalid_payment');
  console.log('OK - todos os testes do backend passaram');
})().catch(e => { console.error('FALHOU', e); process.exit(1); });
