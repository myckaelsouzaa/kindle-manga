import { Model } from './Model.js';
import { View, THEMES } from './View.js';
import { PremiumModel } from './PremiumModel.js';
import { premiumController } from './premiumController.js';

const $ = View.$;
// Seções da home (os gêneros ficam só nos chips, sem blocos repetidos)
const SECS = [
  ['Em alta', 'order[followedCount]=desc'],
  ['Mais bem avaliados', 'order[rating]=desc'],
  ['Atualizados recentemente', 'order[latestUploadedChapter]=desc'],
  ['Novos no catálogo', 'order[createdAt]=desc'],
  ['Próximos lançamentos', 'status[]=ongoing&order[latestUploadedChapter]=asc'],
  ['Obras completas', 'status[]=completed&order[followedCount]=desc']
];
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const MANGA_ID = /^[\w-]{8,64}$/;

let sectionObserver, drag = null, suppressClick = false, searchTimer, saveTimer, syncTimer, touchX = 0;
let chapters = [], currentIndex = 0, resumePage = 1, pageRequest = 0;
let cropState = null, selectionMode = false, chapterSort = 'oldest';

const chapterNumber = value => Number.parseFloat(String(value).replace(',', '.'));
const byText = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR', { numeric: true });
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// Downloads: número do capítulo, depois título do mangá e texto do número
function compareDownloads(a, b) {
  const an = chapterNumber(a.num), bn = chapterNumber(b.num);
  if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
  if (Number.isFinite(an) !== Number.isFinite(bn)) return Number.isFinite(an) ? -1 : 1;
  return byText(a.manga?.title, b.manga?.title) || byText(a.num, b.num);
}

function setSelectionMode(on) {
  selectionMode = on;
  document.querySelectorAll('.download-check').forEach(check => { check.hidden = !on; });
  const toggle = $('#toggleDownloadSelect'), panel = $('#downloadSelection');
  if (toggle) toggle.hidden = on;
  if (panel) panel.hidden = !on;
  if (!on) document.querySelectorAll('[data-download-select], #selectAllDownloads').forEach(input => { input.checked = false; });
}

