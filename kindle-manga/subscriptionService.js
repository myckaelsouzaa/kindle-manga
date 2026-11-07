'use strict';
// Regras de negócio da assinatura: ativar, renovar e atualizar o perfil no Supabase.
const config = require('./config');

const COLUMNS = 'id,email,role,subscription_status,subscription_started_at,subscription_expires_at,payment_customer_id,payment_subscription_id';
const DAY_MS = 24 * 60 * 60 * 1000;
const expiryOf = user => user?.subscription_expires_at ? new Date(user.subscription_expires_at).getTime() : 0;

function createSubscriptionService({ supabase, eq, fail }) {
  const find = async filter => (await supabase('usuarios', { select: COLUMNS, limit: 1, ...filter }))[0] || null;
  const patch = async (filter, body) => (await supabase('usuarios', filter, {
    method: 'PATCH', prefer: 'return=representation', body: JSON.stringify(body)
  }))?.[0] || null;

  const findById = id => find({ id: eq(id) });
  const findBySubscription = id => id ? find({ payment_subscription_id: eq(id) }) : null;
  const findByCustomer = id => id ? find({ payment_customer_id: eq(id) }) : null;

  // Carrega o usuário e, se o período pago acabou, mantém a coluna role coerente (melhor esforço).
  async function loadUser(id) {
    const user = await findById(id);
    if (!user) throw fail(404, 'Usuário não encontrado.');
    if (user.role === 'premium' && expiryOf(user) <= Date.now()) {
      const downgraded = await patch({ id: eq(user.id), role: eq('premium') }, { role: 'free', subscription_status: 'expired' })
        .catch(error => { console.warn('[MangaKindle] não foi possível rebaixar assinatura vencida:', error.message); return null; });
      return downgraded ? { ...user, ...downgraded } : { ...user, role: 'free', subscription_status: 'expired' };
    }
    return user;
  }

  // Confirma um pagamento. O registro em pagamentos_usuario (chave única provider+ref) garante
  // que reenvios de webhook ou chamadas repetidas não estendam a assinatura duas vezes.
  async function activate({ userId, ref, method, amountCents, periodEnd, customerId, subscriptionId, provider = 'stripe' }) {
    const user = await findById(userId);
    if (!user) throw fail(404, 'Usuário não encontrado.');
    const now = Date.now(), isAdmin = user.role === 'admin';
    const currentExpiry = user.role === 'premium' ? expiryOf(user) : 0;
    const base = Math.max(now, currentExpiry);
    let expires = base + config.PLAN.periodDays * DAY_MS;
    if (periodEnd) expires = Math.max(expires, Number(periodEnd) * 1000 + config.RENEWAL_GRACE_MS);

    const inserted = await supabase('pagamentos_usuario', { on_conflict: 'provider,provider_ref' }, {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
      body: JSON.stringify({
        usuario_id: userId, provider, provider_ref: ref, metodo: method, valor_centavos: Number(amountCents) || 0,
        moeda: config.PLAN.currency, status: 'paid', periodo_inicio: new Date(now).toISOString(), periodo_fim: new Date(expires).toISOString()
      })
    });
    if (!inserted?.length) return { duplicate: true, user };

    try {
      const updated = await patch({ id: eq(userId) }, {
        role: isAdmin ? 'admin' : 'premium',
        subscription_status: 'active',
        subscription_started_at: currentExpiry > now && user.subscription_started_at ? user.subscription_started_at : new Date(now).toISOString(),
        subscription_expires_at: isAdmin ? null : new Date(expires).toISOString(),
        ...(customerId && { payment_customer_id: customerId }),
        ...(subscriptionId && { payment_subscription_id: subscriptionId })
      });
      return { duplicate: false, user: updated || user };
    } catch (error) {
      // Desfaz o registro para que o próximo reenvio do webhook tente ativar de novo.
      await supabase('pagamentos_usuario', { id: eq(inserted[0].id) }, { method: 'DELETE' }).catch(() => undefined);
      throw error;
    }
  }

  const linkProvider = (userId, customerId, subscriptionId) => patch({ id: eq(userId) }, {
    ...(customerId && { payment_customer_id: customerId }), ...(subscriptionId && { payment_subscription_id: subscriptionId })
  });
  // Cancelamento ou falha de cobrança: o acesso continua até o fim do período já pago.
  const markSubscription = (subscriptionId, status) => subscriptionId
    ? patch({ payment_subscription_id: eq(subscriptionId), role: eq('premium') }, { subscription_status: status })
    : null;

  return { loadUser, findById, findBySubscription, findByCustomer, activate, linkProvider, markSubscription };
}

module.exports = { createSubscriptionService, expiryOf };
