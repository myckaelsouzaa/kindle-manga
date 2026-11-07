'use strict';
// Ponto de entrada do módulo Premium: monta sessão, permissões, serviço, gateway e controlador.
const config = require('./config');
const session = require('./session');
const permissions = require('./permissions');
const { createStripeClient } = require('./stripe');
const { createSubscriptionService } = require('./subscriptionService');
const { createPremiumController } = require('./premiumController');

function createPremium({ supabase, eq, fail, readJson, readRaw }) {
  const service = createSubscriptionService({ supabase, eq, fail });
  const guards = permissions.createGuards({ loadUser: service.loadUser, fail });
  const controller = createPremiumController({ stripe: createStripeClient({ fail }), service, fail, readJson, readRaw });
  return { config, session, permissions, service, guards, controller };
}

module.exports = { createPremium };