// Ações de clique, avaliadas em ordem: o primeiro seletor que casar com o alvo é executado.
const CLICK_ACTIONS = [
  ['[data-premium]', el => PremiumController.act(el.dataset.premium, el)],
  ['[data-auth-mode]', el => View.authMode(el.dataset.authMode)],
  ['[data-open-auth]', el => { View.closeProfile(); View.login(); View.authMode(el.dataset.openAuth); }],
  ['[data-auth-close]', () => { View.hideLogin(); Controller.show('home'); }],
  ['[data-social]', el => Model.startSocial(el.dataset.social).catch(error => View.toast(error.message))],
  ['[data-crop-cancel]', () => Controller.closeCrop()],
  ['[data-crop-confirm]', () => Controller.confirmCrop()],
  ['#authSave', () => Controller.authenticate()],
  ['[data-close-profile]', () => View.closeProfile()],
  ['[data-save]', el => Controller.toggleSaved(el.dataset.save)],
  ['[data-share]', el => Controller.share(el.dataset.share)],
  ['[data-search-back]', () => { View.searchOpen(false); Controller.show('home'); }],
  ['[data-home-back]', () => Controller.show('home')],
  ['[data-download-ch]', el => Controller.downloadChapter(+el.dataset.downloadCh)],
  ['.download-check', () => undefined],
  ['[data-download-open]', el => Controller.openDownloaded(el.dataset.downloadOpen)],
  ['#toggleDownloadSelect', () => setSelectionMode(!selectionMode)],
  ['#clearDownloadSelection', () => setSelectionMode(false)],
  ['#deleteSelectedDownloads', () => Controller.deleteSelectedDownloads()],
  ['#avBtn', () => { document.body.classList.remove('menu-open'); View.searchOpen(false); View.profileDrawer(Model.profile); }],
  ['[data-close]', () => Controller.closeModal()],
  ['.nav', el => View.scrollRow(el)],
  ['.chip', el => Controller.grid('Gênero: ' + el.dataset.n, `includedTags[]=${encodeURIComponent(el.dataset.tag)}&order[followedCount]=desc`, true)],
  ['[data-tab]', el => { $('#q').value = ''; document.body.classList.remove('menu-open'); Controller.show(el.dataset.tab); }],
  ['[data-more]', () => { View.moreLoading(); Controller.loadMore(); }],
  ['[data-retry]', el => {
    if (el.dataset.retry === 'reader') return Controller.loadPages(Model.R.p);
    return Model.filters ? Controller.grid(Model.filters.title, Model.filters.extra, Model.filters.g2) : Controller.show(Model.tab);
  }],
  ['#readBtn', () => chapters.length && Controller.startReading(currentIndex, resumePage)],
  ['[data-ch]', el => Controller.startReading(+el.dataset.ch, 1)],
  ['[data-z]', el => el.dataset.z === 'c' ? View.toggleBar() : Controller.go(el.dataset.z === 'l' ? -1 : 1)],
  // Toque no leitor (fora dos controles) alterna a barra superior
  [target => $('#reader').classList.contains('open') && target.closest('#stage') && !target.closest('[data-nextch], #rChap, #rSet'), () => View.toggleBar()],
  ['[data-nextch]', () => Controller.chapter(1)],
  ['#rBack', () => Controller.closeReader()],
  ['#rSet', () => View.togglePanel()],
  ['[data-rbg]', el => Controller.setReader({ bg: el.dataset.rbg })],
  ['[data-rd]', el => Controller.setReader({ dir: el.dataset.rd })],
  ['[data-rq]', el => Controller.setReader({ q: el.dataset.rq }, true)],
  ['[data-rl]', el => Controller.setReader({ layout: el.dataset.rl }, true)],
  ['[data-rp]', () => Controller.setReader({ progress: Model.reader.progress === false })],
  ['#logoutBtn', () => Controller.logout()],
  ['[data-theme-choice]', el => {
    const id = el.dataset.themeChoice;
    Model.setTheme(id);
    View.theme(id);
    View.closeModal();
    View.toast(`Tema ${THEMES.find(theme => theme.id === id)?.name || ''} aplicado.`);
  }],
  ['[data-theme-picker]', () => { document.body.classList.remove('menu-open'); View.themePicker(); }],
  ['#animationToggle', el => {
    const enabled = !Model.animations;
    Model.setAnimations(enabled);
    View.animations(enabled);
    el.classList.toggle('on', enabled);
    el.setAttribute('aria-checked', String(enabled));
  }],
  ['#themeBtn', () => View.themePicker()],
  ['#refreshReco', () => Controller.recommendations(true)],
  ['#recoSearch', () => { View.searchOpen(true); $('#q').focus(); }],
  ['[data-id]', el => Controller.openManga(el.dataset.id)]
];

