import { Model, request } from './Model.js';

// Regras de acesso exibidas na interface. A decisão real é sempre do servidor (HTTP 403 premium_required).
const PREMIUM_FEATURES = new Set(['save', 'download']);
const PREMIUM_ROLES = new Set(['premium', 'admin']);
const WATCH_INTERVAL_MS = 4000, WATCH_TIMEOUT_MS = 10 * 60 * 1000;

export const PLAN_PRICE = 'R$ 5,00';
export const ROLE_LABEL = { guest: 'Visitante', free: 'Gratuito', premium: 'Premium', admin: 'Administrador' };

const listeners = new Set();
let configPromise = null, watcher = null;

export const PremiumModel = {
  /* ----- nível do usuário ----- */
  role() {
    const { id, sessionToken, role, subscriptionExpiresAt } = Model.profile;
    if (!id || !sessionToken) return 'guest';
    if (role === 'admin') return 'admin';
    if (role === 'premium' && subscriptionExpiresAt && new Date(subscriptionExpiresAt).getTime() > Date.now()) return 'premium';
    return 'free';
  },
  isLoggedIn() { return this.role() !== 'guest'; },
  isPremium() { return PREMIUM_ROLES.has(this.role()); },
  can(feature) { return !PREMIUM_FEATURES.has(feature) || this.isPremium(); },
  expiresAt() { return this.role() === 'premium' ? Model.profile.subscriptionExpiresAt : null; },
  renews() { return this.role() === 'premium' && Boolean(Model.profile.renews); },

  onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  emit() { listeners.forEach(listener => listener(this.role())); },

  // Grava no perfil local o estado de assinatura devolvido pelo servidor e avisa a interface.
  apply(subscription) {
    const before = this.role();
    Model.patchProfile({
      role: subscription.role, subscriptionStatus: subscription.subscription_status,
      subscriptionExpiresAt: subscription.subscription_expires_at, renews: Boolean(subscription.renews)
    });
    const after = this.role();
    this.emit();
    return { before, after, changed: before !== after };
  },
  async refresh() {
    if (!this.isLoggedIn()) return null;
    const { subscription, token } = await request('/api/premium/status', { fallback: 'Não foi possível verificar sua assinatura.' });
    if (token) Model.patchProfile({ sessionToken: token }); // renova a sessão sem invalidar os caches
    return this.apply(subscription);
  },

  /* ----- configuração e pagamentos ----- */
  loadConfig() {
    configPromise ??= request('/api/premium/config', { fallback: 'Não foi possível carregar as formas de pagamento.' })
      .catch(error => { configPromise = null; throw error; });
    return configPromise;
  },
  startPix: () => request('/api/premium/checkout/pix', { method: 'POST', body: {}, fallback: 'Não foi possível gerar o código PIX.' }),
  startCard: () => request('/api/premium/checkout/card', { method: 'POST', body: {}, fallback: 'Não foi possível abrir o checkout do cartão.' }),
  openPortal: () => request('/api/premium/portal', { method: 'POST', body: {}, fallback: 'Não foi possível abrir o gerenciamento da assinatura.' }),
  async payWithGooglePay(token) {
    const { subscription } = await request('/api/premium/checkout/google-pay', { method: 'POST', body: { token }, fallback: 'Não foi possível concluir o pagamento com Google Pay.' });
    return this.apply(subscription);
  },

  // Consulta o servidor até o webhook liberar o Premium (libera sem recarregar a página).
  watchActivation({ onActive, onTimeout } = {}) {
    this.stopWatching();
    const startedAt = Date.now();
    const state = watcher = { stopped: false, timer: 0 };
    const tick = async () => {
      if (state.stopped) return;
      try {
        const result = await this.refresh();
        if (state.stopped) return;
        if (result && this.isPremium()) { this.stopWatching(); return onActive?.(result); }
      } catch (error) {
        if (error.status === 401) return this.stopWatching(); // sessão encerrada: o Controller cuida do login
      }
      if (Date.now() - startedAt > WATCH_TIMEOUT_MS) { this.stopWatching(); return onTimeout?.(); }
      state.timer = setTimeout(tick, WATCH_INTERVAL_MS);
    };
    state.timer = setTimeout(tick, 1500);
  },
  stopWatching() {
    if (!watcher) return;
    watcher.stopped = true;
    clearTimeout(watcher.timer);
    watcher = null;
  },
  isWatching: () => Boolean(watcher)
};
