import { Model } from './Model.js';
import { View } from './View.js';

const $ = View.$;
// Seções da home (os gêneros ficam só nos chips, sem blocos repetidos)
const SECS = [
  [' Em alta', 'order[followedCount]=desc'],
  [' Mais bem avaliados', 'order[rating]=desc'],
  [' Atualizados recentemente', 'order[latestUploadedChapter]=desc'],
  [' Novos no catálogo', 'order[createdAt]=desc'],
  [' Obras completas', 'status[]=completed&order[followedCount]=desc']
];
let secIO, drag = null, suppress = false, searchT, saveT, tx = 0, chs = [], cur = 0, resume = 1;

export const Controller = {
  init() {
    View.theme(Model.theme); View.avatar(Model.profile.avatar);
    this.bind(); this.show('home');
    const id = new URLSearchParams(location.search).get('manga'); // link compartilhado
    if (id) this.openManga(id, false);
  },

  /* ---------- navegação entre abas ---------- */
  show(tab) {
    Model.tab = tab; Model.filters = null;
    if (tab === 'home') return this.home();
    if (tab === 'saved') { const l = Object.values(Model.saved()); l.forEach(m => Model.cache[m.id] ??= m); return View.saved(l); }
    View.settings(Model.cfg, Model.theme);
  },
  async home() {
    const prog = Object.values(Model.progress()).sort((a, b) => b.ts - a.ts);
    prog.forEach(p => Model.cache[p.id] ??= p.manga);
    const secs = View.home(prog, SECS);
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
    } catch { View.sectionError(el); if (!i) View.removeEl($('#hero')); }
  },
  async genres() {
    try { View.genres((await Model.tags()).filter(t => t.g === 'genre').sort((a, b) => a.n.localeCompare(b.n))); }
    catch { View.genresFail(); }
  },

  /* ---------- listagens com "Carregar Mais" ---------- */
  grid(title, extra, g2 = false, search = '') {
    Model.filters = { title, extra, g2, search, offset: 0 };
    View.gridShell(title, g2); this.loadMore(true);
  },
  async loadMore(first = false) {
    const f = Model.filters; if (!f) return;
    try {
      const { items, total } = f.search
        ? await Model.search(f.search, f.offset)
        : await Model.list(`${f.extra}&limit=24&offset=${f.offset}`);
      if (f !== Model.filters) return; // o usuário navegou para outro lugar
      f.offset += items.length; View.gridAdd(items, first, f.offset < total);
    } catch { if (f === Model.filters) View.gridError(); }
  },

  /* ---------- detalhes + deep link ---------- */
  async openManga(id, push = true) {
    let m;
    try { m = await Model.getManga(id); } catch { return View.toast('Mangá não encontrado.'); }
    if (push) history.pushState({ manga: id }, '', '?manga=' + id);
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
    if (!ch || !m || Model.isChapterDownloaded(ch.id)) return;
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
      View.toast(`Capítulo ${ch.num} baixado para ler offline.`);
    } catch {
      if (button) {
        button.disabled = false;
        button.textContent = '↓';
      }
      View.toast('Não foi possível baixar este capítulo. Verifique a conexão e tente novamente.');
    }
  },

  /* ---------- leitor ---------- */
  startReading(i, page) {
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
      searchT = setTimeout(() => v.length < 2
        ? this.show('home')
        : this.grid(`Resultados para “${View.esc(v)}”`, '', false, v), 450);
    });
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
  },
  onClick(e) {
    if (suppress) return;
    const t = e.target, c = s => t.closest(s);
    let x;
    if (x = c('[data-save]')) return this.toggleSaved(x.dataset.save);
    if (x = c('[data-share]')) return this.share(x.dataset.share);
    if (x = c('[data-download-ch]')) return this.downloadChapter(+x.dataset.downloadCh);
    if (c('#avBtn')) return View.profileModal(Model.profile);
    if (c('[data-close]')) return this.closeModal();
    if (x = c('.nav')) return View.scrollRow(x);
    if (x = c('.chip')) return this.grid('Gênero: ' + x.dataset.n, `includedTags[]=${x.dataset.tag}&order[followedCount]=desc`, true); // 2 colunas
    if (x = c('[data-tab]')) { $('#q').value = ''; return this.show(x.dataset.tab); }
    if (c('[data-more]')) { View.moreLoading(); return this.loadMore(); }
    if (x = c('[data-retry]')) return x.dataset.retry === 'reader' ? this.loadPages(Model.R.p) : Model.filters ? this.grid(Model.filters.title, Model.filters.extra, Model.filters.g2) : this.show(Model.tab);
    if (c('#readBtn')) return chs.length && this.startReading(cur, resume);
    if (x = c('[data-ch]')) return this.startReading(+x.dataset.ch, 1);
    if (x = c('[data-z]')) { const z = x.dataset.z; return z === 'c' ? View.toggleBar() : this.go(z === 'l' ? -1 : 1); }
    if (c('[data-nextch]')) return this.chapter(1);
    if (c('#rBack')) return this.closeReader();
    if (c('#rSet')) return View.togglePanel();
    if (x = c('[data-rbg]')) return this.setReader({ bg: x.dataset.rbg });
    if (x = c('[data-rd]')) return this.setReader({ dir: x.dataset.rd });
    if (x = c('[data-rq]')) return this.setReader({ q: x.dataset.rq }, true);
    if (x = c('[data-av]')) return View.pickAvatar(x);
    if (x = c('[data-rm]')) return View.pickMode(x);
    if (c('#pSave')) { const f = View.readProfileForm(); Model.setProfile(f); View.avatar(f.avatar); View.closeModal(); return View.toast('Perfil salvo ✓'); }
    if (x = c('[data-set-theme]')) { const th = x.dataset.setTheme; Model.setTheme(th); View.theme(th); return View.setThemeButtons(th); }
    if (c('#themeBtn')) { const n = Model.theme === 'dark' ? 'light' : 'dark'; Model.setTheme(n); return View.theme(n); }
    if (c('#clrProg')) { Model.clearProgress(); return View.btnText('clrProg', '✓ Histórico limpo'); }
    if (c('#clrSaved')) { Model.clearSaved(); return View.btnText('clrSaved', '✓ Salvos limpos'); }
    if (x = c('[data-id]')) return this.openManga(x.dataset.id);
  },
  onChange(e) {
    if (e.target.id === 'cLang') { Model.setCfg({ lang: e.target.value }); View.hint('✓ Idioma salvo. Volte ao Início para ver o catálogo atualizado.'); }
    if (e.target.id === 'rChap') { Model.R.i = +e.target.value; this.loadPages(1); }
  },
  onKey(e) {
    if (e.key === 'Enter' && e.target.classList?.contains('card')) return this.openManga(e.target.dataset.id);
    if (e.key === 'Escape') return $('#reader').classList.contains('open') ? this.closeReader() : this.closeModal();
    if (!$('#reader').classList.contains('open') || Model.reader.dir === 'v') return;
    if (['ArrowRight', ' '].includes(e.key)) this.go(1);
    if (e.key === 'ArrowLeft') this.go(-1);
  }
};