export const Controller = {
  async init() {
    const params = new URLSearchParams(location.search);
    const socialError = params.get('social') === 'error' ? params.get('message') : '';
    if (!socialError) await Model.restoreSocialSession().catch(() => false);
    const premiumReturn = params.get('premium');
    if (socialError || params.has('code') || params.get('social') === 'success' || premiumReturn) history.replaceState(null, '', location.pathname);
    let authenticated = Boolean(Model.profile.username && Model.profile.email);
    // Contas locais abertas antes do controle de acesso não têm sessão no servidor: pedem novo login uma vez.
    const legacySession = authenticated && !Model.profile.sessionToken;
    if (legacySession) {
      await Model.logout().catch(() => undefined);
      authenticated = false;
    }
    if (authenticated) await this.syncAll();
    View.theme(Model.theme);
    View.animations(Model.animations);
    View.textSize(Model.textSize);
    View.avatar(Model.profile.photoUrl, Model.profile.username || Model.profile.name);
    PremiumController.init({
      // Salvos e Downloads mudam de aparência quando o nível muda (compra, vencimento, logout).
      onRoleChange: () => { if (['saved', 'downloads'].includes(Model.tab) && !Model.filters) this.show(Model.tab); }
    });
    this.bind();
    if (Model.pendingSocialProfile) View.socialProfile(Model.pendingSocialProfile);
    else this.show(authenticated && location.hash === '#reco' ? 'reco' : 'home');
    if (socialError) View.toast(socialError);
    if (legacySession) View.toast('Atualizamos o sistema de contas. Entre novamente para continuar.');
    if (premiumReturn) PremiumController.handleReturn(premiumReturn);
    const sharedId = new URLSearchParams(location.search).get('manga'); // link compartilhado
    if (sharedId) this.openManga(sharedId, false);
  },

  // Sincroniza downloads, salvos e progresso; no modo estrito a primeira falha interrompe o fluxo.
  async syncAll({ strict = false } = {}) {
    await Model.refreshDownloadIntegrity();
    for (const task of ['syncDownloads', 'syncSaved', 'syncProgress']) {
      try { await Model[task](); } catch (error) { if (strict) throw error; View.toast(error.message); }
    }
    await PremiumModel.refresh().catch(() => undefined); // nível e validade vêm sempre do servidor
  },

  /* ---------- navegação entre abas ---------- */
  show(tab) {
    Model.tab = tab;
    Model.filters = null;
    if (tab === 'reco') {
      Model.markRecommendationOpened();
      this.updateRecommendationMenu();
      return this.recommendations();
    }
    if (tab === 'saved') {
      const list = Object.values(Model.saved());
      list.forEach(manga => { Model.cache[manga.id] ??= manga; });
      return View.saved(list);
    }
    if (tab === 'downloads') {
      selectionMode = false;
      const render = () => {
        const list = Object.values(Model.downloadedChapters()).sort(compareDownloads);
        list.forEach(entry => {
          entry.manga ||= Model.offlineManga(entry.mangaId);
          if (entry.manga) Model.cache[entry.manga.id] = entry.manga;
        });
        return View.downloads(list);
      };
      return Model.refreshDownloadIntegrity().then(render).catch(error => { View.toast(error.message); return render(); });
    }
    return this.home();
  },
  async home() {
    const progress = Object.values(Model.progress()).sort((a, b) => b.ts - a.ts);
    progress.forEach(entry => { Model.cache[entry.id] ??= entry.manga; });
    Object.values(Model.saved()).forEach(manga => { Model.cache[manga.id] ??= manga; });
    const showRecommendations = Model.hasRecommendationSignals();
    const sections = View.home(progress, SECS, showRecommendations);
    sectionObserver?.disconnect();
    sectionObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { sectionObserver.unobserve(entry.target); this.fillSec(entry.target); }
    }), { rootMargin: '500px' });
    this.genres();
    if (showRecommendations) this.loadHomeRecommendations();
    this.fillSec(sections[0]);
    sections.slice(1).forEach(section => sectionObserver.observe(section));
  },
  async loadHomeRecommendations() {
    try {
      View.fillHomeRecommendations(await Model.recommendationSections());
    } catch (error) {
      console.warn('[MangaKindle] recomendações da Home indisponíveis:', error.message);
      View.fillHomeRecommendations([]);
    }
  },
  async recommendations(force = false) {
    View.recoLoading();
    if (!Model.hasRecommendationSignals()) return View.recoEmpty();
    try {
      View.recoTab(await Model.recommendationSections(force));
    } catch (error) {
      console.warn('[MangaKindle] recomendações indisponíveis:', error);
      View.recoError();
    }
  },
  async fillSec(el) { // a 1ª seção alimenta também o banner de destaques
    const index = +el.dataset.i;
    try {
      const { items } = await Model.list(SECS[index][1] + '&limit=20');
      if (!items.length) { View.removeEl(el); if (!index) View.removeEl($('#hero')); return; }
      View.fillSection(el, items);
      if (!index) View.hero(items);
    } catch {
      View.sectionError(el);
      if (!index) View.removeEl($('#hero'));
    }
  },
  async genres() {
    try { View.genres((await Model.tags()).filter(tag => tag.g === 'genre').sort((a, b) => a.n.localeCompare(b.n))); } catch { View.genresFail(); }
  },

  /* ---------- listagens com "Carregar mais" ---------- */
  grid(title, extra, wide = false, search = '') {
    Model.filters = { title, extra, g2: wide, search, offset: 0 };
    View.gridShell(title, wide, Boolean(search), Boolean(extra?.includes('includedTags[]')));
    this.loadMore(true);
  },
  async loadMore(first = false) {
    const filters = Model.filters;
    if (!filters) return;
    try {
      const { items, total } = filters.search
        ? await Model.search(filters.search, filters.offset)
        : await Model.list(`${filters.extra}&limit=24&offset=${filters.offset}`);
      if (filters !== Model.filters) return; // o usuário navegou para outro lugar
      if (filters.search && first) {
        Model.trackSearch(filters.search, items);
        this.updateRecommendationMenu(true);
        if (items.length) View.toast('Criamos recomendações para você.');
      }
      filters.offset += items.length;
      View.gridAdd(items, first, filters.offset < total);
    } catch {
      if (filters === Model.filters) View.gridError();
    }
  },

  /* ---------- detalhes e link compartilhado ---------- */
  async openManga(id, push = true) {
    if (!MANGA_ID.test(String(id))) return View.toast('Mangá não encontrado.');
    let manga;
    try { manga = await Model.getManga(id); } catch { return View.toast('Mangá não encontrado.'); }
    if (push) history.pushState({ manga: id }, '', `?manga=${encodeURIComponent(id)}`);
    Model.current = manga;
    chapters = [];
    currentIndex = 0;
    resumePage = 1;
    chapterSort = 'oldest';
    View.modal(manga, Model.isSaved(id));
    this.loadModal(manga);
  },
  closeModal() {
    if (history.state?.manga) return history.back(); // popstate fecha o modal
    View.closeModal();
    if (location.search) history.replaceState(null, '', location.pathname);
  },
  loadModal(manga) {
    const alive = () => Model.current?.id === manga.id, progress = Model.progressOf(manga.id);
    Model.chapters(manga).then(list => {
      if (!alive()) return;
      chapters = this.sortChapters(list, chapterSort);
      currentIndex = progress ? Math.max(0, chapters.findIndex(chapter => chapter.id === progress.chId)) : 0;
      resumePage = progress ? progress.page : 1;
      View.modalChapters(chapters, currentIndex, progress, chapterSort);
    }).catch(() => alive() && View.modalChaptersError());
    Model.extra(manga).then(extra => {
      if (!alive()) return;
      View.fact('fMag', extra?.mag || 'Não informado');
      if (extra?.year && !manga.year) View.fact('fPub', extra.year);
      if (extra?.score && !manga.rating) View.fact('fRate', `${extra.score} / 10 (MAL)`);
    }).catch(() => alive() && View.fact('fMag', 'Não informado'));
    if (Model.needsTranslation(manga)) { // sinopse -> idioma do sistema
      View.synopsis(null, 'Traduzindo sinopse…');
      Model.translate(manga)
        .then(text => alive() && View.synopsis(text, 'Sinopse traduzida automaticamente.'))
        .catch(() => alive() && View.synopsis(null, 'Tradução indisponível agora — exibindo o original.'));
    }
  },
  sortChapters(list, sort = 'recent') {
    const recent = sort === 'recent';
    return [...list].sort((a, b) => {
      if (sort === 'az' || sort === 'za') return (sort === 'az' ? 1 : -1) * byText(a.title || a.num, b.title || b.num);
      const an = chapterNumber(a.num), bn = chapterNumber(b.num);
      if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return recent ? bn - an : an - bn;
      return recent ? byText(b.num, a.num) : byText(a.num, b.num);
    });
  },
  async share(id) {
    const url = `${location.origin}${location.pathname}?manga=${encodeURIComponent(id)}`;
    try { if (navigator.share) return await navigator.share({ title: Model.cache[id]?.title, url }); } catch { return; }
    try {
      await navigator.clipboard.writeText(url);
      View.toast('Link copiado!');
    } catch { prompt('Copie o link:', url); }
  },
  toggleSaved(id) {
    if (!Model.isSaved(id) && !PremiumController.ensure('save')) return; // salvar é Premium; remover continua livre
    const on = Model.toggleSaved(id);
    View.syncSaved(id, on);
    this.updateRecommendationMenu(on);
    (on ? Model.saveSavedRecord(Model.cache[id]) : Model.removeSavedRecord(id)).catch(error => {
      if (on && PremiumController.handleApiError(error, 'save')) { // o servidor negou: desfaz o salvamento local
        Model.toggleSaved(id);
        View.syncSaved(id, false);
        this.updateRecommendationMenu();
        if (Model.tab === 'saved') this.show('saved');
        return;
      }
      View.toast(error.message);
    });
    if (on && Model.cache[id]) Model.cacheManga(Model.cache[id]).catch(() => View.toast('Mangá salvo, mas não foi possível preparar o cache offline.'));
    View.toast(on ? 'Salvo para ler depois' : 'Removido dos salvos');
    if (Model.tab === 'saved') this.show('saved');
  },

  /* ---------- downloads ---------- */
  async downloadChapter(index) {
    const chapter = chapters[index], manga = Model.current;
    if (!chapter || !manga) return;
    if (Model.isChapterDownloaded(chapter.id)) return this.removeChapterDownload(index); // remover continua livre
    if (!PremiumController.ensure('download')) return; // visitantes e plano gratuito veem a oferta Premium
    View.chapterDownloadState(chapter.id, 'loading', '…');
    try {
      await Model.downloadChapter(manga, chapter, (done, total) => View.chapterDownloadState(chapter.id, 'loading', `${Math.round(done / total * 100)}%`));
      View.chapterDownloadState(chapter.id, 'done');
      const warning = Model.downloadedChapters()[chapter.id]?.syncError ? ' Capítulo salvo neste aparelho, mas não foi sincronizado na nuvem.' : '';
      View.toast(`Capítulo ${chapter.num} baixado para ler offline.${warning}`);
    } catch (error) {
      Model.removeChapterDownload(chapter.id).catch(() => undefined);
      View.chapterDownloadState(chapter.id, 'available');
      View.toast(error.message || 'Não foi possível baixar este capítulo. Tente novamente.');
    }
  },
  async removeChapterDownload(index) {
    const chapter = chapters[index];
    if (!chapter || !await View.confirm(`Tem certeza que deseja apagar o Capítulo ${chapter.num}? Esta ação não poderá ser desfeita.`)) return;
    try {
      await Model.removeChapterDownload(chapter.id);
      View.chapterDownloadState(chapter.id, 'available');
      View.toast(`Download do capítulo ${chapter.num} removido.`);
    } catch {
      View.toast('Não foi possível remover este download.');
    }
  },
  async deleteSelectedDownloads() {
    const ids = [...document.querySelectorAll('[data-download-select]:checked')].map(input => input.dataset.downloadSelect);
    if (!ids.length) return View.toast('Selecione pelo menos um download.');
    const label = plural(ids.length, 'download');
    if (!await View.confirm(`Apagar ${label} selecionado${ids.length === 1 ? '' : 's'}? Esta ação não poderá ser desfeita.`)) return;
    try {
      for (const id of ids) await Model.removeChapterDownload(id);
      this.show('downloads');
      View.toast(`${label} removido${ids.length === 1 ? '' : 's'}.`);
    } catch {
      View.toast('Não foi possível remover todos os downloads selecionados.');
    }
  },
  openDownloaded(chapterId) {
    const entry = Model.downloadedChapters()[chapterId];
    if (!entry?.localAvailable) return View.toast('Este capítulo foi baixado em outro dispositivo. Baixe-o neste aparelho para ler offline.');
    const manga = entry.manga || Model.cache[entry.mangaId] || Model.offlineManga(entry.mangaId);
    if (!manga) return View.toast('Não foi possível localizar o mangá baixado.');
    const list = Object.values(Model.downloadedChapters())
      .filter(item => item.localAvailable && item.mangaId === entry.mangaId)
      .sort((a, b) => chapterNumber(a.num) - chapterNumber(b.num))
      .map(item => ({ id: item.chapterId, num: item.num, title: item.title || '', language: item.language, source: item.source }));
    Model.current = manga;
    chapters = list;
    currentIndex = Math.max(0, list.findIndex(chapter => chapter.id === chapterId));
    resumePage = 1;
    this.startReading(currentIndex, 1);
  },

  /* ---------- leitor ---------- */
  startReading(index, page) {
    if (chapters[index]?.source && chapters[index].source !== 'MangaDex') {
      return View.toast('Este capítulo pertence ao provedor secundário e não pode ser lido pelo leitor MangaDex.');
    }
    Object.assign(Model.R, { m: Model.current, chs: chapters, i: index, pages: [], p: 1 });
    View.closeModal();
    history.replaceState(null, '', location.pathname);
    View.readerOpen(Model.current.title, chapters);
    this.loadPages(page);
  },
  async loadPages(page = 1) {
    const R = Model.R, request = ++pageRequest;
    View.readerChapter(R.i);
    View.readerSettings(Model.reader);
    View.readerLoading();
    try {
      const pages = await Model.pages(R.chs[R.i].id, Model.reader.dir === 'v' ? 'data' : undefined);
      if (request !== pageRequest) return;
      R.pages = pages;
      R.p = Math.min(Math.max(1, page), pages.length);
      this.render();
    } catch {
      if (request === pageRequest) View.readerError();
    }
  },
  render() {
    const R = Model.R;
    if (Model.reader.dir === 'h') { View.readerH(); this.showPage(); return; }
    View.readerV(R.pages, R.p, page => { R.p = page; this.sync(); });
    this.sync();
  },
  showPage() {
    const R = Model.R;
    View.readerShow(R.pages[R.p - 1], [R.pages[R.p], R.pages[R.p + 1]]);
    this.sync();
  },
  sync() { // HUD, barra de progresso e salvamento automático
    const R = Model.R;
    if (!R.pages.length) return;
    View.hud(`Cap. ${R.chs[R.i].num} · Página ${R.p} / ${R.pages.length}`);
    if (Model.reader.dir === 'h') View.progress(R.p / R.pages.length);
    else {
      const { top, max } = View.stageScroll();
      View.progress(max > 0 ? top / max : R.p / R.pages.length);
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => Model.saveProgress(), 250);
  },
  go(direction) {
    const R = Model.R;
    if (Model.reader.dir === 'v') return View.scrollStage(direction);
    const next = R.p + direction * (Model.reader.layout === 'double' ? 2 : 1);
    if (next < 1) return this.chapter(-1, true);
    if (next > R.pages.length) return this.chapter(1);
    R.p = next;
    this.showPage();
  },
  chapter(direction, toLastPage) {
    const R = Model.R, next = R.i + direction;
    if (next < 0 || next >= R.chs.length) return;
    Model.saveProgress();
    R.i = next;
    this.loadPages(toLastPage ? 9999 : 1);
  },
  closeReader() {
    Model.saveProgress();
    View.readerClose();
    this.show(Model.tab);
  },
  setReader(settings, reload) {
    Model.setReader(settings);
    View.readerSettings(Model.reader);
    if (reload) this.loadPages(Model.R.p);
    else if (Model.R.pages.length && settings.dir) this.render();
  },

  /* ---------- eventos ---------- */
  bind() {
    document.addEventListener('click', event => this.onClick(event));
    document.addEventListener('keydown', event => this.onKey(event));
    document.addEventListener('change', event => this.onChange(event));
    $('#q').addEventListener('input', event => { // busca com debounce
      clearTimeout(searchTimer);
      const value = event.target.value.trim();
      searchTimer = setTimeout(() => value.length < 2 ? this.show('home') : this.grid(`Resultados para “${value}”`, '', false, value), 450);
    });
    this.updateRecommendationMenu();
    $('#searchBtn').addEventListener('click', () => {
      const open = !document.body.classList.contains('search-open');
      if (open) {
        document.body.classList.remove('menu-open');
        View.closeProfile();
      }
      View.searchOpen(open);
      if (open) $('#q').focus(); else this.show('home');
    });
    $('#searchClose').addEventListener('click', () => { View.searchOpen(false); this.show('home'); });
    $('#menuBtn').addEventListener('click', () => document.body.classList.add('menu-open'));
    $('#menuClose').addEventListener('click', () => document.body.classList.remove('menu-open'));
    $('#menuBackdrop').addEventListener('click', () => { document.body.classList.remove('menu-open'); View.closeProfile(); });
    $('#sBr').addEventListener('input', event => this.setReader({ br: +event.target.value }));
    $('#ov').addEventListener('click', event => { if (event.target.id === 'ov') this.closeModal(); });
    addEventListener('popstate', () => {
      const id = new URLSearchParams(location.search).get('manga');
      id ? this.openManga(id, false) : View.closeModal();
    });
    addEventListener('hashchange', () => { if (location.hash === '#reco') this.show('reco'); });

    // arrastar carrosséis com o mouse (no toque a rolagem já é nativa)
    document.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'mouse') return;
      const row = event.target.closest('.row,.chips');
      if (row) drag = { row, x: event.clientX, start: row.scrollLeft, moved: false };
    });
    addEventListener('pointermove', event => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      if (Math.abs(dx) > 6) { drag.moved = true; drag.row.classList.add('drag'); }
      if (drag.moved) drag.row.scrollLeft = drag.start - dx;
    });
    addEventListener('pointerup', () => {
      if (drag?.moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
      drag?.row.classList.remove('drag');
      drag = null;
    });

    // leitor: deslizar para virar página e rolagem para a barra de progresso
    const stage = $('#stage');
    stage.addEventListener('touchstart', event => { touchX = event.touches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', event => {
      if (Model.reader.dir !== 'h') return;
      const dx = event.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 50) this.go(dx < 0 ? 1 : -1);
    }, { passive: true });
    stage.addEventListener('scroll', () => { if (Model.reader.dir === 'v') requestAnimationFrame(() => this.sync()); }, { passive: true });
    document.addEventListener('click', event => {
      if (document.body.classList.contains('search-open') && !event.target.closest('header')) View.searchOpen(false);
    });

    // ao voltar para a aba, atualiza salvos e progresso vindos de outros dispositivos
    const resync = () => {
      if (document.visibilityState !== 'visible' || !Model.profile.id) return;
      clearTimeout(syncTimer);
      syncTimer = setTimeout(async () => {
        for (const task of ['syncSaved', 'syncProgress']) await Model[task]().catch(error => View.toast(error.message));
        await PremiumModel.refresh().catch(() => undefined); // captura PIX pago fora da página e vencimentos
      }, 300);
    };
    addEventListener('mk:session-expired', async () => {
      if (!Model.profile.id) return;
      PremiumModel.stopWatching();
      PremiumController.close();
      await Model.logout().catch(() => undefined);
      View.avatar('', 'Perfil');
      PremiumController.refreshUi();
      this.show('home');
      View.profileDrawer(Model.profile);
      View.toast('Sua sessão expirou. Entre novamente para continuar.');
    });
    document.addEventListener('visibilitychange', resync);
    addEventListener('focus', resync);
  },
  onClick(event) {
    if (suppressClick) return;
    const target = event.target;
    for (const [match, run] of CLICK_ACTIONS) {
      const element = typeof match === 'string' ? target.closest(match) : match(target);
      if (element) return run(element);
    }
  },
  updateRecommendationMenu(isNew = false) {
    const visible = Model.hasRecommendationSignals();
    document.querySelectorAll('[data-tab="reco"]').forEach(button => {
      button.hidden = !visible;
      button.classList.toggle('has-new', visible && (isNew || !Model.recommendationOpened));
      button.setAttribute('aria-label', visible ? 'Para você' : 'Para você indisponível');
    });
  },
  onChange(event) {
    const { target } = event;
    if (target.id === 'chapterSort') {
      const currentId = chapters[currentIndex]?.id;
      chapterSort = target.value;
      chapters = this.sortChapters(chapters, chapterSort);
      currentIndex = Math.max(0, chapters.findIndex(chapter => chapter.id === currentId));
      return View.modalChapters(chapters, currentIndex, Model.progressOf(Model.current?.id), chapterSort);
    }
    if (target.id === 'selectAllDownloads') {
      return document.querySelectorAll('[data-download-select]').forEach(input => { input.checked = target.checked; });
    }
    if (target.matches('[data-download-select]')) {
      const inputs = [...document.querySelectorAll('[data-download-select]')], all = $('#selectAllDownloads');
      if (all) all.checked = inputs.length > 0 && inputs.every(input => input.checked);
      return;
    }
    if (target.id === 'pPhotoFile') return this.readPhoto(target.files?.[0]);
    if (target.id === 'cropZoom') {
      if (cropState) cropState.zoom = Number(target.value);
      return this.renderCrop();
    }
    if (target.id === 'cLang') {
      Model.setCfg({ lang: target.value });
      View.toast('Idioma salvo. O catálogo será atualizado ao voltar ao início.');
    }
    if (target.id === 'cTextSize') { Model.setTextSize(target.value); View.textSize(target.value); }
    if (target.id === 'rChap') {
      const next = +target.value;
      if (next === Model.R.i) return;
      Model.R.i = next;
      this.loadPages(1);
    }
  },
  onKey(event) {
    if (event.key === 'Enter' && event.target.classList?.contains('card')) return this.openManga(event.target.dataset.id);
    if (event.key === 'Escape') {
      if (document.body.classList.contains('premium-open') || $('#premiumOv').classList.contains('open')) return PremiumController.close();
      if (document.body.classList.contains('search-open')) return View.searchOpen(false);
      if (document.body.classList.contains('profile-open')) return View.closeProfile();
      return $('#reader').classList.contains('open') ? this.closeReader() : this.closeModal();
    }
    if (!$('#reader').classList.contains('open') || Model.reader.dir === 'v') return;
    if (['ArrowRight', ' '].includes(event.key)) this.go(1);
    if (event.key === 'ArrowLeft') this.go(-1);
  },

  /* ---------- conta e perfil ---------- */
  async authenticate() {
    const social = Boolean(Model.pendingSocialProfile), login = !social && !$('#authLogin').hidden;
    const field = selector => $(selector)?.value.trim() ?? '';
    const username = field(social ? '#socialUsername' : '#authName');
    const email = social ? '' : field(login ? '#authLoginEmail' : '#authEmail');
    const password = social ? '' : field(login ? '#authLoginPassword' : '#authSignupPassword');
    const name = social || login ? '' : field('#authName');
    if (!social && (!email || !password || (!login && !name))) {
      return View.toast(login ? 'E-mail e senha são obrigatórios.' : 'Nome, e-mail e senha são obrigatórios.');
    }
    const button = $('#authSave'), idleLabel = social ? 'Continuar' : login ? 'Entrar' : 'Criar conta';
    button.disabled = true;
    button.textContent = social ? 'Criando perfil…' : 'Sincronizando…';
    try {
      if (social) await Model.completeSocialProfile(username);
      else await (login ? Model.login(email, password) : Model.createAccount({ username: name, email, password }));
      await this.syncAll({ strict: true });
      View.hideLogin();
      View.avatar(Model.profile.photoUrl, Model.profile.username);
      PremiumController.refreshUi();
      this.show('home');
      View.toast(social ? 'Perfil criado.' : login ? 'Login realizado.' : 'Cadastro realizado.');
    } catch (error) {
      View.toast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = idleLabel;
    }
  },
  async logout() {
    PremiumModel.stopWatching();
    await Model.logout();
    PremiumController.refreshUi();
    View.closeProfile();
    document.body.classList.remove('auth-required');
    View.avatar('', 'Perfil');
    this.show('home');
    View.toast('Você saiu da conta.');
  },
  readPhoto(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return View.toast('Selecione um arquivo de imagem.');
    if (file.size > MAX_PHOTO_BYTES) return View.toast('A imagem deve ter no máximo 2 MB.');
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
    const stop = () => { if (cropState) cropState.dragging = false; };
    stage.onpointerdown = event => {
      if (!cropState) return;
      Object.assign(cropState, { dragging: true, startX: event.clientX - cropState.x, startY: event.clientY - cropState.y });
      stage.setPointerCapture(event.pointerId);
    };
    stage.onpointermove = event => {
      if (!cropState?.dragging) return;
      cropState.x = event.clientX - cropState.startX;
      cropState.y = event.clientY - cropState.startY;
      this.renderCrop();
    };
    stage.onpointerup = stop;
    stage.onpointercancel = stop;
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
    const guideSize = stage.querySelector('.crop-guide')?.getBoundingClientRect().width || Math.min(stage.clientWidth, stage.clientHeight) * .78;
    const { naturalWidth, naturalHeight } = cropState.image, base = Math.max(guideSize / naturalWidth, guideSize / naturalHeight);
    image.style.width = `${naturalWidth * base}px`;
    image.style.height = `${naturalHeight * base}px`;
    image.style.transform = `translate(-50%, -50%) translate(${cropState.x}px, ${cropState.y}px) scale(${cropState.zoom})`;
  },
  // Recorta a área da guia (quadrada) e salva a foto em 512x512
  async confirmCrop() {
    if (!cropState?.image) return;
    const size = 512, canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
    const context = canvas.getContext('2d'), guide = $('#cropStage').querySelector('.crop-guide')?.getBoundingClientRect();
    if (!guide || !context) return;
    const { image } = cropState, imageRect = $('#cropImage').getBoundingClientRect();
    const scale = imageRect.width / image.naturalWidth, sourceSize = guide.width / scale;
    const clamp = (value, max) => Math.max(0, Math.min(Math.max(0, max), value));
    context.drawImage(
      image,
      clamp((guide.left - imageRect.left) / scale, image.naturalWidth - sourceSize),
      clamp((guide.top - imageRect.top) / scale, image.naturalHeight - sourceSize),
      Math.min(sourceSize, image.naturalWidth), Math.min(sourceSize, image.naturalHeight),
      0, 0, size, size
    );
    const dataUrl = canvas.toDataURL('image/jpeg', .88);
    const preview = document.querySelector('.profile-photo-preview, .profile-drawer-avatar');
    if (preview) preview.innerHTML = `<img src="${View.esc(dataUrl)}" alt="Foto de perfil">`;
    try {
      const user = await Model.updateProfile({ ...Model.profile, photoUrl: dataUrl });
      if (!user.foto_url) Model.setProfile({ photoUrl: dataUrl });
      View.avatar(Model.profile.photoUrl, Model.profile.username);
      View.closeCrop();
      View.toast('Foto de perfil salva.');
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
  }
};
