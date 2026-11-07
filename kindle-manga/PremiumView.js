import { View } from './View.js';
import { premiumModel, PLAN_PRICE, ROLE_LABEL } from './premiumModel.js';

const { $, esc } = View;
const icon = name => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const formatDate = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '';
const formatTime = ms => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const FREE_FEATURES = [['Buscar mangás sem limite', true], ['Ler mangás sem limite', true], ['Salvar mangás para ler depois', false], ['Baixar capítulos para ler offline', false]];
const PREMIUM_FEATURES = FREE_FEATURES.map(([text]) => [text, true]);
const UPSELL = {
  save: ['Salvar mangás é um recurso Premium', 'Guarde seus mangás favoritos para ler depois. Essa função está disponível apenas para assinantes Premium.'],
  download: ['Baixar capítulos é um recurso Premium', 'Baixe capítulos para ler offline, mesmo sem internet. Essa função está disponível apenas para assinantes Premium.']
};
const METHODS = [['pix', 'PIX'], ['card', 'Cartão'], ['googlepay', 'Google Pay']];

const features = items => `<ul class="pm-features">${items.map(([text, on]) =>
  `<li class="${on ? 'on' : 'off'}">${icon(on ? 'check' : 'minus')}<span>${esc(text)}</span></li>`).join('')}</ul>`;
const head = (kicker, title, text) => `<div class="pm-head"><span class="pm-kicker">${esc(kicker)}</span><h2 id="premiumTitle">${title}</h2>${text ? `<p>${esc(text)}</p>` : ''}</div>`;
const closeButton = `<button class="x" data-premium="close" aria-label="Fechar">${icon('x')}</button>`;
const backButton = `<button class="pm-back" data-premium="open" type="button">${icon('arrow-left')} Voltar aos planos</button>`;
const secureNote = '<p class="pm-fine">Pagamento processado com segurança pelo Stripe. O MangaKindle não armazena dados do seu cartão.</p>';

