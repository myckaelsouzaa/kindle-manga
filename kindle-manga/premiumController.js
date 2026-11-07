'use strict';
// Controlador da assinatura Premium: configuração pública, status, checkouts e webhook do Stripe.
const config = require('./config');
const { verifyWebhook, isConfigured } = require('./stripe');
const { publicSubscription } = require('./permissions');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GOOGLE_TOKEN = /^tok_[A-Za-z0-9_]+$/;
const CHECKOUT_HOST = 'https://checkout.stripe.com/';
const { PLAN } = config;
const description = `${PLAN.name} (${PLAN.periodDays} dias)`;
const minuteSlot = (size = 60_000) => Math.floor(Date.now() / size);
const httpsOnly = value => typeof value === 'string' && value.startsWith('https://') ? value : '';

function createPremiumController({ stripe, service, fail, readRaw, readJson }) {
  const metadataOf = user => ({ usuario_id: user.id, plano: PLAN.id });

  function assertCanBuy(user, role, { recurring = false } = {}) {
    if (role === 'admin') throw fail(409, 'Administradores já têm acesso completo, sem assinatura.', 'already_admin');
    if (recurring && role === 'premium' && user.subscription_status === 'active' && user.payment_subscription_id) {
      throw fail(409, 'Você já possui uma assinatura ativa no cartão.', 'already_subscribed');
    }
  }

  /* ---------- rotas autenticadas (recebem { user, role }) ---------- */

  const publicConfig = () => {
    const ready = isConfigured();
    return [200, {
      plan: { id: PLAN.id, name: PLAN.name, priceCents: PLAN.priceCents, currency: PLAN.currency.toUpperCase(), periodDays: PLAN.periodDays },
      methods: { pix: ready, card: ready, googlePay: ready && Boolean(config.stripe.publishableKey) },
      googlePay: ready && config.stripe.publishableKey ? {
        environment: config.googlePay.environment, merchantId: config.googlePay.merchantId, merchantName: config.googlePay.merchantName,
        gateway: 'stripe', stripeVersion: '2018-10-31', publishableKey: config.stripe.publishableKey
      } : null
    }];
  };

  const status = ({ user }) => [200, { subscription: publicSubscription(user) }];

  // Cartão: Checkout hospedado pelo Stripe, em modo assinatura (renovação mensal automática).
  async function checkoutCard({ user, role }) {
    assertCanBuy(user, role, { recurring: true });
    const session = await stripe.post('/v1/checkout/sessions', {
      mode: 'subscription',
      locale: 'pt-BR',
      payment_method_types: ['card'],
      client_reference_id: user.id,
      ...(user.payment_customer_id ? { customer: user.payment_customer_id } : { customer_email: user.email }),
      success_url: `${config.appUrl}/?premium=success`,
      cancel_url: `${config.appUrl}/?premium=cancel`,
      line_items: [{
        quantity: 1,
        price_data: { currency: PLAN.currency, unit_amount: PLAN.priceCents, recurring: { interval: 'month' }, product_data: { name: PLAN.name } }
      }],
      metadata: metadataOf(user),
      subscription_data: { metadata: metadataOf(user) }
    }, { idempotencyKey: `card:${user.id}:${minuteSlot()}` });
    if (!String(session.url || '').startsWith(CHECKOUT_HOST)) throw fail(502, 'Não foi possível abrir o checkout. Tente novamente.', 'payments_unavailable');
    return [200, { url: session.url }];
  }

  // Portal do Stripe: o assinante do cartão troca o cartão, vê recibos ou cancela a renovação.
  async function portal({ user }) {
    if (!user.payment_customer_id) throw fail(409, 'Você ainda não tem uma assinatura no cartão para gerenciar.', 'no_subscription');
    const session = await stripe.post('/v1/billing_portal/sessions', { customer: user.payment_customer_id, return_url: `${config.appUrl}/` });
    if (!String(session.url || '').startsWith('https://billing.stripe.com/')) throw fail(502, 'Não foi possível abrir o gerenciamento da assinatura.', 'payments_unavailable');
    return [200, { url: session.url }];
  }

  // PIX: cobrança avulsa de 30 dias; o webhook confirma o pagamento e libera o acesso.
  async function checkoutPix({ user, role }) {
    assertCanBuy(user, role);
    const intent = await stripe.post('/v1/payment_intents', {
      amount: PLAN.priceCents, currency: PLAN.currency, confirm: true, description,
      payment_method_types: ['pix'], payment_method_data: { type: 'pix' },
      payment_method_options: { pix: { expires_after_seconds: 1800 } },
      metadata: { ...metadataOf(user), metodo: 'pix' }
    }, { idempotencyKey: `pix:${user.id}:${minuteSlot(30_000)}` });
    const qr = intent.next_action?.pix_display_qr_code;
    if (!qr?.data) throw fail(502, 'Não foi possível gerar o código PIX. Tente novamente.', 'payments_unavailable');
    return [201, { paymentId: intent.id, code: qr.data, image: httpsOnly(qr.image_url_png), expiresAt: qr.expires_at ? qr.expires_at * 1000 : null }];
  }

  // Google Pay: o navegador envia o token; o servidor cobra no Stripe e libera o acesso na hora.
  async function googlePay({ req, user, role }) {
    assertCanBuy(user, role);
    const { token } = await readJson(req);
    let tokenId = '';
    try { tokenId = (typeof token === 'string' ? JSON.parse(token) : token)?.id; } catch { /* token inválido */ }
    if (!GOOGLE_TOKEN.test(String(tokenId))) throw fail(422, 'Dados do Google Pay inválidos. Tente novamente.', 'invalid_payment');
    const intent = await stripe.post('/v1/payment_intents', {
      amount: PLAN.priceCents, currency: PLAN.currency, confirm: true, description,
      payment_method_types: ['card'], payment_method_data: { type: 'card', card: { token: tokenId } },
      metadata: { ...metadataOf(user), metodo: 'google_pay' }
    }, { idempotencyKey: `gp:${tokenId}` });
    if (intent.status !== 'succeeded') {
      await stripe.post(`/v1/payment_intents/${encodeURIComponent(intent.id)}/cancel`, {}).catch(() => undefined);
      throw fail(402, 'Não foi possível autorizar este cartão no Google Pay. Tente pagar com o cartão no checkout seguro.', 'payment_declined');
    }
    const { user: updated } = await service.activate({
      userId: user.id, ref: intent.id, method: 'google_pay', amountCents: intent.amount_received ?? intent.amount
    });
    return [200, { subscription: publicSubscription(updated) }];
  }

  /* ---------- webhook do Stripe (autenticado pela assinatura, não pela sessão) ---------- */

  const validId = value => UUID.test(String(value || '')) ? String(value) : '';

  async function ownerOf(object, ...extraMetadata) {
    const fromMetadata = [object.metadata, ...extraMetadata].map(meta => validId(meta?.usuario_id)).find(Boolean);
    if (fromMetadata) return fromMetadata;
    const bySubscription = await service.findBySubscription(object.subscription);
    return (bySubscription || await service.findByCustomer(object.customer))?.id || '';
  }

  async function handleEvent(event) {
    const object = event.data?.object || {};
    switch (event.type) {
      case 'payment_intent.succeeded': {
        // Cobranças de assinatura já chegam por invoice.paid; aqui ficam PIX e Google Pay.
        if (object.invoice) return;
        const userId = validId(object.metadata?.usuario_id);
        if (!userId) return;
        await service.activate({ userId, ref: object.id, method: object.metadata?.metodo || 'card', amountCents: object.amount_received ?? object.amount });
        return;
      }
      case 'checkout.session.completed': {
        // Em assinaturas a liberação vem de invoice.paid; aqui só vinculamos cliente e assinatura.
        if (object.mode !== 'subscription') return;
        const userId = validId(object.client_reference_id) || validId(object.metadata?.usuario_id);
        if (userId) await service.linkProvider(userId, object.customer, object.subscription);
        return;
      }
      case 'invoice.paid': {
        if (!Number(object.amount_paid)) return;
        const line = object.lines?.data?.[0];
        const subscription = object.subscription || object.parent?.subscription_details?.subscription;
        const userId = await ownerOf({ ...object, subscription },
          object.subscription_details?.metadata, object.parent?.subscription_details?.metadata, line?.metadata);
        if (!userId) return;
        await service.activate({
          userId, ref: object.id, method: 'card', amountCents: object.amount_paid,
          periodEnd: line?.period?.end, customerId: object.customer, subscriptionId: subscription
        });
        return;
      }
      case 'invoice.payment_failed':
        await service.markSubscription(object.subscription || object.parent?.subscription_details?.subscription, 'past_due');
        return;
      case 'customer.subscription.deleted':
        await service.markSubscription(object.id, 'canceled');
        return;
      default:
    }
  }

  async function webhook({ req }) {
    const event = verifyWebhook(await readRaw(req), req.headers['stripe-signature']);
    if (!event) throw fail(400, 'Assinatura do webhook inválida.');
    try {
      await handleEvent(event);
    } catch (error) {
      // Usuário inexistente não se resolve com reenvio; qualquer outra falha pede nova tentativa.
      if (error.status === 404) console.warn('[MangaKindle] webhook ignorado (usuário não encontrado):', event.type);
      else throw error;
    }
    return [200, { received: true }];
  }

  return { publicConfig, status, checkoutCard, checkoutPix, googlePay, portal, webhook, handleEvent };
}

module.exports = { createPremiumController };
