import { Model } from './Model.js';
import { View } from './View.js';

const $ = View.$;
// Seções da home (os gêneros ficam só nos chips, sem blocos repetidos)
const SECS = [
  [' Em alta', 'order[followedCount]=desc'],
  [' Mais bem avaliados', 'order[rating]=desc'],
  [' Atualizados recentemente', 'order[latestUploadedChapter]=desc'],
  [' Novos no catálogo', 'order[createdAt]=desc'],
  [' Próximos lançamentos', 'status[]=ongoing&order[latestUploadedChapter]=asc'],
  [' Obras completas', 'status[]=completed&order[followedCount]=desc']
];
let secIO, drag = null, suppress = false, searchT, saveT, tx = 0, chs = [], cur = 0, resume = 1;
let cropState = null;
let downloadSelectionMode = false;

export const Controller = {
  async init() {
    const params = new URLSearchParams(location.search);
    const socialError = params.get('social') === 'error' ? params.get('message') : '';
    const oauthCallback = params.has('code');
    if (oauthCallback) {
      await Model.restoreSocialSession().catch(() => false);
      history.replaceState(null, '', location.pathname);
    } else if (params.get('social') === 'success') {
      await Model.restoreSocialSession().catch(() => false);
      history.replaceState(null, '', location.pathname);
    } else if (socialError) {
      history.replaceState(null, '', location.pathname);
    }
    const authenticated = Boolean(Model.profile.username && Model.profile.email);
    document.body.classList.toggle('auth-required', !authenticated);
    if (authenticated) {
      await Model.refreshDownloadIntegrity();
      await Model.syncDownloads().catch(error => View.toast(error.message));
    }
    View.theme(Model.theme); View.animations(Model.animations); View.avatar(Model.profile.photoUrl || Model.profile.avatar, Model.profile.username || Model.profile.name);
    this.bind();
    if (Model.profile.username && Model.profile.email) this.show('home');
    else {
      View.login();
      if (socialError) View.toast(socialError);
    }
    const id = new URLSearchParams(location.search).get('manga'); // link compartilhado
    if (id) this.openManga(id, false);
  },

  /* ---------- navegação entre abas ---------- */
  show(tab) {
    Model.tab = tab; Model.filters = null;
    if (tab === 'home') return this.home();
    if (tab === 'saved') { const l = Object.values(Model.saved()); l.forEach(m => Model.cache[m.id] ??= m); return View.saved(l); }
    if (tab === 'downloads') {
      downloadSelectionMode = false;
      const render = () => {
        const l = Object.values(Model.downloadedChapters()).sort((a, b) => {
          const an = Number.parseFloat(String(a.num).replace(',', '.'));
          const bn = Number.parseFloat(String(b.num).replace(',', '.'));
          if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
          if (Number.isFinite(an) !== Number.isFinite(bn)) return Number.isFinite(an) ? -1 : 1;
          const manga = String(a.manga?.title || '').localeCompare(String(b.manga?.title || ''), 'pt-BR');
          if (manga) return manga;
          return String(a.num || '').localeCompare(String(b.num || ''), 'pt-BR', { numeric: true });
        });
        l.forEach(d => {
        const manga = d.manga || Model.offlineManga(d.mangaId);
        if (manga) {
          d.manga = manga;
          Model.cache[manga.id] = manga;
        }
        });
        return View.downloads(l);
      };
      return Model.refreshDownloadIntegrity().then(render).catch(error => {
        View.toast(error.message);
        return render();
      });
    }
    View.settings(Model.cfg, Model.theme, Model.animations);
  },
  async home() {
    const prog = Object.values(Model.progress()).sort((a, b) => b.ts - a.ts);
    prog.forEach(p => Model.cache[p.id] ??= p.manga);
    const showRecommendations = Model.hasRecommendationHistory();
    const secs = View.home(prog, SECS, showRecommendations);
    secIO?.disconnect();
    secIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { secIO.unobserve(e.target); this.fillSec(e.target); } }), { rootMargin: '500px' });
    this.genres(); this.fillSec(secs[0]); secs.slice(1).forEach(s => secIO.observe(s));
  },
  async fillSec(el) { // a 1ª seção alimenta também o banner de destaques
    const i = +el.dataset.i;
    try {
      const { items } = await Model.list(SECS[i][1] + '&limit=20');
      if (!items.length) { View.removeEl(el); if (!i) View.removeEl($('#hero')); return; }
      View.fillSection(el, items); if (!i) View.hero(items);
      if (Model.hasRecommendationHistory()) View.fillRecommendations(Model.recommendations(Object.values(Model.cache)));
    } catch { View.sectionError(el); if (!i) View.removeEl($('#hero')); }
  },
  async genres() {
    try { View.genres((await Model.tags()).filter(t => t.g === 'genre').sort((a, b) => a.n.localeCompare(b.n))); }
    catch { View.genresFail(); }
  },

  /* ---------- listagens com "Carregar Mais" ---------- */
  grid(title, extra, g2 = false, search = '') {
    Model.filters = { title, extra, g2, search, offset: 0 };
    View.gridShell(title, g2, Boolean(search), Boolean(extra && extra.includes('includedTags[]'))); this.loadMore(true);
  },
  async loadMore(first = false) {
    const f = Model.filters; if (!f) return;
    try {
      const { items, total } = f.search
        ? await Model.search(f.search, f.offset)
        : await Model.list(`${f.extra}&limit=24&offset=${f.offset}`);
      if (f !== Model.filters) return; // o usuário navegou para outro lugar
      if (f.search) items.slice(0, 8).forEach(item => Model.trackManga(item));
      f.offset += items.length; View.gridAdd(items, first, f.offset < total);
    } catch { if (f === Model.filters) View.gridError(); }
  },

  /* ---------- detalhes + deep link ---------- */
  async openManga(id, push = true) {
    let m;
    try { m = await Model.getManga(id); } catch { return View.toast('Mangá não encontrado.'); }
    if (push) history.pushState({ manga: id }, '', '?manga=' + id);
    Model.trackManga(m);
    Model.current = m; chs = []; cur = 0; resume = 1;
    View.modal(m, Model.isSaved(id)); this.loadModal(m);
  },
  closeModal() {
    if (history.state?.manga) return history.back(); // popstate fecha o modal
    View.closeModal(); if (location.search) history.replaceState(null, '', location.pathname);
  },
  loadModal(m) {
    const alive = () => Model.current?.id === m.id, prog = Model.progressOf(m.id);
    Model.chapters(m).then(list => {
      if (!alive()) return;
      chs = list; cur = prog ? Math.max(0, list.findIndex(c => c.id === prog.chId)) : 0; resume = prog ? prog.page : 1;
      View.modalChapters(list, cur, prog);
    }).catch(() => alive() && View.modalChaptersError());
    Model.extra(m).then(x => {
      if (!alive()) return;
      View.fact('fMag', x?.mag || 'Não informado');
      if (x?.year && !m.year) View.fact('fPub', x.year);
      if (x?.score && !m.rating) View.fact('fRate', '★ ' + x.score + ' / 10 (MAL)');
    }).catch(() => alive() && View.fact('fMag', 'Não informado'));
    if (Model.needsTranslation(m)) { // sinopse → idioma do sistema
      View.synopsis(null, 'Traduzindo sinopse…');
      Model.translate(m).then(t => alive() && View.synopsis(t, 'Sinopse traduzida automaticamente.'))
        .catch(() => alive() && View.synopsis(null, 'Tradução indisponível agora — exibindo o original.'));
    }
  },
  async share(id) {
    const url = `${location.origin}${location.pathname}?manga=${id}`;
    try { if (navigator.share) return await navigator.share({ title: Model.cache[id]?.title, url }); } catch { return; }
    try { await navigator.clipboard.writeText(url); View.toast('Link copiado!'); } catch { prompt('Copie o link:', url); }
  },
  toggleSaved(id) {
    const on = Model.toggleSaved(id); View.syncSaved(id, on);
    if (on && Model.cache[id]) Model.cacheManga(Model.cache[id]).catch(() => View.toast('Mangá salvo, mas não foi possível preparar o cache offline.'));
    View.toast(on ? 'Salvo para ler depois' : 'Removido dos salvos');
    if (Model.tab === 'saved') this.show('saved');
  },
  async downloadChapter(i) {
    const ch = chs[i], m = Model.current;
    if (!ch || !m) return;
    if (Model.isChapterDownloaded(ch.id)) return this.removeChapterDownload(i);
    const button = document.querySelector(`[data-download-ch="${i}"]`);
    if (button) {
      button.dataset.downloadId = ch.id;
      button.disabled = true;
      button.textContent = '…';
    }
    try {
      await Model.downloadChapter(m, ch, (done, total) => {
        if (button) button.textContent = `${Math.round(done / total * 100)}%`;
      });
      View.chapterDownloadState(ch.id, 'done');
      const message = (Model.downloadedChapters()[ch.id] || {}).syncError
        ? ' Capítulo salvo neste aparelho, mas não foi sincronizado na nuvem.'
        : '';
      View.toast(`Capítulo ${ch.num} baixado para ler offline.${message}`);
    } catch (error) {
      Model.removeChapterDownload(ch.id).catch(() => undefined);
      if (button) {
        button.disabled = false;
        button.textContent = '↓';
      }
      View.toast(error.message || 'Não foi possível baixar este capítulo. Tente novamente.');
    }
  },
  async removeChapterDownload(i) {
    const ch = chs[i];
    if (!ch) return;
    if (!await View.confirm(`Tem certeza que deseja apagar o Capítulo ${ch.num}? Esta ação não poderá ser desfeita.`)) return;
    try {
      await Model.removeChapterDownload(ch.id);
      View.chapterDownloadState(ch.id, 'available');
      View.toast(`Download do capítulo ${ch.num} removido.`);
    } catch {
      View.toast('Não foi possível remover este download.');
    }
  },

  /* ---------- leitor ---------- */
  startReading(i, page) {
    if (chs[i]?.source && chs[i].source !== 'MangaDex') {
      return View.toast('Este capítulo pertence ao provedor secundário e não pode ser lido pelo leitor MangaDex.');
    }
    Object.assign(Model.R, { m: Model.current, chs, i, pages: [], p: 1 });
    View.closeModal(); history.replaceState(null, '', location.pathname);
    View.readerOpen(Model.current.title, chs); this.loadPages(page);
  },
  async loadPages(page = 1) {
    const R = Model.R;
    View.readerChapter(R.i); View.readerSettings(Model.reader); View.readerLoading();
    try { R.pages = await Model.pages(R.chs[R.i].id, Model.reader.dir === 'v' ? 'data' : undefined); R.p = Math.min(Math.max(1, page), R.pages.length); this.render(); }
    catch { View.readerError(); }
  },
  render() {
    const R = Model.R;
    if (Model.reader.dir === 'h') { View.readerH(); this.showPage(); }
    else { View.readerV(R.pages, R.p, p => { R.p = p; this.sync(); }); this.sync(); }
  },
  showPage() { const R = Model.R; View.readerShow(R.pages[R.p - 1], [R.pages[R.p], R.pages[R.p + 1]]); this.sync(); },
  sync() { // HUD, barra de progresso e salvamento automático
    const R = Model.R; if (!R.pages.length) return;
    View.hud(`Cap. ${R.chs[R.i].num} · Página ${R.p} / ${R.pages.length}`);
    if (Model.reader.dir === 'h') View.progress(R.p / R.pages.length, R.p > 1);
    else { const { top, max } = View.stageScroll(); View.progress(max > 0 ? top / max : R.p / R.pages.length, top > 80); }
    clearTimeout(saveT); saveT = setTimeout(() => Model.saveProgress(), 250);
  },
  go(d) {
    const R = Model.R;
    if (Model.reader.dir === 'v') return View.scrollStage(d);
    const n = R.p + d;
    if (n < 1) return this.chapter(-1, true);
    if (n > R.pages.length) return this.chapter(1);
    R.p = n; this.showPage();
  },
  chapter(d, last) { const R = Model.R, n = R.i + d; if (n >= 0 && n < R.chs.length) { R.i = n; this.loadPages(last ? 9999 : 1); } },
  closeReader() { Model.saveProgress(); View.readerClose(); this.show(Model.tab); },
  setReader(p, reload) {
    Model.setReader(p); View.readerSettings(Model.reader);
    if (reload) this.loadPages(Model.R.p); else if (Model.R.pages.length && p.dir) this.render();
  },

  /* ---------- eventos ---------- */
  bind() {
    document.addEventListener('click', e => this.onClick(e));
    document.addEventListener('keydown', e => this.onKey(e));
    document.addEventListener('change', e => this.onChange(e));
    $('#q').addEventListener('input', e => { // busca com debounce
      clearTimeout(searchT); const v = e.target.value.trim();
      searchT = setTimeout(() => {
        if (v.length >= 2) Model.track('searches', v.toLocaleLowerCase());
        return v.length < 2
        ? this.show('home')
        : this.grid(`Resultados para “${View.esc(v)}”`, '', false, v);
      }, 450);
    });
    $('#searchBtn').addEventListener('click', () => {
      const open = !document.body.classList.contains('search-open');
      if (open) {
        document.body.classList.remove('menu-open');
        View.closeProfile();
      }
      View.searchOpen(open);
      if (!open) this.show('home');
      if (open) $('#q').focus();
    });
    $('#searchClose').addEventListener('click', () => {
      View.searchOpen(false);
      this.show('home');
    });
    $('#menuBtn').addEventListener('click', () => document.body.classList.add('menu-open'));
    $('#menuClose').addEventListener('click', () => document.body.classList.remove('menu-open'));
    $('#menuBackdrop').addEventListener('click', () => { document.body.classList.remove('menu-open'); View.closeProfile(); });
    $('#sBr').addEventListener('input', e => this.setReader({ br: +e.target.value }));
    $('#ov').addEventListener('click', e => { if (e.target.id === 'ov') this.closeModal(); });
    addEventListener('popstate', () => {
      const id = new URLSearchParams(location.search).get('manga');
      id ? this.openManga(id, false) : View.closeModal();
    });
    // arrastar carrosséis com o mouse (no toque a rolagem já é nativa)
    document.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse') return;
      const r = e.target.closest('.row,.chips'); if (r) drag = { r, x: e.clientX, s: r.scrollLeft, m: false };
    });
    addEventListener('pointermove', e => {
      if (!drag) return; const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 6) { drag.m = true; drag.r.classList.add('drag'); }
      if (drag.m) drag.r.scrollLeft = drag.s - dx;
    });
    addEventListener('pointerup', () => {
      if (drag?.m) { suppress = true; setTimeout(() => suppress = false, 0); }
      drag?.r.classList.remove('drag'); drag = null;
    });
    // leitor: deslizar para virar página e rolagem para a barra de progresso
    const st = $('#stage');
    st.addEventListener('touchstart', e => tx = e.touches[0].clientX, { passive: true });
    st.addEventListener('touchend', e => { if (Model.reader.dir !== 'h') return; const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 50) this.go(dx < 0 ? 1 : -1); }, { passive: true });
    st.addEventListener('scroll', () => { if (Model.reader.dir === 'v') requestAnimationFrame(() => this.sync()); }, { passive: true });
    document.addEventListener('click', e => {
      if (document.body.classList.contains('search-open') && !e.target.closest('header')) View.searchOpen(false);
    });
  },
  onClick(e) {
    if (suppress) return;
    const t = e.target, c = s => t.closest(s);
    let x;
    if (x = c('[data-auth-mode]')) return View.authMode(x.dataset.authMode);
    if (x = c('[data-social]')) {
      return Model.startSocial(x.dataset.social).catch(error => View.toast(error.message));
    }
    if (x = c('[data-crop-cancel]')) return this.closeCrop();
    if (x = c('[data-crop-confirm]')) return this.confirmCrop();
    if (c('#authSave')) return this.authenticate();
    if (x = c('[data-close-profile]')) return View.closeProfile();
    if (x = c('[data-save]')) return this.toggleSaved(x.dataset.save);
    if (x = c('[data-share]')) return this.share(x.dataset.share);
    if (c('[data-search-back]')) {
      View.searchOpen(false);
      return this.show('home');
    }
    if (c('[data-home-back]')) return this.show('home');
    if (x = c('[data-download-ch]')) return this.downloadChapter(+x.dataset.downloadCh);
    if (t.closest('.download-check')) return;
    if (x = c('[data-download-open]')) return this.openDownloaded(x.dataset.downloadOpen);
    if (c('#toggleDownloadSelect')) {
      downloadSelectionMode = !downloadSelectionMode;
      document.querySelectorAll('.download-check').forEach(check => { check.hidden = !downloadSelectionMode; });
      c('#toggleDownloadSelect').hidden = downloadSelectionMode;
      const selection = $('#downloadSelection');
      if (selection) selection.hidden = !downloadSelectionMode;
      if (!downloadSelectionMode) document.querySelectorAll('[data-download-select]').forEach(input => { input.checked = false; });
      return;
    }
    if (c('#clearDownloadSelection')) {
      document.querySelectorAll('[data-download-select], #selectAllDownloads').forEach(input => { input.checked = false; });
      return;
    }
    if (c('#deleteSelectedDownloads')) return this.deleteSelectedDownloads();
    if (c('#avBtn')) {
      document.body.classList.remove('menu-open');
      View.searchOpen(false);
      return View.profileDrawer(Model.profile);
    }
    if (c('[data-close]')) return this.closeModal();
    if (x = c('.nav')) return View.scrollRow(x);
    if (x = c('.chip')) {
      Model.track('genres', x.dataset.tagName || x.dataset.n);
      return this.grid('Gênero: ' + x.dataset.n, `includedTags[]=${x.dataset.tag}&order[followedCount]=desc`, true);
    }
    if (x = c('[data-tab]')) { $('#q').value = ''; document.body.classList.remove('menu-open'); return this.show(x.dataset.tab); }
    if (c('[data-more]')) { View.moreLoading(); return this.loadMore(); }
    if (x = c('[data-retry]')) return x.dataset.retry === 'reader' ? this.loadPages(Model.R.p) : Model.filters ? this.grid(Model.filters.title, Model.filters.extra, Model.filters.g2) : this.show(Model.tab);
    if (c('#readBtn')) return chs.length && this.startReading(cur, resume);
    if (x = c('[data-ch]')) return this.startReading(+x.dataset.ch, 1);
    if (x = c('[data-z]')) { const z = x.dataset.z; return z === 'c' ? View.toggleBar() : this.go(z === 'l' ? -1 : 1); }
    if ($('#reader').classList.contains('open') && c('#stage') && !c('[data-nextch]')) return View.toggleBar();
    if (c('[data-nextch]')) return this.chapter(1);
    if (c('#rBack')) return this.closeReader();
    if (c('#rSet')) return View.togglePanel();
    if (x = c('[data-rbg]')) return this.setReader({ bg: x.dataset.rbg });
    if (x = c('[data-rd]')) return this.setReader({ dir: x.dataset.rd });
    if (x = c('[data-rq]')) return this.setReader({ q: x.dataset.rq }, true);
    if (c('#logoutBtn')) return this.logout();
    if (x = c('[data-set-theme]')) { const th = x.dataset.setTheme; Model.setTheme(th); View.theme(th); return View.setThemeButtons(th); }
    if (c('#animationToggle')) {
      const enabled = !Model.animations;
      Model.setAnimations(enabled);
      View.animations(enabled);
      c('#animationToggle').classList.toggle('on', enabled);
      c('#animationToggle').setAttribute('aria-checked', String(enabled));
      return;
    }
    if (c('#themeBtn')) { const n = Model.theme === 'dark' ? 'light' : 'dark'; Model.setTheme(n); return View.theme(n); }
    if (c('#clrProg')) { Model.clearProgress(); return View.btnText('clrProg', '✓ Histórico limpo'); }
    if (c('#clrSaved')) { Model.clearSaved(); return View.btnText('clrSaved', '✓ Salvos limpos'); }
    if (x = c('[data-id]')) return this.openManga(x.dataset.id);
  },
  async deleteSelectedDownloads() {
    const ids = [...document.querySelectorAll('[data-download-select]:checked')].map(input => input.dataset.downloadSelect);
    if (!ids.length) return View.toast('Selecione pelo menos um download.');
    if (!await View.confirm(`Apagar ${ids.length} download${ids.length === 1 ? '' : 's'} selecionado${ids.length === 1 ? '' : 's'}? Esta ação não poderá ser desfeita.`)) return;
    try {
      for (const id of ids) await Model.removeChapterDownload(id);
      downloadSelectionMode = false;
      this.show('downloads');
      View.toast(`${ids.length} download${ids.length === 1 ? '' : 's'} removido${ids.length === 1 ? '' : 's'}.`);
    } catch {
      View.toast('Não foi possível remover todos os downloads selecionados.');
    }
  },
  onChange(e) {
    if (e.target.id === 'selectAllDownloads') {
      document.querySelectorAll('[data-download-select]').forEach(input => { input.checked = e.target.checked; });
      return;
    }
    if (e.target.matches('[data-download-select]')) {
      const inputs = [...document.querySelectorAll('[data-download-select]')];
      const all = $('#selectAllDownloads');
      if (all) all.checked = inputs.length > 0 && inputs.every(input => input.checked);
      return;
    }
    if (e.target.id === 'pPhotoFile') return this.readPhoto(e.target.files?.[0]);
    if (e.target.id === 'cropZoom') {
      if (cropState) cropState.zoom = Number(e.target.value);
      return this.renderCrop();
    }
    if (e.target.id === 'cLang') { Model.setCfg({ lang: e.target.value }); View.hint('✓ Idioma salvo. Volte ao Início para ver o catálogo atualizado.'); }
    if (e.target.id === 'rChap') { Model.R.i = +e.target.value; this.loadPages(1); }
  },
  async authenticate() {
    const login = !$('#authLogin').hidden;
    const button = $('#authSave');
    const username = login ? $('#authUsername').value.trim() : $('#authSignupUsername').value.trim();
    const email = login ? '' : $('#authEmail').value.trim();
    const name = login ? '' : $('#authName').value.trim();
    if (!username || (!login && (!email || !name))) return View.toast(login ? 'Username é obrigatório.' : 'Nome, e-mail e username são obrigatórios.');
    button.disabled = true; button.textContent = 'Sincronizando…';
    try {
      const result = login ? await Model.login(username) : await Model.createAccount({ username, email, name });
      await Model.refreshDownloadIntegrity();
      await Model.syncDownloads();
      document.body.classList.remove('auth-required');
      View.hideLogin();
      View.avatar(Model.profile.photoUrl || Model.profile.avatar, Model.profile.username);
      this.show('home');
      View.toast(login ? 'Login realizado ✓' : 'Cadastro realizado ✓');
    } catch (error) {
      View.toast(error.message);
    } finally {
      button.disabled = false; button.textContent = login ? 'Entrar' : 'Criar conta';
    }
  },
  async logout() {
    await Model.logout();
    document.body.classList.add('auth-required');
    View.closeProfile();
    View.login();
    View.toast('Você saiu da conta.');
  },
  readPhoto(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return View.toast('Selecione um arquivo de imagem.');
    if (file.size > 2 * 1024 * 1024) return View.toast('A imagem deve ter no máximo 2 MB.');
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        cropState = { image, zoom: 1, x: 0, y: 0, startX: 0, startY: 0, dragging: false };
        View.cropModal(reader.result);
        this.renderCrop();
        this.bindCropPointer();
      };
      image.onerror = () => View.toast('Não foi possível abrir a imagem.');
      image.src = reader.result;
    };
    reader.onerror = () => View.toast('Não foi possível ler a imagem.');
    reader.readAsDataURL(file);
  },
  bindCropPointer() {
    const stage = $('#cropStage');
    if (!stage) return;
    stage.onpointerdown = event => {
      if (!cropState) return;
      cropState.dragging = true;
      cropState.startX = event.clientX - cropState.x;
      cropState.startY = event.clientY - cropState.y;
      stage.setPointerCapture(event.pointerId);
    };
    stage.onpointermove = event => {
      if (!cropState?.dragging) return;
      cropState.x = event.clientX - cropState.startX;
      cropState.y = event.clientY - cropState.startY;
      this.renderCrop();
    };
    stage.onpointerup = () => { if (cropState) cropState.dragging = false; };
    stage.onpointercancel = () => { if (cropState) cropState.dragging = false; };
    stage.onwheel = event => {
      if (!cropState) return;
      event.preventDefault();
      cropState.zoom = Math.max(1, Math.min(3, cropState.zoom - event.deltaY * .001));
      $('#cropZoom').value = cropState.zoom;
      this.renderCrop();
    };
  },
  renderCrop() {
    const image = $('#cropImage');
    if (!image || !cropState) return;
    const stage = $('#cropStage');
    const guideSize = stage.querySelector('.crop-guide')?.getBoundingClientRect().width ||
      Math.min(stage.clientWidth, stage.clientHeight) * .78;
    const base = Math.max(guideSize / cropState.image.naturalWidth, guideSize / cropState.image.naturalHeight);
    image.style.width = `${cropState.image.naturalWidth * base}px`;
    image.style.height = `${cropState.image.naturalHeight * base}px`;
    image.style.transform = `translate(-50%, -50%) translate(${cropState.x}px, ${cropState.y}px) scale(${cropState.zoom})`;
  },
  async confirmCrop() {
    if (!cropState?.image) return;
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const context = canvas.getContext('2d');
    const stage = $('#cropStage');
    const guide = stage.querySelector('.crop-guide')?.getBoundingClientRect();
    if (!guide || !context) return;
    const image = cropState.image;
    const stageRect = stage.getBoundingClientRect();
    const guideSize = guide.width;
    const imageRect = $('#cropImage').getBoundingClientRect();
    const imageScale = imageRect.width / image.naturalWidth;
    const guideLeft = guide.left - stageRect.left;
    const guideTop = guide.top - stageRect.top;
    const imageLeft = imageRect.left - stageRect.left;
    const imageTop = imageRect.top - stageRect.top;
    const sourceX = (guideLeft - imageLeft) / imageScale;
    const sourceY = (guideTop - imageTop) / imageScale;
    const sourceSize = guideSize / imageScale;
    const maxSourceX = Math.max(0, image.naturalWidth - sourceSize);
    const maxSourceY = Math.max(0, image.naturalHeight - sourceSize);
    context.drawImage(
      image,
      Math.max(0, Math.min(maxSourceX, sourceX)),
      Math.max(0, Math.min(maxSourceY, sourceY)),
      Math.min(sourceSize, image.naturalWidth),
      Math.min(sourceSize, image.naturalHeight),
      0, 0, size, size
    );
    const dataUrl = canvas.toDataURL('image/jpeg', .88);
    const preview = document.querySelector('.profile-photo-preview, .profile-drawer-avatar');
    if (preview) preview.innerHTML = `<img src="${View.esc(dataUrl)}" alt="Foto de perfil">`;
    try {
      const user = await Model.updateProfile({ ...Model.profile, photoUrl: dataUrl });
      Model.setProfile({ id: user.id, photoUrl: user.foto_url || dataUrl });
      View.avatar(Model.profile.photoUrl, Model.profile.username);
      View.closeCrop();
      View.toast('Foto de perfil salva ✓');
    } catch (error) {
      if (preview) preview.innerHTML = View.profilePhoto(Model.profile);
      View.toast(error.message);
    } finally {
      cropState = null;
    }
  },
  closeCrop() {
    cropState = null;
    View.closeCrop();
  },
  async openDownloaded(chapterId) {
    const entry = Model.downloadedChapters()[chapterId];
    if (!entry?.localAvailable) return View.toast('Este capítulo foi baixado em outro dispositivo. Baixe-o neste aparelho para ler offline.');
    const manga = entry.manga || Model.cache[entry.mangaId] || Model.offlineManga(entry.mangaId);
    if (!manga) return View.toast('Não foi possível localizar o mangá baixado.');
    const list = Object.values(Model.downloadedChapters()).filter(d => d.localAvailable && d.mangaId === entry.mangaId)
      .sort((a, b) => Number.parseFloat(a.num) - Number.parseFloat(b.num))
      .map(d => ({ id: d.chapterId, num: d.num, title: d.title || '', language: d.language, source: d.source }));
    Model.current = manga; chs = list; cur = Math.max(0, list.findIndex(c => c.id === chapterId)); resume = 1;
    this.startReading(cur, 1);
  },
  onKey(e) {
    if (e.key === 'Enter' && e.target.classList?.contains('card')) return this.openManga(e.target.dataset.id);
    if (e.key === 'Escape') {
      if (document.body.classList.contains('search-open')) return View.searchOpen(false);
      if (document.body.classList.contains('profile-open')) return View.closeProfile();
      return $('#reader').classList.contains('open') ? this.closeReader() : this.closeModal();
    }
    if (!$('#reader').classList.contains('open') || Model.reader.dir === 'v') return;
    if (['ArrowRight', ' '].includes(e.key)) this.go(1);
    if (e.key === 'ArrowLeft') this.go(-1);
  }
};