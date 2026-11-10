import { COUNTRY, LANGS, Model } from './Model.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Ícones vêm do sprite SVG declarado em index.html
const icon = name => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
// Valor seguro para url('...') dentro de um atributo style
const cssUrl = value => `url('${esc(String(value ?? '').replace(/[^\w\-./:?=&%~+@]/g, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')))}')`;
// Fotos de perfil: somente links http(s) ou imagens raster em base64
const SAFE_IMAGE = /^(https?:\/\/|data:image\/(?:jpeg|png|gif|webp);base64,)/i;
const score = (value, digits = 1) => Number(value) > 0 ? Number(value).toFixed(digits) : '';

const GEN_PT = { Action: 'Ação', Adventure: 'Aventura', Comedy: 'Comédia', Drama: 'Drama', Fantasy: 'Fantasia', Horror: 'Terror', Mystery: 'Mistério', Romance: 'Romance', 'Sci-Fi': 'Ficção científica', 'Slice of Life': 'Cotidiano', Sports: 'Esportes', Psychological: 'Psicológico', Supernatural: 'Sobrenatural', Historical: 'Histórico', Thriller: 'Suspense', Tragedy: 'Tragédia', Magic: 'Magia', Crime: 'Crime', Superhero: 'Super-herói', Music: 'Música', Mecha: 'Mecha', Isekai: 'Isekai' };
const STATUS = { ongoing: 'Em andamento', completed: 'Completo', hiatus: 'Em hiato', cancelled: 'Cancelado' };
const BOOKMARK = '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>';
const saveLabel = on => on ? 'Salvo' : 'Salvar para depois';
// Quem não é Premium vê o recurso marcado, mas o clique abre a oferta em vez de salvar.
const PREMIUM_TAG = '<span class="premium-tag">Premium</span>';
const saveLocked = on => !on && !ctx.can('save');
const saveContent = on => esc(saveLabel(on)) + (saveLocked(on) ? PREMIUM_TAG : '');
const loopHtml = items => items.map(renderCard).join('').repeat(2);

export const THEMES = [
  { id: 'lilac', name: 'Lilás Minimalista', group: 'Temas claros', bg: '#F4F2FA', accent: '#8B5CF6', cards: '#FFFFFF', description: 'Elegante, leve e combina com a identidade original.', badge: 'Recomendado' },
  { id: 'ocean', name: 'Ocean Blue', group: 'Temas claros', bg: '#F1F5F9', accent: '#2563EB', cards: '#FFFFFF', description: 'Azul profissional, limpo e confortável.' },
  { id: 'sunset', name: 'Sunset', group: 'Temas claros', bg: '#FFF7ED', accent: '#EA580C', cards: '#FFFFFF', description: 'Tons quentes e acolhedores.' },
  { id: 'forest', name: 'Forest', group: 'Temas claros', bg: '#ECFDF5', accent: '#059669', cards: '#FFFFFF', description: 'Verde suave, natural e relaxante.' },
  { id: 'sakura', name: 'Sakura', group: 'Temas claros', bg: '#FFF1F2', accent: '#E11D48', cards: '#FFFFFF', description: 'Inspirado na estética japonesa e nos animes.' },
  { id: 'vintage', name: 'Vintage', group: 'Temas claros', bg: '#FAF7F0', accent: '#A16207', cards: '#FFFFFF', description: 'Visual de papel, livros e leitura tradicional.' },
  { id: 'purple-night', name: 'Purple Night', group: 'Temas escuros', bg: '#111111', accent: '#8B5CF6', cards: '#252033', description: 'Moderno, elegante e mantém a identidade original.', badge: 'Minha escolha' },
  { id: 'cyberpunk', name: 'Cyberpunk', group: 'Temas escuros', bg: '#080D18', accent: '#06B6D4', cards: '#17243B', description: 'Estética futurista com detalhes neon.' },
  { id: 'dark-forest', name: 'Dark Forest', group: 'Temas escuros', bg: '#101713', accent: '#22C55E', cards: '#1D3025', description: 'Escuro com verde esmeralda.' },
  { id: 'crimson', name: 'Crimson', group: 'Temas escuros', bg: '#171114', accent: '#F43F5E', cards: '#30202A', description: 'Visual intenso, dramático e marcante.' },
  { id: 'amoled', name: 'AMOLED', group: 'Temas escuros', bg: '#000000', accent: '#D4D4D4', cards: '#171717', description: 'Minimalista, preto absoluto e alto contraste.' },
  { id: 'galaxy', name: 'Galaxy', group: 'Temas escuros', bg: '#171522', accent: '#C084FC', cards: '#29243D', description: 'Roxo espacial, suave e sofisticado.' }
];

let ctx = { isSaved: () => false, progressOf: () => null, isChapterRead: () => false, isChapterDownloaded: () => false }, heroTimer;