export const PremiumView = {
  /* ---------- contêiner do modal ---------- */
  render(html) {
    const modal = $('#premiumModal');
    modal.innerHTML = closeButton + html;
    modal.scrollTop = 0;
  },
  open() {
    $('#premiumOv').classList.add('open');
    document.body.style.overflow = 'hidden';
    $('#premiumModal').focus({ preventScroll: true });
  },
  close() {
    $('#premiumOv').classList.remove('open');
    if (!$('#ov').classList.contains('open') && !$('#reader').classList.contains('open')) document.body.style.overflow = '';
  },
  isOpen: () => $('#premiumOv').classList.contains('open'),

  /* ---------- Planos & Assinatura ---------- */
  plans({ role, expiresAt, renews }) {
    const premium = role === 'premium', admin = role === 'admin';
    const until = premium && expiresAt ? ` &middot; ativo até ${formatDate(expiresAt)}` : '';
    const action = admin
      ? '<p class="pm-note">Sua conta de administrador tem acesso total a todos os recursos, sem assinatura.</p>'
      : premium
        ? `<button class="btn pm-cta" data-premium="checkout">Renovar assinatura</button>${renews ? '<button class="btn2" data-premium="portal">Gerenciar assinatura</button>' : ''}`
        : `<button class="btn pm-cta" data-premium="checkout">Assinar por ${PLAN_PRICE}/mês</button>`;
    return `${head('MangaKindle Premium', 'Planos &amp; Assinatura', 'Leia à vontade. Com o Premium você também salva mangás e baixa capítulos para ler offline.')}
      <div class="pm-current" role="status">${icon(premium || admin ? 'star' : 'star-outline')}<span>Seu plano atual: <b>${ROLE_LABEL[role] || ROLE_LABEL.free}</b>${until}</span></div>
      <div class="pm-plans">
        <section class="pm-plan ${premium || admin ? '' : 'current'}"><h3>Gratuito</h3><p class="pm-price"><b>R$ 0</b></p>${features(FREE_FEATURES)}</section>
        <section class="pm-plan pm-plan-premium ${premium || admin ? 'current' : ''}"><span class="pm-ribbon">Recomendado</span><h3>Premium</h3><p class="pm-price"><b>${PLAN_PRICE}</b><small>/mês</small></p>${features(PREMIUM_FEATURES)}</section>
      </div>
      <div class="pm-actions">${action}</div>
      <p class="pm-fine">O PIX libera na hora e vale por 30 dias. No cartão, a renovação é mensal e você cancela quando quiser.</p>`;
  },

  // Aviso exibido quando um usuário gratuito (ou visitante) tenta salvar ou baixar.
  upsell(feature) {
    const [title, text] = UPSELL[feature] || UPSELL.save;
    return `${head('Recurso Premium', esc(title), text)}
      <p class="pm-upsell-price"><b>${PLAN_PRICE}</b> por mês</p>
      <p class="pm-note">Você continua com busca e leitura ilimitadas no plano gratuito.</p>
      <div class="pm-actions">
        <button class="btn pm-cta" data-premium="checkout">Assinar Premium</button>
        <button class="btn2" data-premium="open">Ver planos</button>
        <button class="pm-link" data-premium="close">Agora não</button>
      </div>`;
  },

  /* ---------- checkout ---------- */
  loginRequired() {
    return `${head('Quase lá', 'Entre para assinar', 'Para ativar o Premium, entre na sua conta ou crie uma. Leva menos de um minuto.')}
      <div class="pm-actions"><button class="btn pm-cta" data-premium="auth" data-mode="login">Entrar</button><button class="btn2" data-premium="auth" data-mode="signup">Criar conta</button></div>
      ${backButton}`;
  },
  checkoutLoading() {
    return `${head('Assinatura', 'Finalizar assinatura')}<p class="pm-status" role="status"><span class="pm-spin" aria-hidden="true"></span>Carregando formas de pagamento...</p>`;
  },
  checkoutError(message) {
    return `${head('Assinatura', 'Finalizar assinatura')}<div class="pm-alert" role="alert">${esc(message)}</div>
      <div class="pm-actions"><button class="btn2" data-premium="checkout">Tentar novamente</button></div>${backButton}`;
  },
  checkout({ methods, hideCard }) {
    const available = METHODS.filter(([id]) => id === 'pix' ? methods.pix : id === 'card' ? methods.card && !hideCard : methods.googlePay);
    const summary = `<div class="pm-summary"><span>${icon('star')} MangaKindle Premium</span><b>${PLAN_PRICE}<small> / mês</small></b></div>`;
    if (!available.length) {
      return `${head('Assinatura', 'Finalizar assinatura')}${summary}
        <div class="pm-alert" role="alert">Os pagamentos estão temporariamente indisponíveis. Tente novamente mais tarde.</div>${backButton}`;
    }
    return `${head('Assinatura', 'Finalizar assinatura', 'Escolha como pagar.')}${summary}
      <div class="pm-tabs" role="tablist" aria-label="Formas de pagamento">${available.map(([id, label]) =>
        `<button class="pm-tab" role="tab" id="pmTab-${id}" data-premium="method" data-method="${id}" aria-selected="false" ${id === 'googlepay' ? 'hidden' : ''}>${label}</button>`).join('')}</div>
      <div class="pm-panel" id="pmPanel" role="tabpanel" aria-live="polite"></div>
      ${secureNote}${backButton}`;
  },
  selectMethod(method) {
    document.querySelectorAll('.pm-tab').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.method === method)));
  },
  showGooglePayTab() { const tab = $('#pmTab-googlepay'); if (tab) tab.hidden = false; },
  hasMethod: method => Boolean($(`#pmTab-${method}`)),
  panel(html) { const panel = $('#pmPanel'); if (panel) panel.innerHTML = html; },

  pixIdle: () => `<p>Pague com PIX pelo aplicativo do seu banco. O Premium é liberado assim que o pagamento for confirmado e vale por 30 dias.</p>
    <button class="btn pm-cta" data-premium="pix">Gerar código PIX</button>`,
  pixWaiting({ code, image, expiresAt }) {
    return `<div class="pm-pix">
      ${image ? `<img class="pm-qr" src="${esc(image)}" alt="QR Code do PIX" width="200" height="200">` : ''}
      <label for="pmPixCode">PIX copia e cola</label>
      <div class="pm-copy"><input id="pmPixCode" readonly value="${esc(code)}"><button class="btn2" data-premium="copy" type="button">Copiar</button></div>
      <p class="pm-status" role="status"><span class="pm-spin" aria-hidden="true"></span>Aguardando a confirmação do pagamento...</p>
      <small>${expiresAt ? `O código expira às ${formatTime(expiresAt)}.` : 'O código expira em 30 minutos.'} Você não precisa recarregar a página.</small>
      <button class="pm-link" data-premium="pix" type="button">Gerar novo código</button></div>`;
  },
  cardIdle: () => `<p>Assinatura mensal no cartão, com renovação automática. Você conclui o pagamento no checkout seguro do Stripe e pode cancelar quando quiser.</p>
    <button class="btn pm-cta" data-premium="card">Pagar ${PLAN_PRICE}/mês no cartão</button>`,
  googlePayIdle: () => '<p>Pague em um toque com o Google Pay. O Premium é liberado na hora e vale por 30 dias.</p><div id="pmGPay" class="pm-gpay"></div>',
  gpayContainer: () => $('#pmGPay'),
  busy(message) { return `<p class="pm-status" role="status"><span class="pm-spin" aria-hidden="true"></span>${esc(message)}</p>`; },
  setPixStatus(message) { const status = document.querySelector('.pm-pix .pm-status'); if (status) status.lastChild.textContent = message; },

  /* ---------- resultado ---------- */
  success: () => `<div class="pm-success">${icon('star')}${head('Pagamento confirmado', 'Premium ativado!', 'Agora você pode salvar mangás e baixar capítulos para ler offline.')}
    <div class="pm-actions"><button class="btn pm-cta" data-premium="close">Continuar</button></div></div>`,
  processing: timedOut => `${head('Pagamento', 'Confirmando seu pagamento')}${timedOut
    ? '<p class="pm-note">O pagamento ainda não foi confirmado. Assim que o provedor aprovar, seu Premium será liberado automaticamente.</p><div class="pm-actions"><button class="btn2" data-premium="close">Fechar</button></div>'
    : '<p class="pm-status" role="status"><span class="pm-spin" aria-hidden="true"></span>Isso leva só alguns segundos...</p>'}`,

  /* ---------- indicadores no restante do app ---------- */
  updateHeader() {
    const button = $('#premiumBtn');
    if (!button) return;
    const role = PremiumModel.role(), paid = role === 'premium' || role === 'admin';
    button.classList.toggle('is-premium', paid);
    button.innerHTML = icon(paid ? 'star' : 'star-outline');
    const label = paid ? `Seu plano: ${ROLE_LABEL[role]}` : 'Planos & Assinatura';
    button.title = label;
    button.setAttribute('aria-label', label);
  },
  // Cartão de plano exibido na gaveta de perfil.
  profilePlan() {
    const role = PremiumModel.role(), expires = PremiumModel.expiresAt(), paid = role === 'premium' || role === 'admin';
    return `<div class="profile-plan"><span class="plan-badge plan-${role}">${icon(paid ? 'star' : 'star-outline')} ${ROLE_LABEL[role]}</span>
      ${expires ? `<small>Ativo até ${formatDate(expires)}</small>` : ''}
      <button class="btn2" data-premium="open">${paid ? 'Planos &amp; Assinatura' : 'Ver planos e assinar'}</button></div>`;
  },
  // Troca cadeado por ação normal nos botões que já estão na tela, sem recarregar nada.
  syncLocks() {
    const canSave = PremiumModel.can('save'), canDownload = PremiumModel.can('download');
    document.querySelectorAll('.fav, [data-save][data-full]').forEach(button => {
      const saved = button.classList.contains('on');
      button.classList.toggle('locked', !canSave && !saved);
      button.title = !canSave && !saved ? 'Recurso Premium: salvar para depois' : 'Salvar para depois';
      if (button.dataset.full) button.innerHTML = esc(saved ? 'Salvo' : 'Salvar para depois') + (!canSave && !saved ? '<span class="premium-tag">Premium</span>' : '');
    });
    document.querySelectorAll('.chdownload').forEach(button => {
      if (button.disabled || button.classList.contains('done') || /%$/.test(button.textContent.trim())) return;
      button.classList.toggle('locked', !canDownload);
      button.title = canDownload ? 'Baixar capítulo' : 'Recurso Premium: baixar capítulo';
      button.innerHTML = icon(canDownload ? 'download' : 'lock');
    });
  }
};
