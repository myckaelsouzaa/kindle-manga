import { COUNTRY, LANGS, Model } from './Model.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GEN_PT = { Action: 'Ação', Adventure: 'Aventura', Comedy: 'Comédia', Drama: 'Drama', Fantasy: 'Fantasia', Horror: 'Terror', Mystery: 'Mistério', Romance: 'Romance', 'Sci-Fi': 'Ficção científica', 'Slice of Life': 'Cotidiano', Sports: 'Esportes', Psychological: 'Psicológico', Supernatural: 'Sobrenatural', Historical: 'Histórico', Thriller: 'Suspense', Tragedy: 'Tragédia', Magic: 'Magia', Crime: 'Crime', Superhero: 'Super-herói', Music: 'Música', Mecha: 'Mecha', Isekai: 'Isekai' };
const STATUS = { ongoing: 'Em andamento', completed: 'Completo', hiatus: 'Em hiato', cancelled: 'Cancelado' };
const AVATARS = ['🦊', '🐱', '🐼', '🐯', '🦉', '🐙', '🦄', '🐲', '👾', '🤖', '🧙', '🥷'];
const ICON = '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>';
const SAVE_TXT = on => on ? 'Salvo' : 'Salvar para depois';
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

let ctx = { isSaved: () => false, progressOf: () => null, isChapterRead: () => false, isChapterDownloaded: () => false }, heroT;

