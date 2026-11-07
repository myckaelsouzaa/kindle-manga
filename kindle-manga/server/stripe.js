'use strict';
// Cliente mínimo da API do Stripe (fetch nativo, sem SDK) e verificação de assinatura de webhook.
const crypto = require('crypto');
const config = require('./config');

const API = 'https://api.stripe.com';

// Converte objetos aninhados para o formato de formulário do Stripe: a[b][0]=c.
function encodeForm(value, prefix = '', out = new URLSearchParams()) {
  if (value === undefined || value === null) return out;
  if (typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) encodeForm(inner, prefix ? `${prefix}[${key}]` : key, out);
  } else {
    out.append(prefix, String(value));
  }
  return out;
}

const isConfigured = () => Boolean(config.stripe.secretKey);

function createStripeClient({ fail }) {
  async function request(method, path, params, { idempotencyKey } = {}) {
    if (!isConfigured()) throw fail(503, 'Pagamentos ainda não estão configurados. Tente novamente mais tarde.', 'payments_unavailable');
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        method,
        signal: AbortSignal.timeout(20_000),
        headers: {
          Authorization: `Bearer ${config.stripe.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(idempotencyKey && { 'Idempotency-Key': idempotencyKey })
        },
        body: method === 'GET' ? undefined : encodeForm(params).toString()
      });
    } catch (error) {
      console.error('[MangaKindle] Stripe indisponível:', error.message);
      throw fail(502, 'Não foi possível falar com o provedor de pagamento. Tente novamente.', 'payments_unavailable');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('[MangaKindle] Stripe HTTP', response.status, data?.error?.type, data?.error?.code, data?.error?.message);
      const declined = response.status === 402 || data?.error?.type === 'card_error';
      throw fail(declined ? 402 : 502, declined
        ? 'Pagamento recusado. Verifique os dados ou tente outra forma de pagamento.'
        : 'Não foi possível processar o pagamento agora. Tente novamente.', declined ? 'payment_declined' : 'payments_unavailable');
    }
    return data;
  }

  return {
    post: (path, params, options) => request('POST', path, params, options),
    get: (path, options) => request('GET', path, undefined, options)
  };
}

// Valida o cabeçalho Stripe-Signature (t=timestamp,v1=hmac) contra o corpo bruto da requisição.
function verifyWebhook(rawBody, header, secret = config.stripe.webhookSecret, toleranceSeconds = 300, now = Date.now()) {
  if (!secret) return null;
  const parts = String(header || '').split(',').map(item => item.trim().split('='));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!timestamp || !signatures.length) return null;
  if (Math.abs(now / 1000 - Number(timestamp)) > toleranceSeconds) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex');
  const valid = signatures.some(signature => {
    const received = Buffer.from(signature, 'hex'), wanted = Buffer.from(expected, 'hex');
    return received.length === wanted.length && crypto.timingSafeEqual(received, wanted);
  });
  if (!valid) return null;
  try { return JSON.parse(rawBody.toString('utf8')); } catch { return null; }
}

module.exports = { createStripeClient, verifyWebhook, encodeForm, isConfigured };
