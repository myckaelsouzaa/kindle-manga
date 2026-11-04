import { COUNTRY, LANGS } from './Model.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GEN_PT = { Action: 'Ação', Adventure: 'Aventura', Comedy: 'Comédia', Drama: 'Drama', Fantasy: 'Fantasia', Horror: 'Terror', Mystery: 'Mistério', Romance: 'Romance', 'Sci-Fi': 'Ficção científica', 'Slice of Life': 'Cotidiano', Sports: 'Esportes', Psychological: 'Psicológico', Supernatural: 'Sobrenatural', Historical: 'Histórico', Thriller: 'Suspense', Tragedy: 'Tragédia', Magic: 'Magia', Crime: 'Crime', Superhero: 'Super-herói', Music: 'Música', Mecha: 'Mecha', Isekai: 'Isekai' };
const STATUS = { ongoing: 'Em andamento', completed: 'Completo', hiatus: 'Em hiato', cancelled: 'Cancelado' };
const AVATARS = ['🦊', '🐱', '🐼', '🐯', '🦉', '🐙', '🦄', '🐲', '👾', '🤖', '🧙', '🥷'];
const ICON = '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>';
const FLAGS = {
  jp: '<svg class="flag" viewBox="0 0 3 2" role="img"><circle cx="1.5" cy="1" r=".6" fill="#bc002d"/></svg>',
  kr: '<svg class="flag" viewBox="0 0 3 2" role="img"><rect width="3" height="2" fill="#fff"/><path d="M1.5 1a.5.5 0 1 0 0-1 .25.25 0 1 1 0 .5.25.25 0 1 0 0 .5.5.5 0 0 0 0 1z" fill="#cd2e3a"/><path d="M1.5 1a.5.5 0 1 1 0 1 .25.25 0 1 0 0-.5.25.25 0 1 1 0-.5.5.5 0 0 1 0-1z" fill="#0047a0"/><path d="M.35.35l.1-.1.42.42-.1.1zM.2.5l.1-.1.42.42-.1.1zM2.23 1.23l.42.42-.1.1-.42-.42zM2.28 1.08l.42.42-.1.1-.42-.42zM.35 1.65l.42-.42.1.1-.42.42zM.2 1.5l.42-.42.1.1-.42.42zM2.23.77l.42-.42.1.1-.42.42zM2.28.92l.42-.42.1.1-.42.42z" fill="#000"/></svg>',
  cn: '<svg class="flag" viewBox="0 0 3 2" role="img"><rect width="3" height="2" fill="#de2910"/><path d="M.55.3l.12.36.38-.12-.23.3.32.23-.39-.04-.07.39-.08-.39-.39.04.32-.23-.23-.3.38.12z" fill="#ffde00"/></svg>',
  hk: '<svg class="flag" viewBox="0 0 3 2" role="img"><rect width="3" height="2" fill="#de2910"/><path d="M1.5.42l.09.26.28-.02-.22.17.08.27-.23-.16-.23.16.08-.27-.22-.17.28.02zM1.5 1.03l.09.26.28-.02-.22.17.08.27-.23-.16-.23.16.08-.27-.22-.17.28.02zM1.5 1.64l.09.26.28-.02-.22.17.08.27-.23-.16-.23.16.08-.27-.22-.17.28.02z" fill="#fff"/></svg>',
  us: '<svg class="flag" viewBox="0 0 3 2" role="img"><rect width="3" height="2" fill="#fff"/><path d="M0 0h3v.154H0zm0 .308h3v.154H0zm0 .616h3v.154H0zm0 .308h3v.154H0zm0 .308h3v.154H0zm0 .308h3v.154H0z" fill="#b22234"/><rect width="1.23" height="1.08" fill="#3c3b6e"/><path d="M.12.18h.12v.12H.12zm.3 0h.12v.12H.42zm.3 0h.12v.12H.72zm.3 0h.12v.12H1.02zM.27.38h.12v.12H.27zm.3 0h.12v.12H.57zm.3 0h.12v.12H.87zM.12.58h.12v.12H.12zm.3 0h.12v.12H.42zm.3 0h.12v.12H.72zm.3 0h.12v.12H1.02zM.27.78h.12v.12H.27zm.3 0h.12v.12H.57zm.3 0h.12v.12H.87z" fill="#fff"/></svg>'
};
const SAVE_TXT = on => on ? 'Salvo' : 'Salvar para depois';