export const View = {
  $, esc, GEN_PT,
  init(c) { ctx = c; },

  /* ---------- tema / chrome ---------- */
  theme(t) {
    const selected = THEMES.some(theme => theme.id === t) ? t : t === 'light' ? 'lilac' : 'purple-night';
    document.documentElement.dataset.theme = selected;
    const theme = THEMES.find(item => item.id === selected);
    const b = $('#themeBtn');
    if (b) b.innerHTML = `${theme?.group.includes('escuros') ? 'Escuros' : 'Claros'} <span>${esc(theme?.name || 'Tema')}</span>`;
  },
  themePicker() {
    const groups = [...new Set(THEMES.map(theme => theme.group))];
    $('#modal').className = 'modal theme-modal';
    $('#modal').innerHTML = `<button class="x" data-close aria-label="Fechar">✕</button>
      <div class="theme-modal-head"><span class="theme-kicker">Personalização</span><h2>Escolha seu tema</h2><p>As cores são aplicadas em toda a experiência e ficam salvas neste dispositivo.</p></div>
      ${groups.map(group => `<section class="theme-group"><h3>${group}</h3><div class="theme-grid">${THEMES.filter(theme => theme.group === group).map(theme => `<button class="theme-card ${document.documentElement.dataset.theme === theme.id ? 'selected' : ''}" data-theme-choice="${theme.id}" style="--preview-bg:${theme.bg};--preview-accent:${theme.accent};--preview-card:${theme.cards}" aria-pressed="${document.documentElement.dataset.theme === theme.id}">
        <span class="theme-preview"><i></i><b></b><em></em></span><span class="theme-card-info"><strong>${theme.name}</strong>${theme.badge ? `<small>${theme.badge}</small>` : ''}<span>${theme.description}</span><small>Fundo · Destaque</small></span></button>`).join('')}</div></section>`).join('')}`;
    $('#ov').classList.add('open'); document.body.style.overflow = 'hidden';
  },
  textSize(size) { document.documentElement.dataset.textSize = size; },
  searchOpen(open) {
    document.body.classList.toggle('search-open', open);
    const b = $('#searchBtn');
    if (b) {
      b.textContent = open ? '×' : '⌕';
      b.title = open ? 'Fechar pesquisa' : 'Pesquisar';
      b.setAttribute('aria-expanded', String(open));
    }
    const close = $('#searchClose');
    if (close) close.hidden = !open;
    if (!open) $('#q').value = '';
  },
  animations(enabled) {
    document.body.classList.toggle('no-animations', !enabled);
  },
  avatar(a, username = 'Perfil') {
    const b = $('#avBtn');
    if (!b) return;
    const avatar = b.querySelector('.avatar');
    if (avatar) {
      avatar.textContent = '';
      if (/^(https?:\/\/|data:image\/)/i.test(String(a || ''))) {
        const image = document.createElement('img');
        image.src = a;
        image.alt = '';
        avatar.append(image);
      } else avatar.textContent = a || '🦊';
    }
    else b.textContent = a;
    const name = b.querySelector('.profile-name');
    if (name) name.textContent = username || 'Perfil';
  },
  tab(t) { // marca a aba ativa (também no menu flutuante mobile)
    clearInterval(heroT); scrollTo(0, 0);
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  },
  main(html) { $('#main').innerHTML = html; },
  toast(msg) {
    document.querySelector('.toast')?.remove();
    const t = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg });
    document.body.append(t); setTimeout(() => t.remove(), 2400);
  },
  confirm(message) {
    const box = $('#confirm'), text = $('#confirmText');
    text.textContent = message;
    box.classList.add('open');
    return new Promise(resolve => {
      const finish = result => {
        box.classList.remove('open');
        $('#confirmOk').onclick = null;
        $('#confirmCancel').onclick = null;
        resolve(result);
      };
      $('#confirmOk').onclick = () => finish(true);
      $('#confirmCancel').onclick = () => finish(false);
    });
  },
  skeleton: n => '<div class="skel"></div>'.repeat(n),
  errBox: (what = 'tab') => `<div class="msg">Não foi possível carregar os dados.<br><button data-retry="${what}">Tentar novamente</button></div>`,

  /* ---------- cards e carrosséis ---------- */
  card(m) {
    const p = ctx.progressOf(m.id), s = ctx.isSaved(m.id), r = m.rating ? '★ ' + m.rating.toFixed(1) : '';
    return `<div class="card" data-id="${m.id}" tabindex="0" role="button"><div class="cover">
      <img class="ok" loading="lazy" draggable="false" alt="Capa de ${esc(m.title)}" src="${esc(m.cover)}">
      ${r ? `<span class="badge">${r}</span>` : ''}
      <button class="fav ${s ? 'on' : ''}" data-save="${m.id}" aria-label="Salvar para depois" title="Salvar para depois">${ICON}</button></div>
      <h3>${esc(m.title)}</h3>${p ? `<small>Cap. ${esc(p.chNum)} · pág. ${p.page}</small>` : ''}</div>`;
  },
  contCard: p => `<div class="card" data-id="${p.id}" tabindex="0" role="button"><div class="cover"><img src="${esc(p.manga.cover)}" alt="" class="ok" loading="lazy" draggable="false"><div class="bar" style="width:${Math.min(100, p.page / p.total * 100)}%"></div></div><h3>${esc(p.manga.title)}</h3><small>Cap. ${esc(p.chNum)} · pág. ${p.page}/${p.total}</small></div>`,
  car: (inner, loop = true) => `<div class="car"><button class="nav l" data-dir="-1" aria-label="Anterior">‹</button><div class="row${loop ? ' loop' : ' reading'}" ${loop ? 'data-loop' : ''}>${loop ? inner + inner : inner}</div><button class="nav r" data-dir="1" aria-label="Próximo">›</button></div>`,
  scrollRow(btn) { const r = btn.parentElement.querySelector('.row'); r.scrollBy({ left: +btn.dataset.dir * r.clientWidth * .85, behavior: 'smooth' }); },
  enhanceCarousel(row) {
    if (!row) return;
    const focus = () => {
      const edge = row.clientWidth * .06;
      [...row.children].forEach(card => {
        const left = card.offsetLeft - row.scrollLeft;
        const right = left + card.offsetWidth;
        const fullyVisible = left >= edge && right <= row.clientWidth - edge;
        card.classList.toggle('is-focus', fullyVisible);
        card.classList.toggle('is-near', !fullyVisible);
      });
      if (row.dataset.loop) {
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
    document.querySelectorAll(`[data-save="${id}"]`).forEach(b => {
      b.classList.toggle('on', on);
      if (b.dataset.full) b.textContent = SAVE_TXT(on);
    });
  },

  /* ---------- início ---------- */
  home(prog, secs, showRecommendations = false) {
    View.tab('home');
    View.main(`<div class="hero" id="hero"><div class="skel"></div></div>` +
      (prog.length ? `<h2>Continuar lendo</h2>${View.car(prog.map(View.contCard).join(''), false)}` : '') +
      `<h2>Gêneros</h2><div class="chips" id="genres"></div>` +
      (showRecommendations ? '<section class="reco-section" id="homeRecommendations"><h2>Porque você salvou</h2><div class="row loop" id="homeRecommendationRow" data-loop>' + View.skeleton(6) + '</div></section>' : '') +
      secs.map((s, i) => `<section class="${s[0].includes('Próximos') ? 'future-releases' : ''}" data-i="${i}"><h2>${s[0]}</h2>${View.car(View.skeleton(8))}</section>`).join(''));
    document.querySelectorAll('.row').forEach(View.enhanceCarousel);
    return [...document.querySelectorAll('section[data-i]')];
  },
  genres(list) {
    $('#genres').innerHTML = list.map(t => { const n = esc(GEN_PT[t.n] || t.n); return `<button class="chip" data-tag="${t.id}" data-tag-name="${esc(t.n)}" data-n="${n}">${n}</button>`; }).join('');
  },
  genresFail() { $('#genres')?.remove(); },
  fillSection(el, items) {
    const row = el.querySelector('.row');
    row.innerHTML = items.map(View.card).join('') + items.map(View.card).join('');
    View.enhanceCarousel(row);
  },
  fillHomeRecommendations(sections) {
    const section = $('#homeRecommendations');
    const row = $('#homeRecommendationRow');
    if (!section || !row) return;
    const first = sections.find(item => item.items?.length);
    if (!first) return section.remove();
    section.querySelector('h2').textContent = first.title;
    row.innerHTML = first.items.map(View.card).join('') + first.items.map(View.card).join('');
    View.enhanceCarousel(row);
  },
  recoLoading() {
    View.tab('reco');
    View.main('<h2>Para você</h2><div class="reco-loading">' + View.skeleton(6) + '</div>');
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
    const latestSearch = Model.recommendationSearches()[0];
    const notice = latestSearch
      ? `<div class="msg reco-search-notice">Sua busca por “${esc(latestSearch.termo)}” foi usada para atualizar suas recomendações.</div>`
      : '';
    const html = sections.length
      ? sections.map(section => `<section class="reco-section"><h2>${esc(section.title)}</h2>${section.reason ? `<p class="reco-reason">${esc(section.reason)}</p>` : ''}${View.car(section.items.map(item => View.card(item)).join(''))}</section>`).join('')
      : '<section class="reco-empty"><h2>Para você</h2><p>Ainda não encontramos sugestões compatíveis. Continue explorando para melhorar suas recomendações.</p><button class="btn2" id="refreshReco">Atualizar recomendações</button></section>';
    View.main(`<div class="reco-head"><h1>Para você</h1><button class="btn2" id="refreshReco">Atualizar recomendações</button></div>${notice}${html}`);
  },
  sectionError(el) { el.querySelector('.row').innerHTML = View.errBox('tab'); },
  removeEl(el) { el?.remove(); },
  hero(items) { // banner rotativo de destaques
    const box = $('#hero'); if (!box) return;
    const L = items.filter(i => i.desc).slice(0, 6); if (!L.length) return box.remove();
    box.innerHTML = L.map((m, i) => `<div class="slide ${i ? '' : 'on'}"><div class="bg" style="background-image:url('${m.coverBig}')"></div>
    <img src="${m.coverBig}" alt="Capa de ${esc(m.title)}" draggable="false"><div class="info">
      <h3>${esc(m.title)}</h3><div class="meta">${m.rating ? '★ ' + m.rating.toFixed(1) + ' · ' : ''}${esc(m.tags.slice(0, 3).map(t => GEN_PT[t] || t).join(' · '))}</div>
      <p>${esc(m.desc)}</p><button class="btn" data-id="${m.id}">Ver detalhes</button></div></div>`).join('') +
      `<div class="dots">${L.map((_, i) => `<button data-dot="${i}" class="${i ? '' : 'on'}" aria-label="Destaque ${i + 1}"></button>`).join('')}</div>`;
    let cur = 0;
    const show = n => {
      cur = (n + L.length) % L.length;
      box.querySelectorAll('.slide').forEach((s, i) => s.classList.toggle('on', i === cur));
      box.querySelectorAll('.dots button').forEach((d, i) => d.classList.toggle('on', i === cur));
    };
    const play = () => { clearInterval(heroT); heroT = setInterval(() => show(cur + 1), 6500); };
    box.addEventListener('click', e => { const d = e.target.closest('[data-dot]'); if (d) { show(+d.dataset.dot); play(); } });
    box.onmouseenter = () => clearInterval(heroT); box.onmouseleave = play;
    let x0 = 0; box.ontouchstart = e => x0 = e.touches[0].clientX;
    box.ontouchend = e => { const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) { show(cur + (dx < 0 ? 1 : -1)); play(); } };
    play();
  },

  /* ---------- listagem com "Carregar mais" (sem rolagem infinita) ---------- */
  gridShell(title, g2, isSearch = false, isGenre = false) {
    View.tab('home');
    const back = isSearch ? '<button class="search-back" data-search-back>← Voltar</button>' :
      isGenre ? '<button class="search-back" data-home-back>← Voltar para o início</button>' : '';
    View.main(`${back}<h2>${title}</h2><div class="grid ${g2 ? 'g2' : ''}" id="g">${View.skeleton(g2 ? 6 : 12)}</div><div id="mm"></div>`);
  },
  gridAdd(items, first, hasMore) {
    const g = $('#g'); if (first) g.innerHTML = '';
    if (!items.length && first) g.innerHTML = '<div class="msg">Nenhum mangá encontrado neste idioma.</div>';
    g.insertAdjacentHTML('beforeend', items.map(View.card).join(''));
    $('#mm').innerHTML = hasMore ? '<button class="more" data-more>Carregar Mais</button>' : '';
  },
  moreLoading() { const b = $('[data-more]'); if (b) { b.disabled = true; b.textContent = 'Carregando…'; } },
  gridError() { $('#g').innerHTML = View.errBox('tab'); $('#mm').innerHTML = ''; },

  /* ---------- salvos / perfil / configurações ---------- */
  saved(list) {
    View.tab('saved');
    View.main(`<h2>Salvos para ler depois</h2>` + (list.length ? `<div class="grid">${list.map(View.card).join('')}</div>`
      : '<div class="msg">Nada salvo ainda.<br>Toque no marcador de qualquer capa para guardar aqui.</div>'));
  },
  downloads(list) {
    View.tab('downloads');
    View.main(`<div class="downloads-head"><h2>Downloads</h2>${list.length ? '<div class="download-actions"><button class="btn2" id="toggleDownloadSelect">☷ Selecionar</button><div class="download-selection" id="downloadSelection" hidden><label><input type="checkbox" id="selectAllDownloads"><span>Selecionar tudo</span></label><button class="download-clear" id="clearDownloadSelection">Voltar</button><button class="download-delete" id="deleteSelectedDownloads">Excluir</button></div></div>' : ''}</div>` +
      (list.length ? `<div class="download-list">${list.map(d => `<div class="download-item" data-download-open="${esc(d.chapterId)}">
      <label class="download-check" hidden><input type="checkbox" data-download-select="${esc(d.chapterId)}" aria-label="Selecionar capítulo ${esc(d.num)}"></label>
      <span class="download-cover">${d.manga?.cover ? `<img class="ok" src="${esc(d.manga.cover)}" alt="">` : '▣'}</span>
      <span class="download-info"><b>${esc(d.manga?.title || 'Mangá')}</b><small>Cap. ${esc(d.num)}${d.title ? ` · ${esc(d.title)}` : ''}</small><small class="download-status">${d.localAvailable ? 'Disponível offline neste dispositivo' : 'Registrado em outro aparelho'}</small></span><span class="download-arrow">›</span>
    </div>`).join('')}</div>` : '<div class="msg">Nenhum capítulo baixado ainda.<br>Baixe capítulos na tela de detalhes para ler offline.</div>'));
  },
  login() {
    const screen = $('#authScreen');
    document.body.classList.add('auth-required');
    screen.hidden = false;
    screen.style.display = '';
    screen.innerHTML = `<div class="auth-card">
      <button class="auth-close" data-auth-close type="button" aria-label="Voltar">×</button>
      <div class="auth-logo"><img class="brand-logo" src="assets/logo.png" alt="" onerror="this.hidden=true"><span>Manga <b>Kindle</b></span></div>
      <p class="auth-kicker">Seu próximo capítulo começa aqui</p>
      <div class="auth-tabs"><button class="on" data-auth-mode="login">Já tenho conta</button><button data-auth-mode="signup">Criar conta</button></div>
      <div id="authLogin">
        <h1>Bem-vindo de volta</h1>
        <p class="auth-copy">Entre usando seu username.</p>
        <label for="authUsername">Username</label>
        <input id="authUsername" type="text" maxlength="24" autocomplete="username" placeholder="seu.username" required>
      </div>
      <div id="authSignup" hidden>
        <h1>Crie seu perfil</h1>
        <p class="auth-copy">Seus dados serão sincronizados entre navegadores.</p>
        <label for="authName">Nome completo</label>
        <input id="authName" type="text" autocomplete="name" placeholder="Seu nome">
        <label for="authEmail">E-mail</label>
        <input id="authEmail" type="email" autocomplete="email" placeholder="voce@exemplo.com">
        <label for="authSignupUsername">Username</label>
        <input id="authSignupUsername" type="text" maxlength="24" autocomplete="username" placeholder="seu.username">
      </div>
      <button class="btn auth-submit" id="authSave">Entrar</button>
      <div class="social-divider"><span>ou continue com</span></div>
      <div class="social-actions">
        <button class="social-btn google-btn" data-social="google"><span class="google-mark">G</span> Entrar com o Google</button>
      </div>
      <p class="auth-hint">O e-mail precisa ter um domínio válido para cadastro.</p>
    </div>`;
    $('#authUsername').focus();
  },
  socialProfile(profile) {
    const screen = $('#authScreen');
    document.body.classList.add('auth-required');
    screen.hidden = false;
    screen.style.display = '';
    screen.innerHTML = `<div class="auth-card">
      <button class="auth-close" data-auth-close type="button" aria-label="Voltar">×</button>
      <div class="auth-logo"><img class="brand-logo" src="assets/logo.png" alt="" onerror="this.hidden=true"><span>Manga <b>Kindle</b></span></div>
      <p class="auth-kicker">Login com Google concluído</p>
      <h1>Crie seu perfil</h1>
      <p class="auth-copy">Escolha um username exclusivo para continuar.</p>
      <label for="socialEmail">E-mail</label>
      <input id="socialEmail" type="email" value="${esc(profile.email)}" readonly>
      <label for="socialUsername">Username</label>
      <input id="socialUsername" type="text" maxlength="24" autocomplete="username" placeholder="seu.username" required>
      <button class="btn auth-submit" id="authSave">Continuar</button>
    </div>`;
    $('#socialUsername').focus();
  },
  authMode(mode) {
    const login = mode === 'login';
    $('#authLogin').hidden = !login;
    $('#authSignup').hidden = login;
    $('#authSave').textContent = login ? 'Entrar' : 'Criar conta';
    document.querySelectorAll('[data-auth-mode]').forEach(button => button.classList.toggle('on', button.dataset.authMode === mode));
    (login ? $('#authUsername') : $('#authName')).focus();
  },
  hideLogin() {
    const screen = $('#authScreen');
    document.body.classList.remove('auth-required');
    screen.hidden = true;
    screen.style.display = 'none';
    screen.replaceChildren();
  },
  cropModal(src) {
    document.querySelector('#cropModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="crop-overlay" id="cropModal">
      <div class="crop-modal" role="dialog" aria-modal="true" aria-labelledby="cropTitle">
        <div class="crop-head"><div><strong id="cropTitle">Ajustar foto</strong><small>Arraste a imagem e use o zoom para posicionar.</small></div><button class="icon-btn" data-crop-cancel aria-label="Cancelar">×</button></div>
        <div class="crop-stage" id="cropStage"><div class="crop-guide"></div><img id="cropImage" src="${esc(src)}" alt="Prévia da foto"></div>
        <label class="crop-zoom" for="cropZoom"><span>Zoom</span><input id="cropZoom" type="range" min="1" max="3" step=".01" value="1"></label>
        <div class="crop-actions"><button class="btn2" data-crop-cancel>Cancelar</button><button class="btn" data-crop-confirm>Usar esta foto</button></div>
      </div>
    </div>`);
  },
  closeCrop() { document.querySelector('#cropModal')?.remove(); },
  profilePhoto(p) {
    return /^(https?:\/\/|data:image\/)/i.test(String(p.photoUrl || ''))
      ? `<img src="${esc(p.photoUrl)}" alt="Foto de perfil">`
      : esc(p.avatar);
  },
  profile(p) {
    View.tab('profile');
    View.main(`<h2>Meu perfil</h2><div class="box">
      <div class="profile-photo-preview">${View.profilePhoto(p)}</div>
      <label class="file-button" for="pPhotoFile">Adicionar imagem da galeria ou arquivos</label><input class="file-input" id="pPhotoFile" type="file" accept="image/*">
      <label for="pUsername">Nome de Usuário</label><input type="text" id="pUsername" readonly value="${esc(p.username)}">
      <label for="pEmail">E-mail</label><input type="email" id="pEmail" readonly value="${esc(p.email)}">
      <div class="profile-id"><small>ID do usuário</small><code>${esc(p.id)}</code></div>
      <div class="profile-actions"><button class="btn2" id="logoutBtn">Sair</button></div></div>`);
  },
  profileModal(p) {
    $('#modal').className = 'modal profile-modal';
    $('#modal').innerHTML = `<button class="x" data-close aria-label="Fechar">✕</button>
      <h2>Meu perfil</h2>
      <div class="profile-photo-preview">${View.profilePhoto(p)}</div>
      <label class="file-button" for="pPhotoFile">Adicionar imagem da galeria ou arquivos</label><input class="file-input" id="pPhotoFile" type="file" accept="image/*">
      <label for="pUsername">Nome de Usuário</label><input type="text" id="pUsername" readonly value="${esc(p.username)}">
      <label for="pEmail">E-mail</label><input type="email" id="pEmail" readonly value="${esc(p.email)}">
      <div class="profile-id"><small>ID do usuário</small><code>${esc(p.id)}</code></div>
      <div class="profile-actions"><button class="btn2" id="logoutBtn">Sair</button></div>`;
    $('#ov').classList.add('open'); document.body.style.overflow = 'hidden';
  },
  profileDrawer(p) {
    const authenticated = Boolean(p.username && p.email);
    $('#profileDrawerContent').innerHTML = authenticated
      ? `<div class="profile-drawer-avatar">${View.profilePhoto(p)}</div>
        <div class="profile-summary"><strong>${esc(p.name || p.username)}</strong><small>@${esc(p.username)}</small></div>
        <label class="file-button" for="pPhotoFile">Adicionar imagem da galeria ou arquivos</label><input class="file-input" id="pPhotoFile" type="file" accept="image/*">
        <label for="pUsername">Nome de Usuário</label><input type="text" id="pUsername" readonly value="${esc(p.username)}">
        <label for="pEmail">E-mail</label><input type="email" id="pEmail" readonly value="${esc(p.email)}">
        <div class="profile-id"><small>ID do usuário</small><code>${esc(p.id)}</code></div>
        <div class="profile-preferences"><h3>Personalização</h3>
          <label for="cTheme">Tema</label><button class="btn2 theme-choice-button" data-theme-picker>Escolher tema</button>
          <label for="cLang">Idioma dos mangás</label><select id="cLang">${LANGS.map(([c, n]) => `<option value="${c}" ${c === Model.cfg.lang ? 'selected' : ''}>${n}</option>`).join('')}</select>
          <label for="cTextSize">Tamanho do texto</label><select id="cTextSize"><option value="small" ${Model.textSize === 'small' ? 'selected' : ''}>Pequeno</option><option value="normal" ${Model.textSize === 'normal' ? 'selected' : ''}>Normal</option><option value="large" ${Model.textSize === 'large' ? 'selected' : ''}>Grande</option></select>
          <label>Movimento</label><button class="toggle ${Model.animations ? 'on' : ''}" id="animationToggle" role="switch" aria-checked="${Model.animations}"><span></span>Ativar animações</button>
        </div>
        <div class="profile-actions"><button class="btn2" id="logoutBtn">Sair</button></div>`
      : `<div class="profile-guest">
          <div class="profile-drawer-avatar">🦊</div><h2>Entre na sua conta</h2>
          <p>Salve mangás, acompanhe seu progresso e sincronize suas preferências.</p>
          <div class="profile-auth-actions"><button class="btn" data-open-auth="login">Entrar</button><button class="btn2" data-open-auth="signup">Cadastrar</button></div>
        </div>
        <div class="profile-preferences"><h3>Personalização</h3>
          <label for="cTheme">Tema</label><button class="btn2 theme-choice-button" data-theme-picker>Escolher entre 12 temas</button>
          <label for="cLang">Idioma dos mangás</label><select id="cLang">${LANGS.map(([c, n]) => `<option value="${c}" ${c === Model.cfg.lang ? 'selected' : ''}>${n}</option>`).join('')}</select>
          <label for="cTextSize">Tamanho do texto</label><select id="cTextSize"><option value="small" ${Model.textSize === 'small' ? 'selected' : ''}>Pequeno</option><option value="normal" ${Model.textSize === 'normal' ? 'selected' : ''}>Normal</option><option value="large" ${Model.textSize === 'large' ? 'selected' : ''}>Grande</option></select>
          <label>Movimento</label><button class="toggle ${Model.animations ? 'on' : ''}" id="animationToggle" role="switch" aria-checked="${Model.animations}"><span></span>Ativar animações</button>
        </div>`;
    $('#profileDrawer').classList.add('open');
    document.body.classList.add('profile-open');
  },
  closeProfile() { $('#profileDrawer').classList.remove('open'); document.body.classList.remove('profile-open'); },
  settings(cfg, theme, animations) {
    View.tab('cfg');
    View.main(`<h2>Configurações</h2><div class="box">
      <label>Preferências de interface</label><button class="toggle ${animations ? 'on' : ''}" id="animationToggle" role="switch" aria-checked="${animations}"><span></span>Ativar Animações</button>
      <label>Dados salvos neste navegador</label>
      <div class="seg"><button id="clrProg">Limpar histórico de leitura</button><button id="clrSaved">Limpar salvos</button><button id="clrSearches">Limpar histórico de buscas</button></div></div>`);
  },
  setThemeButtons(t) { document.querySelectorAll('#cTheme button').forEach(b => b.classList.toggle('on', b.dataset.setTheme === t)); },
  hint(t) { const h = $('#cHint'); if (h) h.textContent = t; },
  btnText(id, t) { const b = $('#' + id); if (b) b.textContent = t; },

  /* ---------- modal de detalhes ---------- */
  modal(m, saved) {
    const c = COUNTRY[m.lang], fact = (k, v, id = '') => `<div class="fact"><small>${k}</small><b ${id ? `id="${id}"` : ''}>${v}</b></div>`;
    $('#modal').className = 'modal';
    $('#modal').innerHTML = `<div class="mhead"><div class="mbg" style="background-image:url('${m.coverBig}')"></div>
      <button class="x" data-close aria-label="Fechar">✕</button>
      <div class="cover"><img class="ok" alt="" src="${m.cover}"></div>
      <div class="mt"><h1>${esc(m.title)}</h1><div class="alt">${esc(m.alts.slice(0, 3).join(' · '))}</div>
        <div class="acts"><button class="btn" id="readBtn" disabled>Carregando capítulos…</button>
        <button class="btn2 ${saved ? 'on' : ''}" data-save="${m.id}" data-full="1">${SAVE_TXT(saved)}</button>
        <button class="btn2" data-share="${m.id}">Compartilhar</button></div></div></div>
      <div class="mbody"><div class="facts">
        ${fact('Nota dos usuários', m.rating ? '★ ' + m.rating.toFixed(2) + ' / 10' : '—', 'fRate')}
        ${fact('Formato', m.tags.includes('Full Color') ? 'Colorido' : 'Preto e branco')}
        ${fact('País de origem', c ? `${c[1]} · ${c[2]}` : esc(m.lang))}
        ${fact('Autor(es)', esc(m.authors.join(', ') || '—'))}
        ${fact('Arte', esc(m.artists.join(', ') || '—'))}
        ${fact('Revista / Editora', '…', 'fMag')}
        ${fact('Ano de criação', m.year || '—')}
        ${fact('Publicação', STATUS[m.status] || '—', 'fPub')}
        ${fact('Capítulos', '…', 'fCh')}</div>
      <div class="tags">${m.tags.slice(0, 8).map(t => `<span>${esc(GEN_PT[t] || t)}</span>`).join('')}</div>
      <div class="desc" id="desc">${esc(m.desc || 'Sem sinopse disponível.')}</div><small class="hint tr" id="dNote"></small>
      <div class="chlist" id="chl"></div></div>`;
    $('#ov').classList.add('open'); document.body.style.overflow = 'hidden';
    $('#modal').scrollTop = 0;
  },
  closeModal() { $('#ov').classList.remove('open'); if (!$('#reader').classList.contains('open')) document.body.style.overflow = ''; },
  fact(id, v) { const e = $('#' + id); if (e) e.textContent = v; },
  synopsis(text, note) { if (text != null) $('#desc').textContent = text; $('#dNote').textContent = note || ''; },
  modalChapters(chs, cur, prog, sort = 'recent') {
    const b = $('#readBtn'); if (!b) return;
    $('#fCh') && ($('#fCh').textContent = chs.length);
    if (!chs.length) { b.textContent = 'Sem capítulos neste idioma'; return; }
    b.disabled = false; b.textContent = prog ? `Continuar · Cap. ${chs[cur].num}, pág. ${prog.page}` : 'Começar a ler';
    $('#chl').innerHTML = `<div class="chapter-toolbar"><label for="chapterSort">Ordenar capítulos</label><select id="chapterSort" aria-label="Ordenar capítulos"><option value="recent">Mais recentes primeiro</option><option value="oldest">Mais antigos primeiro</option><option value="az">A – Z</option><option value="za">Z – A</option></select></div><div class="chapter-items">${chs.map((c, i) => `<div class="chrow">
      <button data-ch="${i}" class="${ctx.isChapterRead(Model.current?.id, c.id) ? 'read' : ''}">Cap. ${esc(c.num)}</button>
      <button class="chdownload ${ctx.isChapterDownloaded(c.id) ? 'done' : ''}" data-download-ch="${i}" data-download-id="${c.id}" ${c.source === 'Secondary' ? 'disabled' : ''} title="${c.source === 'Secondary' ? 'Leitura secundária indisponível offline' : ctx.isChapterDownloaded(c.id) ? 'Remover download' : 'Baixar capítulo'}">${c.source === 'Secondary' ? '—' : ctx.isChapterDownloaded(c.id) ? '✓' : '↓'}</button>
    </div>`).join('')}</div>`;
    const sortSelect = $('#chapterSort');
    if (sortSelect) sortSelect.value = sort;
  },
  chapterDownloadState(id, state, text = '') {
    const b = document.querySelector(`[data-download-id="${id}"]`);
    if (!b) return;
    b.classList.toggle('done', state === 'done');
    b.disabled = state === 'loading';
    b.textContent = text || (state === 'done' ? '✓' : '↓');
    b.title = state === 'done' ? 'Remover download' : 'Baixar capítulo';
  },
  modalChaptersError() { const b = $('#readBtn'); if (b) b.textContent = 'Erro ao carregar capítulos'; },

  /* ---------- leitor ---------- */
  readerOpen(title, chs) {
    $('#reader').classList.add('open'); document.body.style.overflow = 'hidden';
    $('#reader').classList.remove('chrome-hidden');
    $('#rbar').classList.remove('hide'); $('#rTitle').textContent = title;
    $('#rChap').innerHTML = chs.map((c, k) => `<option value="${k}">Cap. ${esc(c.num)}</option>`).join('');
  },
  readerClose() { $('#reader').classList.remove('open'); $('#panel').classList.remove('open'); document.body.style.overflow = ''; },
  readerChapter(i) { $('#rChap').value = i; },
  togglePanel() { $('#panel').classList.toggle('open'); },
  toggleBar() { $('#reader').classList.toggle('chrome-hidden'); },
  readerLoading() { $('#stage').innerHTML = '<div class="msg" style="color:#aaa">Carregando páginas…</div>'; },
  readerError() { $('#stage').innerHTML = View.errBox('reader'); },
  readerSettings(rs) {
    $('#reader').style.setProperty('--rbg', rs.bg); $('#stage').style.setProperty('--br', rs.br + '%'); $('#sBr').value = rs.br;
    document.querySelectorAll('#sBg button').forEach(b => b.classList.toggle('on', b.dataset.rbg === rs.bg));
    document.querySelectorAll('#sDir button').forEach(b => b.classList.toggle('on', b.dataset.rd === rs.dir));
    document.querySelectorAll('#sQ button').forEach(b => b.classList.toggle('on', b.dataset.rq === rs.q));
  },
  readerH() { // estilo Kindle: uma página por vez
    const st = $('#stage'); st.className = 'h';
    st.innerHTML = '<div class="zone l" data-z="l"></div><div class="zone c" data-z="c"></div><div class="zone r" data-z="r"></div><img alt="">';
  },
  readerShow(url, preload) {
    const im = $('#stage img'); if (!im) return;
    im.style.opacity = .3; im.src = url; im.onload = () => im.style.opacity = 1;
    preload.forEach(u => u && (new Image().src = u));
  },
  readerV(pages, start, onPage) { // webtoon: proporção original preservada (width 100% + height auto)
    const st = $('#stage'); st.className = 'v';
    st.innerHTML = pages.map((u, k) => `<div class="pg" data-p="${k + 1}"><img loading="${k < start ? 'eager' : 'lazy'}" src="${u}" alt="Página ${k + 1}" onload="this.parentNode.classList.add('ld')"></div>`).join('') +
      '<button class="more" data-nextch>Próximo capítulo →</button>';
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) onPage(+e.target.dataset.p); }), { root: st, threshold: .4 });
    st.querySelectorAll('.pg').forEach(p => io.observe(p));
    const ready = [...st.querySelectorAll('.pg img')].slice(0, start).map(im => im.complete ? Promise.resolve() :
      new Promise(resolve => {
        im.addEventListener('load', resolve, { once: true });
        im.addEventListener('error', resolve, { once: true });
      }));
    Promise.all(ready).then(() => {
      const target = st.querySelector(`.pg[data-p="${start}"]`);
      if (target) st.scrollTop = target.offsetTop;
    });
    View._io?.disconnect(); View._io = io;
  },
  scrollStage(d) { $('#stage').scrollBy({ top: d * innerHeight * .85, behavior: 'smooth' }); },
  stageScroll() { const s = $('#stage'); return { top: s.scrollTop, max: s.scrollHeight - s.clientHeight }; },
  hud(t) { $('#hud').textContent = t; },
  progress(frac) {
    const p = $('#prog'); p.firstElementChild.style.width = Math.round(Math.min(1, frac) * 100) + '%';
  }
};