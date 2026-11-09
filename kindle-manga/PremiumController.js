import { Model } from './Model.js';
import { View } from './View.js';
import { PremiumModel } from './PremiumModel.js';
import { PremiumView } from './PremiumView.js';
import { GooglePay } from './GooglePay.js';

const { $ } = View;
const PROCESSING_TIMEOUT_MS = 2 * 60 * 1000;
let hooks = {}, method = 'pix', checkoutState = null, pixBusy = false, lastRole = '';

// Executa uma ação assíncrona protegendo contra clique duplo e mostrando o erro como aviso.
async function guarded(run) {
  try { return await run(); } catch (error) { View.toast(error.message || 'Não foi possível concluir a operação.'); }
}

export const PremiumController = {
  // hooks.onRoleChange: o Controller principal redesenha abas que dependem do nível (Salvos, Downloads).
  init(callbacks = {}) {
    hooks = callbacks;
    lastRole = PremiumModel.role();
    PremiumModel.onChange(role => {
      PremiumView.updateHeader();
      PremiumView.syncAccess();
      PremiumView.syncLocks();
      if (document.body.classList.contains('profile-open')) View.profileDrawer(Model.profile);
      if (role !== lastRole) {
        const gained = ['premium', 'admin'].includes(role) && !['premium', 'admin'].includes(lastRole);
        lastRole = role;
        if (gained && !PremiumView.isOpen()) View.toast('Premium ativado! Você já pode salvar mangás e baixar capítulos.');
        hooks.onRoleChange?.(role);
      }
    });
    PremiumView.updateHeader();
    PremiumView.syncAccess();
    // Cliques e teclado do modal tratados aqui, no próprio overlay: independem dos ouvintes globais da página.
    const overlay = $('#premiumOv');
    overlay.addEventListener('click', event => {
      const element = event.target.closest('[data-premium]');
      if (element && overlay.contains(element)) {
        event.stopPropagation();
        return this.act(element.dataset.premium, element);
      }
      if (event.target === overlay) this.close();
    });
    overlay.addEventListener('keydown', event => {
      const card = event.target.closest?.('.pm-plan[data-premium]');
      if (card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); this.act(card.dataset.premium, card); }
    });
  },

  refreshUi() {
    lastRole = PremiumModel.role();
    PremiumView.updateHeader();
    PremiumView.syncAccess();
    PremiumView.syncLocks();
  },

  // Porta de entrada dos recursos pagos: libera ou abre o aviso Premium. Retorna true quando pode seguir.
  ensure(feature) {
    if (PremiumModel.can(feature)) return true;
    this.open('upsell', feature);
    return false;
  },

  // O servidor negou (403 premium_required): sincroniza o nível local e mostra o aviso.
  handleApiError(error, feature) {
    if (error?.code !== 'premium_required') return false;
    PremiumModel.refresh().catch(() => undefined);
    this.open('upsell', feature);
    return true;
  },

  /* ---------- navegação do modal ---------- */
  open(view = 'plans', feature = 'save') {
    document.body.classList.remove('menu-open');
    View.closeProfile();
    View.searchOpen(false);
    if (view === 'upsell') PremiumView.render(PremiumView.upsell(feature));
    else PremiumView.render(PremiumView.plans({ role: PremiumModel.role(), expiresAt: PremiumModel.expiresAt(), renews: PremiumModel.renews() }));
    PremiumView.open();
    PremiumModel.loadConfig().catch(() => undefined); // aquece a configuração de pagamento
    if (PremiumModel.isLoggedIn()) PremiumModel.refresh().then(result => result?.changed && this.isShowingPlans() && this.open('plans')).catch(() => undefined);
  },
  isShowingPlans: () => PremiumView.isOpen() && Boolean($('#premiumModal .pm-plans')),

  close() {
    PremiumModel.stopWatching();
    checkoutState = null;
    PremiumView.close();
  },

  async checkout() {
    if (PremiumModel.role() === 'admin') return this.open('plans');
    if (!PremiumModel.isLoggedIn()) {
      PremiumView.render(PremiumView.loginRequired());
      return PremiumView.open();
    }
    PremiumView.render(PremiumView.checkoutLoading());
    PremiumView.open();
    let config;
    try { config = await PremiumModel.loadConfig(); } catch (error) {
      return PremiumView.render(PremiumView.checkoutError(error.message));
    }
    PremiumView.render(PremiumView.checkout({ methods: config.methods, hideCard: PremiumModel.renews() }));
    checkoutState = { config };
    const first = ['pix', 'card'].find(id => PremiumView.hasMethod(id));
    if (first) this.selectMethod(first);
    if (config.methods.googlePay) {
      GooglePay.isReady(config.googlePay).then(ready => { if (ready && checkoutState?.config === config) PremiumView.showGooglePayTab(); });
    }
  },

  selectMethod(next) {
    method = next;
    PremiumView.selectMethod(next);
    if (next === 'pix') PremiumView.panel(checkoutState?.pix ? PremiumView.pixWaiting(checkoutState.pix) : PremiumView.pixIdle());
    if (next === 'card') PremiumView.panel(PremiumView.cardIdle());
    if (next === 'googlepay') this.mountGooglePay();
  },

  /* ---------- formas de pagamento ---------- */
  async startPix() {
    if (pixBusy) return;
    pixBusy = true;
    PremiumView.panel(PremiumView.busy('Gerando o código PIX...'));
    try {
      const pix = await PremiumModel.startPix();
      checkoutState = { ...checkoutState, pix };
      if (method === 'pix') PremiumView.panel(PremiumView.pixWaiting(pix));
      PremiumModel.watchActivation({ onActive: () => this.showSuccess() });
    } catch (error) {
      if (method === 'pix') PremiumView.panel(PremiumView.pixIdle());
      View.toast(error.message);
    } finally { pixBusy = false; }
  },

  async copyPix() {
    const code = $('#pmPixCode');
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.value);
      View.toast('Código PIX copiado.');
    } catch {
      code.select(); // sem permissão de área de transferência: seleciona para copiar manualmente
      View.toast('Selecione e copie o código PIX.');
    }
  },

  async startCard() {
    PremiumView.panel(PremiumView.busy('Abrindo o checkout seguro...'));
    try {
      const { url } = await PremiumModel.startCard();
      location.assign(url);
    } catch (error) {
      PremiumView.panel(PremiumView.cardIdle());
      View.toast(error.message);
    }
  },

  async mountGooglePay() {
    PremiumView.panel(PremiumView.googlePayIdle());
    const { config } = checkoutState || {};
    if (!config?.googlePay) return;
    try {
      await GooglePay.renderButton(PremiumView.gpayContainer(), config.googlePay, {
        priceCents: config.plan.priceCents, currency: config.plan.currency,
        onToken: token => this.payGooglePay(token),
        onError: error => { console.warn('[MangaKindle] Google Pay:', error); View.toast('Não foi possível concluir com o Google Pay. Tente outra forma de pagamento.'); }
      });
    } catch (error) {
      View.toast(error.message);
    }
  },

  async payGooglePay(token) {
    PremiumView.panel(PremiumView.busy('Confirmando o pagamento...'));
    try {
      const result = await PremiumModel.payWithGooglePay(token);
      if (result.after === 'premium' || result.after === 'admin') return this.showSuccess();
      throw new Error('Pagamento não confirmado. Tente novamente.');
    } catch (error) {
      if (method === 'googlepay') this.mountGooglePay();
      View.toast(error.message);
    }
  },

  async openPortal() {
    await guarded(async () => {
      const { url } = await PremiumModel.openPortal();
      location.assign(url);
    });
  },

  showSuccess() {
    PremiumView.render(PremiumView.success());
    PremiumView.open();
    View.toast('Pagamento confirmado! Premium ativado.');
  },

  // Retorno do checkout do cartão (?premium=success|cancel): confirma sem recarregar a página.
  handleReturn(status) {
    if (status === 'cancel') return View.toast('Pagamento cancelado. Você pode tentar novamente quando quiser.');
    if (status !== 'success') return;
    PremiumView.render(PremiumView.processing(false));
    PremiumView.open();
    PremiumModel.watchActivation({ onActive: () => this.showSuccess() });
    // A consulta continua em segundo plano; a tela só deixa de prometer "poucos segundos".
    setTimeout(() => {
      if (PremiumView.isOpen() && $('#premiumModal .pm-status')) PremiumView.render(PremiumView.processing(true));
    }, PROCESSING_TIMEOUT_MS);
  },

  /* ---------- despachante dos cliques [data-premium] ---------- */
  act(action, element) {
    switch (action) {
      case 'open': return this.open('plans');
      case 'checkout': return this.checkout();
      case 'close': return this.close();
      case 'method': return this.selectMethod(element.dataset.method);
      case 'plan': return PremiumView.selectPlan(element.dataset.plan);
      case 'pix': return this.startPix();
      case 'card': return this.startCard();
      case 'copy': return this.copyPix();
      case 'portal': return this.openPortal();
      case 'auth':
        this.close();
        View.closeProfile();
        View.login();
        return View.authMode(element.dataset.mode);
      default: return undefined;
    }
  },
};
