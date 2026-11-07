'use strict';
// Regras de acesso por nível (admin, premium, free) e guarda das rotas.
const config = require('./config');
const session = require('./session');

const FEATURE_ROLES = Object.freeze({
  read: ['free', 'premium', 'admin'],
  search: ['free', 'premium', 'admin'],
  save: ['premium', 'admin'],
  download: ['premium', 'admin']
});
const FEATURE_LABEL = { save: 'salvar mangás', download: 'baixar capítulos' };

const expiry = user => user?.subscription_expires_at ? new Date(user.subscription_expires_at).getTime() : 0;

// Nível efetivo: admin por e-mail do ambiente ou do banco; premium só dentro do período pago.
function effectiveRole(user, now = Date.now()) {
  if (!user) return 'free';
  if (config.adminEmails.has(String(user.email || '').toLowerCase()) || user.role === 'admin') return 'admin';
  return user.role === 'premium' && expiry(user) > now ? 'premium' : 'free';
}

const can = (role, feature) => (FEATURE_ROLES[feature] || []).includes(role);

// Campos de assinatura expostos ao navegador (a decisão real continua no servidor).
function publicSubscription(user) {
  const role = effectiveRole(user);
  const lapsed = role === 'free' && user?.role === 'premium';
  return {
    role,
    subscription_status: role === 'admin' ? 'active' : lapsed ? 'expired' : user?.subscription_status || 'inactive',
    subscription_expires_at: role === 'premium' ? user.subscription_expires_at : null,
    renews: role === 'premium' && Boolean(user.payment_subscription_id) && user.subscription_status === 'active'
  };
}

// Fábrica da guarda: valida a sessão, confere o dono dos dados e exige o recurso (quando houver).
function createGuards({ loadUser, fail }) {
  const authenticate = req => {
    const userId = session.verify(session.bearerToken(req));
    if (!userId) throw fail(401, 'Sessão expirada. Entre novamente para continuar.', 'session_required');
    return userId;
  };

  const requirePremium = (role, feature) => {
    if (feature && !can(role, feature)) {
      throw fail(403, `Recurso Premium: assine para ${FEATURE_LABEL[feature] || 'usar este recurso'}.`, 'premium_required');
    }
  };

  // Rotas /api/usuarios/:id/...: o token precisa pertencer ao :id da URL.
  const owner = feature => handler => async ctx => {
    const userId = authenticate(ctx.req), target = String(ctx.params[0] || '').toLowerCase();
    if (userId.toLowerCase() !== target) throw fail(403, 'Você não tem permissão para acessar estes dados.', 'forbidden');
    const user = await loadUser(userId), role = effectiveRole(user);
    requirePremium(role, typeof feature === 'function' ? feature(ctx) : feature);
    return handler({ ...ctx, user, role });
  };

  // Rotas /api/premium/...: qualquer usuário autenticado.
  const authenticated = handler => async ctx => {
    const user = await loadUser(authenticate(ctx.req));
    return handler({ ...ctx, user, role: effectiveRole(user) });
  };

  return { authenticate, owner, authenticated };
}

module.exports = { FEATURE_ROLES, effectiveRole, can, publicSubscription, createGuards };
