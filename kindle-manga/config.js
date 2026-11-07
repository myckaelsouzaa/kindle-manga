'use strict';
// Configuração central da assinatura Premium (lida do ambiente, nunca do navegador).
const crypto = require('crypto');

const env = process.env;
const list = value => String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);

let sessionSecret = env.SESSION_SECRET || '';
const ephemeralSecret = sessionSecret.length < 32;
if (ephemeralSecret) sessionSecret = crypto.randomBytes(32).toString('hex'); // sessões caem a cada reinício

module.exports = {
  PLAN: Object.freeze({ id: 'premium_mensal', name: 'MangaKindle Premium', priceCents: 500, currency: 'brl', periodDays: Number(env.PREMIUM_PERIOD_DAYS) || 30 }),
  // Prazo extra após o fim do período pago, para absorver atrasos de webhook em renovações.
  RENEWAL_GRACE_MS: 2 * 24 * 60 * 60 * 1000,
  SESSION_TTL_SECONDS: 30 * 24 * 60 * 60,
  sessionSecret,
  ephemeralSecret,
  // Administradores por e-mail (comparação exata, em minúsculas). Ex.: ADMIN_EMAILS=myckael@exemplo.com
  adminEmails: new Set(list(env.ADMIN_EMAILS)),
  appUrl: (env.APP_URL || `http://localhost:${Number(env.PORT) || 3000}`).replace(/\/$/, ''),
  stripe: {
    secretKey: env.STRIPE_SECRET_KEY || '',
    publishableKey: env.STRIPE_PUBLISHABLE_KEY || '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || ''
  },
  googlePay: {
    environment: env.GOOGLE_PAY_ENV === 'PRODUCTION' ? 'PRODUCTION' : 'TEST',
    merchantId: env.GOOGLE_PAY_MERCHANT_ID || '',
    merchantName: env.GOOGLE_PAY_MERCHANT_NAME || 'MangaKindle'
  }
};