function renderCard(m) {
  const progress = ctx.progressOf(m.id), rating = score(m.rating);
  return `<div class="card" data-id="${esc(m.id)}" tabindex="0" role="button"><div class="cover">
      <img class="ok" loading="lazy" draggable="false" alt="Capa de ${esc(m.title)}" src="${esc(m.cover)}">
      ${rating ? `<span class="badge">${icon('star')} ${rating}</span>` : ''}
      <button class="fav ${ctx.isSaved(m.id) ? 'on' : ''}${saveLocked(ctx.isSaved(m.id)) ? ' locked' : ''}" data-save="${esc(m.id)}" aria-label="${saveLocked(ctx.isSaved(m.id)) ? 'Recurso Premium: salvar para depois' : 'Salvar para depois'}" title="${saveLocked(ctx.isSaved(m.id)) ? 'Recurso Premium: salvar para depois' : 'Salvar para depois'}">${BOOKMARK}</button></div>
      <h3>${esc(m.title)}</h3>${progress ? `<small>Cap. ${esc(progress.chNum)} · pág. ${esc(progress.page)}</small>` : ''}</div>`;
}

const preferences = guest => `<div class="profile-preferences"><h3>Personalização</h3>
    <label>Tema</label><button class="btn2 theme-choice-button" data-theme-picker>${guest ? 'Escolher entre 12 temas' : 'Escolher tema'}</button>
    <label for="cLang">Idioma dos mangás</label><select id="cLang">${LANGS.map(([code, name]) => `<option value="${code}" ${code === Model.cfg.lang ? 'selected' : ''}>${name}</option>`).join('')}</select>
    <label for="cTextSize">Tamanho do texto</label><select id="cTextSize">${[['small', 'Pequeno'], ['normal', 'Normal'], ['large', 'Grande']].map(([value, label]) => `<option value="${value}" ${Model.textSize === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
    <label>Movimento</label><button class="toggle ${Model.animations ? 'on' : ''}" id="animationToggle" role="switch" aria-checked="${Model.animations}"><span></span>Ativar animações</button>
  </div>`;

const authLogo = '<div class="auth-logo"><img class="brand-logo" src="assets/logo.png" alt=""><span>Manga <b>Kindle</b></span></div>';
const authClose = `<button class="auth-close" data-auth-close type="button" aria-label="Voltar">${icon('x')}</button>`;

export const View = {
  $, esc,
  init(context) {
    ctx = context;
    // Oculta a logo quando o arquivo não existe (substitui o handler inline, bloqueado pela CSP)
    document.addEventListener('error', event => { if (event.target.matches?.('img.brand-logo')) event.target.hidden = true; }, true);
    document.querySelectorAll('img.brand-logo').forEach(image => { if (image.complete && !image.naturalWidth) image.hidden = true; });
  },

  /* ---------- tema e estrutura da página ---------- */
  theme(id) {
    const selected = THEMES.some(theme => theme.id === id) ? id : id === 'light' ? 'lilac' : 'purple-night';
    document.documentElement.dataset.theme = selected;
    const button = $('#themeBtn');
    if (button) button.innerHTML = `${icon('palette')} <span>${esc(THEMES.find(theme => theme.id === selected)?.name || 'Tema')}</span>`;
  },
  themePicker() {
    View.closeProfile();
    document.body.classList.remove('menu-open');
    const current = document.documentElement.dataset.theme;
    const card = theme => `<button class="theme-card ${current === theme.id ? 'selected' : ''}" data-theme-choice="${theme.id}" style="--preview-bg:${theme.bg};--preview-accent:${theme.accent};--preview-card:${theme.cards}" aria-pressed="${current === theme.id}">
        <span class="theme-preview"><i></i><b></b><em></em></span><span class="theme-card-info"><strong>${esc(theme.name)}</strong>${theme.badge ? `<small>${theme.badge}</small>` : ''}<span>${esc(theme.description)}</span><small>Fundo · Destaque</small></span></button>`;
    const groups = [...new Set(THEMES.map(theme => theme.group))];
    $('#modal').className = 'modal theme-modal';
    $('#modal').innerHTML = `<button class="x" data-close aria-label="Fechar">${icon('x')}</button>
      <div class="theme-modal-head"><span class="theme-kicker">Personalização</span><h2>Escolha seu tema</h2><p>As cores são aplicadas em toda a experiência e ficam salvas neste dispositivo.</p></div>
      <div class="theme-modal-scroll">${groups.map(group => `<section class="theme-group"><h3>${icon(group === 'Temas escuros' ? 'moon' : 'sun')} ${group}</h3><div class="theme-grid">${THEMES.filter(theme => theme.group === group).map(card).join('')}</div></section>`).join('')}</div>`;
    $('#ov').classList.add('open');
    document.body.style.overflow = 'hidden';
  },
  textSize(size) { document.documentElement.dataset.textSize = size; },
  animations(enabled) { document.body.classList.toggle('no-animations', !enabled); },
  searchOpen(open) {
    document.body.classList.toggle('search-open', open);
    const button = $('#searchBtn');
    if (button) button.setAttribute('aria-expanded', String(open));
    const close = $('#searchClose');
    if (close) close.hidden = !open;
    if (!open) $('#q').value = '';
  },
  avatar(photoUrl, username = 'Perfil') {
    const button = $('#avBtn');
    if (!button) return;
    const avatar = button.querySelector('.avatar');
    if (avatar) avatar.innerHTML = SAFE_IMAGE.test(photoUrl || '') ? `<img src="${esc(photoUrl)}" alt="">` : icon('user');
    const name = button.querySelector('.profile-name');
    if (name) name.textContent = username || 'Perfil';
  },
  tab(tab) { // marca a aba ativa (inclusive no menu mobile)
    clearInterval(heroTimer);
    scrollTo(0, 0);
    document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('on', button.dataset.tab === tab));
  },
  main(html) { $('#main').innerHTML = html; },
  toast(message) {
    document.querySelector('.toast')?.remove();
    const toast = Object.assign(document.createElement('div'), { className: 'toast', textContent: message });
    document.body.append(toast);
    setTimeout(() => toast.remove(), 2400);
  },
  confirm(message) {
    const box = $('#confirm');
    $('#confirmText').textContent = message;
    box.classList.add('open');
    return new Promise(resolve => {
      const finish = result => {
        box.classList.remove('open');
        $('#confirmOk').onclick = $('#confirmCancel').onclick = null;
        resolve(result);
      };
      $('#confirmOk').onclick = () => finish(true);
      $('#confirmCancel').onclick = () => finish(false);
    });
  },
  skeleton: count => '<div class="skel"></div>'.repeat(count),
  errBox: (what = 'tab') => `<div class="msg">Não foi possível carregar os dados.<br><button data-retry="${what}">Tentar novamente</button></div>`,

  /* ---------- cards e carrosséis ---------- */
  card: renderCard,
  contCard(p) {
    const percent = Math.min(100, Number(p.page) / Number(p.total) * 100) || 0;
    return `<div class="card" data-id="${esc(p.id)}" tabindex="0" role="button"><div class="cover"><img src="${esc(p.manga?.cover)}" alt="" class="ok" loading="lazy" draggable="false"><div class="bar" style="width:${percent}%"></div></div><h3>${esc(p.manga?.title)}</h3><small>Cap. ${esc(p.chNum)} · pág. ${esc(p.page)}/${esc(p.total)}</small></div>`;
  },
  car: (inner, loop = true) => `<div class="car"><button class="nav l" data-dir="-1" aria-label="Anterior">${icon('chevron-left')}</button><div class="row${loop ? ' loop' : ' reading'}" ${loop ? 'data-loop' : ''}>${loop ? inner + inner : inner}</div><button class="nav r" data-dir="1" aria-label="Próximo">${icon('chevron-right')}</button></div>`,
  scrollRow(button) {
    const row = button.parentElement.querySelector('.row');
    row.scrollBy({ left: +button.dataset.dir * row.clientWidth * .85, behavior: 'smooth' });
  },
  enhanceCarousel(row) {
    if (!row) return;
    const focus = () => {
      const edge = row.clientWidth * .06;
      [...row.children].forEach(card => {
        const left = card.offsetLeft - row.scrollLeft, right = left + card.offsetWidth;
        const fullyVisible = left >= edge && right <= row.clientWidth - edge;
        card.classList.toggle('is-focus', fullyVisible);
        card.classList.toggle('is-near', !fullyVisible);
      });
      if (row.dataset.loop) { // carrossel infinito: volta ao início ao passar da metade duplicada
        const half = row.scrollWidth / 2;
        if (row.scrollLeft >= half) row.scrollLeft -= half;
      }
    };
    if (!row.dataset.enhanced) {
      row.dataset.enhanced = '1';
      row.addEventListener('scroll', () => requestAnimationFrame(() => row._focusCarousel?.()), { passive: true });
    }
    row._focusCarousel = focus;
    requestAnimationFrame(() => {
      if (row.dataset.loop && !row.dataset.positioned && row.firstElementChild) {
        row.dataset.positioned = '1';
        row.scrollLeft = row.firstElementChild.offsetWidth / 2;
      }
      focus();
    });
  },
  syncSaved(id, on) { // atualiza todos os botões de salvar daquele mangá
    document.querySelectorAll(`[data-save="${CSS.escape(String(id))}"]`).forEach(button => {
      button.classList.toggle('on', on);
      button.classList.toggle('locked', saveLocked(on));
      if (button.dataset.full) button.innerHTML = saveContent(on);
    });
  },

  /* ---------- início e recomendações ---------- */
  home(progress, sections, showRecommendations = false) {
    View.tab('home');
    View.main(`<div class="hero" id="hero"><div class="skel"></div></div>` +
      (progress.length ? `<h2>Continuar lendo</h2>${View.car(progress.map(View.contCard).join(''), false)}` : '') +
      `<h2>Gêneros</h2><div class="chips" id="genres"></div>` +
      (showRecommendations ? `<section class="reco-section" id="homeRecommendations"><h2>Porque você salvou</h2><div class="row loop" id="homeRecommendationRow" data-loop>${View.skeleton(6)}</div></section>` : '') +
      sections.map(([title], i) => `<section class="${title.includes('Próximos') ? 'future-releases' : ''}" data-i="${i}"><h2>${esc(title)}</h2>${View.car(View.skeleton(8))}</section>`).join(''));
    document.querySelectorAll('.row').forEach(View.enhanceCarousel);
    return [...document.querySelectorAll('section[data-i]')];
  },
  genres(list) {
    $('#genres').innerHTML = list.map(tag => {
      const label = esc(GEN_PT[tag.n] || tag.n);
      return `<button class="chip" data-tag="${esc(tag.id)}" data-tag-name="${esc(tag.n)}" data-n="${label}">${label}</button>`;
    }).join('');
  },
  genresFail() { $('#genres')?.remove(); },
  fillSection(el, items) {
    const row = el.querySelector('.row');
    row.innerHTML = loopHtml(items);
    View.enhanceCarousel(row);
  },
  fillHomeRecommendations(sections) {
    const section = $('#homeRecommendations'), row = $('#homeRecommendationRow');
    if (!section || !row) return;
    const first = sections.find(item => item.items?.length);
    if (!first) return section.remove();
    section.querySelector('h2').textContent = first.title;
    row.innerHTML = loopHtml(first.items);
    View.enhanceCarousel(row);
  },
  recoLoading() {
    View.tab('reco');
    View.main(`<h2>Para você</h2><div class="reco-loading">${View.skeleton(6)}</div>`);
  },
  recoEmpty() {
    View.tab('reco');
    View.main('<section class="reco-empty"><h2>Para você</h2><p>Ainda não temos o suficiente para recomendar. Navegue um pouco mais: busque, salve ou leia mangás e voltamos com sugestões feitas para você.</p><div class="acts"><button class="btn" data-tab="home">Explorar o início</button><button class="btn2" id="recoSearch">Buscar mangás</button></div></section>');
  },
  recoError() {
    View.tab('reco');
    View.main(`<h2>Para você</h2>${View.errBox('reco')}`);
  },
  recoTab(sections) {
    View.tab('reco');
    const latest = Model.recommendationSearches()[0];
    const notice = latest ? `<div class="msg reco-search-notice">Sua busca por “${esc(latest.termo)}” foi usada para atualizar suas recomendações.</div>` : '';
    const html = sections.length
      ? sections.map(section => `<section class="reco-section"><h2>${esc(section.title)}</h2>${section.reason ? `<p class="reco-reason">${esc(section.reason)}</p>` : ''}${View.car(section.items.map(View.card).join(''))}</section>`).join('')
      : '<section class="reco-empty"><h2>Para você</h2><p>Ainda não encontramos sugestões compatíveis. Continue explorando para melhorar suas recomendações.</p><button class="btn2" id="refreshReco">Atualizar recomendações</button></section>';
    View.main(`<div class="reco-head"><h1>Para você</h1><button class="btn2" id="refreshReco">Atualizar recomendações</button></div>${notice}${html}`);
  },
  sectionError(el) { el.querySelector('.row').innerHTML = View.errBox('tab'); },
  removeEl(el) { el?.remove(); },
  hero(items) { // banner rotativo de destaques
    const box = $('#hero');
    if (!box) return;
    clearInterval(heroTimer);
    const slides = items.slice(0, 6);   // era: items.filter(item => item.desc).slice(0, 6)
    if (!slides.length) return box.remove();
    box.innerHTML = slides.map((m, i) => `<div class="slide ${i ? '' : 'on'}"><div class="bg" style="background-image:${cssUrl(m.coverBig)}"></div>
      <img src="${esc(m.coverBig)}" alt="Capa de ${esc(m.title)}" draggable="false"><div class="info">
      <h3>${esc(m.title)}</h3><div class="meta">${score(m.rating) ? `${icon('star')} ${score(m.rating)} · ` : ''}${esc(m.tags.slice(0, 3).map(tag => GEN_PT[tag] || tag).join(' · '))}</div>
      <p>${m.desc ? `<p>${esc(m.desc)}</p>` : ''}<button class="btn" data-id="${esc(m.id)}">Ver detalhes</button></div></div>`).join('') +
      `<div class="dots">${slides.map((_, i) => `<button data-dot="${i}" class="${i ? '' : 'on'}" aria-label="Destaque ${i + 1}"></button>`).join('')}</div>`;
    let current = 0, startX = 0;
    const show = n => {
      current = (n + slides.length) % slides.length;
      box.querySelectorAll('.slide').forEach((slide, i) => slide.classList.toggle('on', i === current));
      box.querySelectorAll('.dots button').forEach((dot, i) => dot.classList.toggle('on', i === current));
    };
    const play = () => { clearInterval(heroTimer); heroTimer = setInterval(() => show(current + 1), 6500); };
    box.onclick = e => {
      const dot = e.target.closest('[data-dot]');
      if (dot) { show(+dot.dataset.dot); play(); }
    };
    box.onmouseenter = () => clearInterval(heroTimer);
    box.onmouseleave = play;
    box.ontouchstart = e => { startX = e.touches[0].clientX; };
    box.ontouchend = e => {
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 40) { show(current + (dx < 0 ? 1 : -1)); play(); }
    };
    play();
  },

  /* ---------- listagem com "Carregar mais" ---------- */
  gridShell(title, wide, isSearch = false, isGenre = false) {
    View.tab('home');
    const back = isSearch ? `<button class="search-back" data-search-back>${icon('arrow-left')} Voltar</button>`
      : isGenre ? `<button class="search-back" data-home-back>${icon('arrow-left')} Voltar para o início</button>` : '';
    View.main(`${back}<h2>${esc(title)}</h2><div class="grid ${wide ? 'g2' : ''}" id="g">${View.skeleton(wide ? 6 : 12)}</div><div id="mm"></div>`);
  },
  gridAdd(items, first, hasMore) {
    const grid = $('#g');
    if (first) grid.innerHTML = '';
    if (!items.length && first) grid.innerHTML = '<div class="msg">Nenhum mangá encontrado neste idioma.</div>';
    grid.insertAdjacentHTML('beforeend', items.map(View.card).join(''));
    $('#mm').innerHTML = hasMore ? '<button class="more" data-more>Carregar Mais</button>' : '';
  },
  moreLoading() {
    const button = $('[data-more]');
    if (button) { button.disabled = true; button.textContent = 'Carregando…'; }
  },
  gridError() { $('#g').innerHTML = View.errBox('tab'); $('#mm').innerHTML = ''; },

  /* ---------- salvos e downloads ---------- */
  saved(list) {
    View.tab('saved');
    View.main('<h2>Salvos para ler depois</h2>' + (list.length ? `<div class="grid">${list.map(View.card).join('')}</div>`
      : ctx.can('save') ? '<div class="msg">Nada salvo ainda.<br>Toque no marcador de qualquer capa para guardar aqui.</div>'
        : '<div class="msg premium-lock">Salvar mangás para ler depois é um recurso Premium.<br><button class="btn" data-premium="open">Conhecer o Premium</button></div>'));
  },
  downloads(list) {
    View.tab('downloads');
    const actions = `<div class="download-actions"><button class="btn2" id="toggleDownloadSelect">${icon('list')} Selecionar</button><div class="download-selection" id="downloadSelection" hidden><label><input type="checkbox" id="selectAllDownloads"><span>Selecionar tudo</span></label><button class="download-clear" id="clearDownloadSelection">Voltar</button><button class="download-delete" id="deleteSelectedDownloads">Excluir</button></div></div>`;
    const item = d => `<div class="download-item" data-download-open="${esc(d.chapterId)}">
        <label class="download-check" hidden><input type="checkbox" data-download-select="${esc(d.chapterId)}" aria-label="Selecionar capítulo ${esc(d.num)}"></label>
        <span class="download-cover">${d.manga?.cover ? `<img class="ok" src="${esc(d.manga.cover)}" alt="">` : icon('image')}</span>
        <span class="download-info"><b>${esc(d.manga?.title || 'Mangá')}</b><small>Cap. ${esc(d.num)}${d.title ? ` · ${esc(d.title)}` : ''}</small><small class="download-status">${d.localAvailable ? 'Disponível offline neste dispositivo' : 'Registrado em outro aparelho'}</small></span><span class="download-arrow">${icon('chevron-right')}</span>
      </div>`;
    View.main(`<div class="downloads-head"><h2>Downloads</h2>${list.length ? actions : ''}</div>` +
      (list.length ? `<div class="download-list">${list.map(item).join('')}</div>` : (ctx.can('download') ? '<div class="msg">Nenhum capítulo baixado ainda.<br>Baixe capítulos na tela de detalhes para ler offline.</div>'
        : '<div class="msg premium-lock">Baixar capítulos para ler offline é um recurso Premium.<br><button class="btn" data-premium="open">Conhecer o Premium</button></div>')));
  },

  /* ---------- autenticação e perfil ---------- */
  showAuth(html) {
    const screen = $('#authScreen');
    document.body.classList.add('auth-required');
    screen.hidden = false;
    screen.style.display = '';
    screen.innerHTML = html;
  },
  login() {
    View.showAuth(`<div class="auth-card">${authClose}${authLogo}
      <p class="auth-kicker">Seu próximo capítulo começa aqui</p>
      <div class="auth-tabs"><button class="on" data-auth-mode="login">Já tenho conta</button><button data-auth-mode="signup">Criar conta</button></div>
      <div id="authLogin">
        <h1>Bem-vindo de volta</h1>
        <p class="auth-copy">Entre usando seu e-mail e senha.</p>
        <label for="authLoginEmail">E-mail</label>
        <input id="authLoginEmail" type="email" maxlength="254" autocomplete="email" placeholder="voce@exemplo.com" required>
        <label for="authLoginPassword">Senha</label>
        <input id="authLoginPassword" type="password" minlength="8" autocomplete="current-password" required>
      </div>
      <div id="authSignup" hidden>
        <h1>Crie seu perfil</h1>
        <p class="auth-copy">Seus dados serão sincronizados entre navegadores.</p>
        <label for="authName">Nome</label>
        <input id="authName" type="text" maxlength="100" autocomplete="name" placeholder="Seu nome">
        <label for="authEmail">E-mail</label>
        <input id="authEmail" type="email" maxlength="254" autocomplete="email" placeholder="voce@exemplo.com">
        <label for="authSignupPassword">Senha</label>
        <input id="authSignupPassword" type="password" minlength="8" autocomplete="new-password" required>
      </div>
      <button class="btn auth-submit" id="authSave">Entrar</button>
      <div class="social-divider"><span>ou continue com</span></div>
      <div class="social-actions"><button class="social-btn google-btn" data-social="google"><span class="google-mark">G</span> Entrar com o Google</button></div>
      <p class="auth-hint">O e-mail precisa ter um domínio válido para cadastro.</p>
    </div>`);
    $('#authLoginEmail').focus();
  },
  socialProfile(profile) {
    View.showAuth(`<div class="auth-card">${authClose}${authLogo}
      <p class="auth-kicker">Login com Google concluído</p>
      <h1>Crie seu perfil</h1>
      <p class="auth-copy">Escolha o nome que será exibido no seu perfil.</p>
      <label for="socialEmail">E-mail</label>
      <input id="socialEmail" type="email" value="${esc(profile.email)}" readonly>
      <label for="socialUsername">Username</label>
      <input id="socialUsername" type="text" maxlength="24" autocomplete="username" placeholder="seu.username" required>
      <button class="btn auth-submit" id="authSave">Continuar</button>
    </div>`);
    $('#socialUsername').focus();
  },
  authMode(mode) {
    const login = mode === 'login';
    $('#authLogin').hidden = !login;
    $('#authSignup').hidden = login;
    $('#authSave').textContent = login ? 'Entrar' : 'Criar conta';
    document.querySelectorAll('[data-auth-mode]').forEach(button => button.classList.toggle('on', button.dataset.authMode === mode));
    (login ? $('#authLoginEmail') : $('#authName')).focus();
  },
  hideLogin() {
    const screen = $('#authScreen');
    document.body.classList.remove('auth-required');
    screen.hidden = true;
    screen.style.display = 'none';
    screen.replaceChildren();
  },
  cropModal(src) {
    View.closeCrop();
    document.body.insertAdjacentHTML('beforeend', `<div class="crop-overlay" id="cropModal">
      <div class="crop-modal" role="dialog" aria-modal="true" aria-labelledby="cropTitle">
        <div class="crop-head"><div><strong id="cropTitle">Ajustar foto</strong><small>Arraste a imagem e use o zoom para posicionar.</small></div><button class="icon-btn" data-crop-cancel aria-label="Cancelar">${icon('x')}</button></div>
        <div class="crop-stage" id="cropStage"><div class="crop-guide"></div><img id="cropImage" src="${esc(src)}" alt="Prévia da foto"></div>
        <label class="crop-zoom" for="cropZoom"><span>Zoom</span><input id="cropZoom" type="range" min="1" max="3" step=".01" value="1"></label>
        <div class="crop-actions"><button class="btn2" data-crop-cancel>Cancelar</button><button class="btn" data-crop-confirm>Usar esta foto</button></div>
      </div>
    </div>`);
  },
  closeCrop() { $('#cropModal')?.remove(); },
  profilePhoto: p => SAFE_IMAGE.test(String(p.photoUrl || '')) ? `<img src="${esc(p.photoUrl)}" alt="Foto de perfil">` : icon('user'),
  profileDrawer(p) {
    const readonly = (id, label, type, value) => `<label for="${id}">${label}</label><input type="${type}" id="${id}" readonly value="${esc(value)}">`;
    $('#profileDrawerContent').innerHTML = p.username && p.email
      ? `<div class="profile-drawer-avatar">${View.profilePhoto(p)}</div>
        <div class="profile-summary"><strong>${esc(p.name || p.username)}</strong><small>@${esc(p.username)}</small></div>
        ${ctx.planCard?.(p) ?? ''}
        <label class="file-button" for="pPhotoFile">Adicionar imagem da galeria ou arquivos</label><input class="file-input" id="pPhotoFile" type="file" accept="image/*">
        ${readonly('pUsername', 'Nome de Usuário', 'text', p.username)}${readonly('pEmail', 'E-mail', 'email', p.email)}
        <div class="profile-id"><small>ID do usuário</small><code>${esc(p.id)}</code></div>
        ${preferences(false)}
        <div class="profile-actions"><button class="btn2" id="logoutBtn">Sair</button></div>`
      : `<div class="profile-guest">
          <div class="profile-drawer-avatar">${icon('user')}</div><h2>Entre na sua conta</h2>
          <p>Salve mangás, acompanhe seu progresso e sincronize suas preferências.</p>
          <div class="profile-auth-actions"><button class="btn" data-open-auth="login">Entrar</button><button class="btn2" data-open-auth="signup">Cadastrar</button></div>
        </div>${preferences(true)}`;
    $('#profileDrawer').classList.add('open');
    document.body.classList.add('profile-open');
  },
  closeProfile() {
    $('#profileDrawer').classList.remove('open');
    document.body.classList.remove('profile-open');
  },

  /* ---------- modal de detalhes ---------- */
  modal(m, saved) {
    const country = COUNTRY[m.lang];
    const fact = (label, value, id = '') => `<div class="fact"><small>${label}</small><b ${id ? `id="${id}"` : ''}>${value}</b></div>`;
    $('#modal').className = 'modal';
    $('#modal').innerHTML = `<div class="mhead"><div class="mbg" style="background-image:${cssUrl(m.coverBig)}"></div>
      <button class="x" data-close aria-label="Fechar">${icon('x')}</button>
      <div class="cover"><img class="ok" alt="" src="${esc(m.cover)}"></div>
      <div class="mt"><h1>${esc(m.title)}</h1><div class="alt">${esc(m.alts.slice(0, 3).join(' · '))}</div>
        <div class="acts"><button class="btn" id="readBtn" disabled>Carregando capítulos…</button>
        <button class="btn2 ${saved ? 'on' : ''}${saveLocked(saved) ? ' locked' : ''}" data-save="${esc(m.id)}" data-full="1">${saveContent(saved)}</button>
        <button class="btn2" data-share="${esc(m.id)}">Compartilhar</button></div></div></div>
      <div class="mbody"><div class="facts">
        ${fact('Nota dos usuários', score(m.rating, 2) ? `${score(m.rating, 2)} / 10` : '—', 'fRate')}
        ${fact('Formato', m.tags.includes('Full Color') ? 'Colorido' : 'Preto e branco')}
        ${fact('País de origem', country ? `${country[0]} · ${country[1]}` : esc(m.lang))}
        ${fact('Autor(es)', esc(m.authors.join(', ') || '—'))}
        ${fact('Arte', esc(m.artists.join(', ') || '—'))}
        ${fact('Revista / Editora', '…', 'fMag')}
        ${fact('Ano de criação', esc(m.year || '—'))}
        ${fact('Publicação', STATUS[m.status] || '—', 'fPub')}
        ${fact('Capítulos', '…', 'fCh')}</div>
      <div class="tags">${m.tags.slice(0, 8).map(tag => `<span>${esc(GEN_PT[tag] || tag)}</span>`).join('')}</div>
      <div class="desc" id="desc">${esc(m.desc || 'Sem sinopse disponível.')}</div><small class="hint tr" id="dNote"></small>
      <div class="chlist" id="chl"></div></div>`;
    $('#ov').classList.add('open');
    document.body.style.overflow = 'hidden';
    $('#modal').scrollTop = 0;
  },
  closeModal() {
    $('#ov').classList.remove('open');
    if (!$('#reader').classList.contains('open')) document.body.style.overflow = '';
  },
  fact(id, value) { const el = $('#' + id); if (el) el.textContent = value; },
  synopsis(text, note) {
    if (text != null) $('#desc').textContent = text;
    $('#dNote').textContent = note || '';
  },
  modalChapters(chapters, current, progress, sort = 'recent') {
    const readButton = $('#readBtn');
    if (!readButton) return;
    $('#fCh') && ($('#fCh').textContent = chapters.length);
    if (!chapters.length) { readButton.textContent = 'Sem capítulos neste idioma'; return; }
    readButton.disabled = false;
    readButton.textContent = progress ? `Continuar · Cap. ${chapters[current].num}, pág. ${progress.page}` : 'Começar a ler';
    const mangaId = Model.current?.id;
    const row = (chapter, i) => {
      const secondary = chapter.source === 'Secondary', done = ctx.isChapterDownloaded(chapter.id), locked = !done && !ctx.can('download');
      return `<div class="chrow">
        <button data-ch="${i}" class="${ctx.isChapterRead(mangaId, chapter.id) ? 'read' : ''}">Cap. ${esc(chapter.num)}</button>
        <button class="chdownload ${done ? 'done' : ''}${locked && !secondary ? ' locked' : ''}" data-download-ch="${i}" data-download-id="${esc(chapter.id)}" ${secondary ? 'disabled' : ''} title="${secondary ? 'Leitura secundária indisponível offline' : done ? 'Remover download' : locked ? 'Recurso Premium: baixar capítulo' : 'Baixar capítulo'}">${icon(secondary ? 'minus' : done ? 'check' : locked ? 'lock' : 'download')}</button>
      </div>`;
    };
    $('#chl').innerHTML = `<div class="chapter-toolbar"><label for="chapterSort">Ordenar capítulos</label><select id="chapterSort" aria-label="Ordenar capítulos"><option value="recent">Mais recentes primeiro</option><option value="oldest">Mais antigos primeiro</option><option value="az">A – Z</option><option value="za">Z – A</option></select></div><div class="chapter-items">${chapters.map(row).join('')}</div>`;
    $('#chapterSort').value = sort;
  },
  chapterDownloadState(id, state, text = '') {
    const button = document.querySelector(`[data-download-id="${CSS.escape(String(id))}"]`);
    if (!button) return;
    button.classList.toggle('done', state === 'done');
    button.disabled = state === 'loading';
    button.classList.toggle('locked', state === 'available' && !ctx.can('download'));
    button.innerHTML = text ? esc(text) : icon(state === 'done' ? 'check' : ctx.can('download') ? 'download' : 'lock');
    button.title = state === 'done' ? 'Remover download' : ctx.can('download') ? 'Baixar capítulo' : 'Recurso Premium: baixar capítulo';
  },
  modalChaptersError() {
    const button = $('#readBtn');
    if (button) button.textContent = 'Erro ao carregar capítulos';
  },

  /* ---------- leitor ---------- */
  readerOpen(title, chapters) {
    $('#reader').classList.add('open');
    $('#reader').classList.remove('chrome-hidden');
    document.body.style.overflow = 'hidden';
    $('#rbar').classList.remove('hide');
    $('#rTitle').textContent = title;
    $('#rChap').innerHTML = chapters.map((c, i) => `<option value="${i}">Cap. ${esc(c.num)}</option>`).join('');
  },
  readerClose() {
    $('#reader').classList.remove('open');
    $('#panel').classList.remove('open');
    document.body.style.overflow = '';
  },
  readerChapter(i) { $('#rChap').value = i; },
  togglePanel() { $('#panel').classList.toggle('open'); },
  toggleBar() { $('#reader').classList.toggle('chrome-hidden'); },
  readerLoading() { $('#stage').innerHTML = '<div class="msg" style="color:#aaa">Carregando páginas…</div>'; },
  readerError() { $('#stage').innerHTML = View.errBox('reader'); },
  readerSettings(rs) {
    $('#reader').style.setProperty('--rbg', rs.bg);
    $('#stage').style.setProperty('--br', rs.br + '%');
    $('#sBr').value = rs.br;
    const mark = (selector, key, value) => document.querySelectorAll(selector).forEach(button => button.classList.toggle('on', button.dataset[key] === value));
    mark('#sBg button', 'rbg', rs.bg);
    mark('#sDir button', 'rd', rs.dir);
    mark('#sLayout button', 'rl', rs.layout);
    mark('#sQ button', 'rq', rs.q);
    $('#sProg').classList.toggle('on', rs.progress !== false);
    $('#sProg').textContent = rs.progress === false ? 'Exibir' : 'Ocultar';
    $('#reader').classList.toggle('progress-hidden', rs.progress === false);
  },
  readerH() { // estilo Kindle: uma ou duas páginas por vez
    const stage = $('#stage'), double = Model.reader.layout === 'double';
    stage.className = 'h';
    stage.classList.toggle('double', double);
    stage.innerHTML = '<div class="zone l" data-z="l"></div><div class="zone c" data-z="c"></div><div class="zone r" data-z="r"></div>' +
      '<img class="page-image" alt="">'.repeat(double ? 2 : 1);
  },
  readerShow(url, preload) {
    const images = [...document.querySelectorAll('#stage.h .page-image')];
    images.forEach((image, i) => {
      const source = i === 0 ? url : (preload[0] || '');
      image.style.opacity = .3;
      image.hidden = !source;
      if (source) image.src = source;
      image.onload = () => { image.style.opacity = 1; };
    });
    preload.forEach(src => { if (src) new Image().src = src; });
  },
  readerV(pages, start, onPage) { // webtoon: proporção original preservada
    const stage = $('#stage');
    stage.className = 'v';
    stage.innerHTML = pages.map((src, k) => `<div class="pg" data-p="${k + 1}"><img loading="${k < start ? 'eager' : 'lazy'}" src="${esc(src)}" alt="Página ${k + 1}"></div>`).join('') +
      `<button class="more" data-nextch>Próximo capítulo ${icon('arrow-right')}</button>`;
    const observer = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) onPage(+e.target.dataset.p); }), { root: stage, threshold: .4 });
    stage.querySelectorAll('.pg').forEach(page => observer.observe(page));
    const images = [...stage.querySelectorAll('.pg img')];
    images.forEach(image => {
      const markLoaded = () => image.parentNode.classList.add('ld');
      image.complete && image.naturalWidth ? markLoaded() : image.addEventListener('load', markLoaded, { once: true });
    });
    // Posiciona na página retomada somente depois de carregar as anteriores (evita saltos de layout)
    Promise.all(images.slice(0, start).map(image => image.complete ? Promise.resolve() : new Promise(resolve => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    }))).then(() => {
      const target = stage.querySelector(`.pg[data-p="${start}"]`);
      if (target) stage.scrollTop = target.offsetTop;
    });
    View._observer?.disconnect();
    View._observer = observer;
  },
  scrollStage(direction) { $('#stage').scrollBy({ top: direction * innerHeight * .85, behavior: 'smooth' }); },
  stageScroll() {
    const stage = $('#stage');
    return { top: stage.scrollTop, max: stage.scrollHeight - stage.clientHeight };
  },
  hud(text) { $('#hud').textContent = text; },
  progress(fraction) { $('#prog').firstElementChild.style.width = Math.round(Math.min(1, fraction) * 100) + '%'; }
};