let ctx = { isSaved: () => false, progressOf: () => null }, heroT;

export const View = {
  $, esc, GEN_PT,
  init(c) { ctx = c; },

  /* ---------- tema / chrome ---------- */
  theme(t) { document.documentElement.dataset.theme = t; $('#themeBtn').textContent = t === 'dark' ? '🌙' : '☀️'; },
  avatar(a) { $('#avBtn').textContent = a; },
  tab(t) { // marca a aba ativa (também no menu flutuante mobile)
    clearInterval(heroT); scrollTo(0, 0);
    document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  },
  main(html) { $('#main').innerHTML = html; },
  toast(msg) {
    document.querySelector('.toast')?.remove();
    const t = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg });
    document.body.append(t); setTimeout(() => t.remove(), 2400);
  },
  flag(lang) { const c = COUNTRY[lang]; return c ? FLAGS[c[0]].replace('<svg ', `<svg aria-label="${c[0].toUpperCase()}" title="${c[1]} · ${c[2]}" `) : ''; },
  skeleton: n => '<div class="skel"></div>'.repeat(n),
  errBox: (what = 'tab') => `<div class="msg">Não foi possível carregar os dados.<br><button data-retry="${what}">Tentar novamente</button></div>`,

  /* ---------- cards e carrosséis ---------- */
  card(m) {
    const p = ctx.progressOf(m.id), s = ctx.isSaved(m.id), r = m.rating ? '★ ' + m.rating.toFixed(1) : '', f = View.flag(m.lang);
    return `<div class="card" data-id="${m.id}" tabindex="0" role="button"><div class="cover">
      <img loading="lazy" draggable="false" alt="Capa de ${esc(m.title)}" src="${m.cover}" onload="this.classList.add('ok')">
      ${f || r ? `<span class="badge">${f}${r}</span>` : ''}
      <button class="fav ${s ? 'on' : ''}" data-save="${m.id}" aria-label="Salvar para depois" title="Salvar para depois">${ICON}</button></div>
      <h3>${esc(m.title)}</h3>${p ? `<small>Cap. ${esc(p.chNum)} · pág. ${p.page}</small>` : ''}</div>`;
  },
  contCard: p => `<div class="card" data-id="${p.id}" tabindex="0" role="button"><div class="cover"><img src="${esc(p.manga.cover)}" alt="" class="ok" loading="lazy" draggable="false"><div class="bar" style="width:${Math.min(100, p.page / p.total * 100)}%"></div></div><h3>${esc(p.manga.title)}</h3><small>Cap. ${esc(p.chNum)} · pág. ${p.page}/${p.total}</small></div>`,
  car: inner => `<div class="car"><button class="nav l" data-dir="-1" aria-label="Anterior">‹</button><div class="row">${inner}</div><button class="nav r" data-dir="1" aria-label="Próximo">›</button></div>`,
  scrollRow(btn) { const r = btn.parentElement.querySelector('.row'); r.scrollBy({ left: +btn.dataset.dir * r.clientWidth * .85, behavior: 'smooth' }); },
  syncSaved(id, on) { // atualiza todos os botões de salvar daquele mangá
    document.querySelectorAll(`[data-save="${id}"]`).forEach(b => {
      b.classList.toggle('on', on);
      if (b.dataset.full) b.textContent = SAVE_TXT(on);
    });
  },

  /* ---------- início ---------- */
  home(prog, secs) {
    View.tab('home');
    View.main(`<div class="hero" id="hero"><div class="skel"></div></div>` +
      (prog.length ? `<h2>📖 Continuar lendo</h2>${View.car(prog.map(View.contCard).join(''))}` : '') +
      `<h2>Gêneros</h2><div class="chips" id="genres"></div>` +
      secs.map((s, i) => `<section data-i="${i}"><h2>${s[0]}</h2>${View.car(View.skeleton(8))}</section>`).join(''));
    return [...document.querySelectorAll('section[data-i]')];
  },
  genres(list) {
    $('#genres').innerHTML = list.map(t => { const n = esc(GEN_PT[t.n] || t.n); return `<button class="chip" data-tag="${t.id}" data-n="${n}">${n}</button>`; }).join('');
  },
  genresFail() { $('#genres')?.remove(); },
  fillSection(el, items) { el.querySelector('.row').innerHTML = items.map(View.card).join(''); },
  sectionError(el) { el.querySelector('.row').innerHTML = View.errBox('tab'); },
  removeEl(el) { el?.remove(); },
  hero(items) { // banner rotativo de destaques
    const box = $('#hero'); if (!box) return;
    const L = items.filter(i => i.desc).slice(0, 6); if (!L.length) return box.remove();
    box.innerHTML = L.map((m, i) => `<div class="slide ${i ? '' : 'on'}"><div class="bg" style="background-image:url('${m.coverBig}')"></div>
      <img src="${m.coverBig}" alt="Capa de ${esc(m.title)}" draggable="false"><div class="info"><span class="tag">🔥 Destaque ${i + 1}</span>
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
  gridShell(title, g2) {
    View.tab('home');
    View.main(`<h2>${title}</h2><div class="grid ${g2 ? 'g2' : ''}" id="g">${View.skeleton(g2 ? 6 : 12)}</div><div id="mm"></div>`);
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
    View.main(`<h2>🔖 Salvos para ler depois</h2>` + (list.length ? `<div class="grid">${list.map(View.card).join('')}</div>`
      : '<div class="msg">Nada salvo ainda.<br>Toque no marcador 🔖 de qualquer capa para guardar aqui.</div>'));
  },
  profile(p) {
    View.tab('profile');
    View.main(`<h2>Meu perfil</h2><div class="box">
      <label>Avatar</label><div class="avs">${AVATARS.map(a => `<button data-av="${a}" class="${a === p.avatar ? 'on' : ''}">${a}</button>`).join('')}</div>
      <label for="pName">Nome de usuário</label><input type="text" id="pName" maxlength="24" placeholder="Como devemos te chamar?" value="${esc(p.name)}">
      <label for="pLang">Idioma do sistema (sinopses traduzidas para ele)</label>
      <select id="pLang">${LANGS.map(([c, n]) => `<option value="${c}" ${c === p.sysLang ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <label>Modo de leitura padrão</label>
      <div class="seg" id="pMode"><button data-rm="h" class="${p.readMode === 'h' ? 'on' : ''}">Horizontal (Kindle)</button><button data-rm="v" class="${p.readMode === 'v' ? 'on' : ''}">Vertical (Webtoon)</button></div>
      <button class="btn" id="pSave">Salvar perfil</button></div>`);
  },
  pickAvatar(b) { document.querySelectorAll('.avs button').forEach(x => x.classList.toggle('on', x === b)); },
  pickMode(b) { document.querySelectorAll('#pMode button').forEach(x => x.classList.toggle('on', x === b)); },
  readProfileForm() {
    return { avatar: $('.avs .on')?.dataset.av || AVATARS[0], name: $('#pName').value.trim(), sysLang: $('#pLang').value, readMode: $('#pMode .on')?.dataset.rm || 'h' };
  },
  settings(cfg, theme) {
    View.tab('cfg');
    View.main(`<h2>Configurações</h2><div class="box">
      <label for="cLang">Idioma dos mangás (catálogo)</label>
      <select id="cLang">${LANGS.map(([c, n]) => `<option value="${c}" ${c === cfg.lang ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <p class="hint" id="cHint">Somente mangás com capítulos traduzidos neste idioma aparecem na busca, nas listas e na leitura.</p>
      <label>Tema</label><div class="seg" id="cTheme"><button data-set-theme="dark" class="${theme === 'dark' ? 'on' : ''}">Escuro</button><button data-set-theme="light" class="${theme === 'light' ? 'on' : ''}">Claro</button></div>
      <label>Dados salvos neste navegador</label>
      <div class="seg"><button id="clrProg">Limpar histórico de leitura</button><button id="clrSaved">Limpar salvos</button></div></div>`);
  },
  setThemeButtons(t) { document.querySelectorAll('#cTheme button').forEach(b => b.classList.toggle('on', b.dataset.setTheme === t)); },
  hint(t) { const h = $('#cHint'); if (h) h.textContent = t; },
  btnText(id, t) { const b = $('#' + id); if (b) b.textContent = t; },

  /* ---------- modal de detalhes ---------- */
  modal(m, saved) {
    const c = COUNTRY[m.lang], fact = (k, v, id = '') => `<div class="fact"><small>${k}</small><b ${id ? `id="${id}"` : ''}>${v}</b></div>`;
    $('#modal').innerHTML = `<div class="mhead"><div class="mbg" style="background-image:url('${m.coverBig}')"></div>
      <button class="x" data-close aria-label="Fechar">✕</button>
      <div class="cover"><img class="ok" alt="" src="${m.cover}"></div>
      <div class="mt"><h1>${esc(m.title)}</h1><div class="alt">${esc(m.alts.slice(0, 3).join(' · '))}</div>
        <div class="acts"><button class="btn" id="readBtn" disabled>Carregando capítulos…</button>
        <button class="btn2 ${saved ? 'on' : ''}" data-save="${m.id}" data-full="1">${SAVE_TXT(saved)}</button>
        <button class="btn2" data-share="${m.id}">Compartilhar</button></div></div></div>
      <div class="mbody"><div class="facts">
        ${fact('Nota dos usuários', m.rating ? '★ ' + m.rating.toFixed(2) + ' / 10' : '—', 'fRate')}
        ${fact('Formato', m.tags.includes('Full Color') ? '🎨 Colorido' : '⬛ Preto e branco')}
        ${fact('País de origem', c ? `${View.flag(m.lang)} ${c[1]} · ${c[2]}` : esc(m.lang))}
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
  modalChapters(chs, cur, prog) {
    const b = $('#readBtn'); if (!b) return;
    $('#fCh') && ($('#fCh').textContent = chs.length);
    if (!chs.length) { b.textContent = 'Sem capítulos neste idioma'; return; }
    b.disabled = false; b.textContent = prog ? `Continuar · Cap. ${chs[cur].num}, pág. ${prog.page}` : 'Começar a ler';
    $('#chl').innerHTML = chs.map((c, i) => `<button data-ch="${i}" class="${prog && i === cur ? 'cur' : ''}">Cap. ${esc(c.num)}</button>`).join('');
  },
  modalChaptersError() { const b = $('#readBtn'); if (b) b.textContent = 'Erro ao carregar capítulos'; },

  /* ---------- leitor ---------- */
  readerOpen(title, chs) {
    $('#reader').classList.add('open'); document.body.style.overflow = 'hidden';
    $('#rbar').classList.remove('hide'); $('#rTitle').textContent = title;
    $('#rChap').innerHTML = chs.map((c, k) => `<option value="${k}">Cap. ${esc(c.num)}</option>`).join('');
  },
  readerClose() { $('#reader').classList.remove('open'); $('#panel').classList.remove('open'); document.body.style.overflow = ''; },
  readerChapter(i) { $('#rChap').value = i; },
  togglePanel() { $('#panel').classList.toggle('open'); },
  toggleBar() { $('#rbar').classList.toggle('hide'); },
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
    st.innerHTML = pages.map((u, k) => `<div class="pg" data-p="${k + 1}"><img loading="lazy" src="${u}" alt="Página ${k + 1}" onload="this.parentNode.classList.add('ld')"></div>`).join('') +
      '<button class="more" data-nextch>Próximo capítulo →</button>';
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) onPage(+e.target.dataset.p); }), { root: st, threshold: .4 });
    st.querySelectorAll('.pg').forEach(p => io.observe(p));
    st.querySelector(`.pg[data-p="${start}"]`)?.scrollIntoView();
    View._io?.disconnect(); View._io = io;
  },
  scrollStage(d) { $('#stage').scrollBy({ top: d * innerHeight * .85, behavior: 'smooth' }); },
  stageScroll() { const s = $('#stage'); return { top: s.scrollTop, max: s.scrollHeight - s.clientHeight }; },
  hud(t) { $('#hud').textContent = t; },
  progress(frac, mini) { // barra no topo; ao avançar vira um indicador fino fixo na base
    const p = $('#prog'); p.classList.toggle('mini', mini); p.firstElementChild.style.width = Math.round(Math.min(1, frac) * 100) + '%';
  }
};