const MD = '/md', JK = '/jk', TR = '/tr'; // rotas do proxy local (server.js)
export const img = u => '/img?u=' + encodeURIComponent(u);

export const LANGS = [['pt-br', 'Português (Brasil)'], ['en', 'English'], ['es-la', 'Español (Latinoamérica)'], ['es', 'Español (España)'], ['fr', 'Français'], ['it', 'Italiano'], ['de', 'Deutsch'], ['ru', 'Русский'], ['id', 'Bahasa Indonesia']];
// idioma original → [código da bandeira, país, formato]
export const COUNTRY = { ja: ['jp', 'Japão', 'Mangá'], ko: ['kr', 'Coreia do Sul', 'Manhwa'], zh: ['cn', 'China', 'Manhua'], 'zh-hk': ['hk', 'Hong Kong', 'Manhua'], en: ['us', 'EUA/Reino Unido', 'Comic'] };

const USER_SCOPED_KEYS = new Set([
  'analytics', 'fav', 'progress', 'offline', 'offlineChapters',
  'searches', 'recommendation-cache-v1', 'reco-opened'
]);
const initialProfile = (() => {
  try { return JSON.parse(localStorage.getItem('profile') || '{}') || {}; } catch { return {}; }
})();
let activeUserId = initialProfile.id || '';
const storeKey = key => USER_SCOPED_KEYS.has(key)
  ? (activeUserId ? `mk:user:${activeUserId}:${key}` : `mk:guest:${key}`) : key;
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(storeKey(k))) ?? d } catch { return d } },
  set(k, v) { try { localStorage.setItem(storeKey(k), JSON.stringify(v)) } catch { } }
};
const MM = c => ({
  'pt-br': 'pt-BR', pt: 'pt-PT', 'es-la': 'es', 'es': 'es',
  zh: 'zh-CN', 'ja-ro': 'ja', ja: 'ja', ko: 'ko'
}[String(c).toLowerCase()] || c);
const last = { md: 0, jk: 0, tr: 0 }, GAP = { md: 240, jk: 420, tr: 300 };
let supabaseClient;
let progressSyncTimer;
const DEVICE_ID_KEY = 'mk:device-id';
const DOWNLOAD_DB = 'mangakindle-downloads';
let downloadDbPromise;

function deviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function downloadDb() {
  if (downloadDbPromise) return downloadDbPromise;
  downloadDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DOWNLOAD_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('downloads', { keyPath: 'key' });
      db.createObjectStore('pages', { keyPath: 'key' });
      db.createObjectStore('queue', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB indisponível.'));
  });
  return downloadDbPromise;
}

async function idbPut(storeName, value) {
  const db = await downloadDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Falha ao salvar no IndexedDB.'));
  });
}

async function idbGetAll(storeName) {
  const db = await downloadDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha ao ler o IndexedDB.'));
  });
}

async function idbDelete(storeName, key) {
  const db = await downloadDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Falha ao remover do IndexedDB.'));
  });
}

async function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  const configResponse = await fetch('/api/auth/config');
  const config = await configResponse.json().catch(() => ({}));
  if (!configResponse.ok || !config.url || !config.anonKey) {
    throw new Error('Supabase não está configurado para autenticação social.');
  }
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  supabaseClient = createClient(config.url, config.anonKey);
  return supabaseClient;
}

export const Model = {
  /* ----- estado ----- */
  cache: {},                 // mangás já carregados (id → mangá)
  tab: 'home',
  filters: null,             // listagem atual {title, extra, g2, offset, total}
  R: { m: null, chs: [], i: 0, pages: [], p: 1 }, // posição de leitura atual
  cfg: { lang: 'pt-br', ...store.get('cfg', {}) },  // idioma do catálogo
  profile: { name: '', avatar: '🦊', sysLang: 'pt-br', readMode: 'h', ...store.get('profile', {}) },
  reader: { bg: '#000000', dir: null, q: 'data', br: 100, ...store.get('settings', {}) },
  theme: store.get('theme', 'dark'),
  animations: store.get('animations', true),
  textSize: store.get('textSize', 'normal'),
  analytics: { searches: {}, genres: {}, mangas: {}, authors: {}, chapters: {}, ...store.get('analytics', {}) },
  chapterCache: new Map(),
  deviceId: deviceId(),
  recommendationCacheKey: 'recommendation-cache-v1',
  recommendationSearchesKey: 'searches',

  activateUserData(userId) {
    if (userId && userId === initialProfile.id && !localStorage.getItem('mk:legacy-owner')) {
      for (const key of USER_SCOPED_KEYS) {
        const legacy = localStorage.getItem(key);
        const scoped = localStorage.getItem(`mk:user:${userId}:${key}`);
        if (legacy !== null && scoped === null) localStorage.setItem(`mk:user:${userId}:${key}`, legacy);
      }
      localStorage.setItem('mk:legacy-owner', userId);
    }
    activeUserId = userId || '';
    this.analytics = { searches: {}, genres: {}, mangas: {}, authors: {}, chapters: {}, ...store.get('analytics', {}) };
    this.cache = {};
    this.chapterCache.clear();
    const scopedDownloads = store.get('offlineChapters', {});
    let migrated = false;
    Object.values(scopedDownloads).forEach(entry => {
      if (entry?.ownerId === activeUserId && !entry.deviceId) {
        entry.deviceId = this.deviceId;
        migrated = true;
      }
    });
    if (migrated) store.set('offlineChapters', scopedDownloads);
    this.recommendationOpened = store.get('reco-opened', false);
  },

  track(type, value, amount = 1) {
    if (!value) return;
    const bucket = this.analytics[type] || (this.analytics[type] = {});
    bucket[value] = (bucket[value] || 0) + amount;
    store.set('analytics', this.analytics);
  },
  trackManga(manga) {
    if (!manga) return;
    this.track('mangas', manga.id);
    (manga.tags || []).forEach(tag => this.track('genres', tag));
    (manga.authors || []).forEach(author => this.track('authors', author));
  },
  recommendationSearches() { return store.get(this.recommendationSearchesKey, []); },
  markRecommendationOpened() {
    this.recommendationOpened = true;
    store.set('reco-opened', true);
  },
  hasRecommendationSignals() {
    return Object.keys(this.saved()).length > 0;
  },
  trackSearch(term, items) {
    const value = String(term || '').trim();
    if (value.length < 2 || !items?.length) return;
    const searches = this.recommendationSearches();
    const normalized = value.toLocaleLowerCase();
    if (searches[0]?.termo === normalized) return;
    searches.unshift({
      termo: normalized,
      ts: Date.now(),
      topTags: [...new Set(items.flatMap(item => item.tags || []))].slice(0, 8),
      topTagIds: [...new Set(items.flatMap(item => item.tagIds || []))].slice(0, 8),
      topIds: items.slice(0, 5).map(item => item.id)
    });
    store.set(this.recommendationSearchesKey, searches.slice(0, 20));
    this.invalidateRecommendations();
  },
  invalidateRecommendations() { store.set(this.recommendationCacheKey, null); },
  clearRecommendationSearches() { store.set(this.recommendationSearchesKey, []); this.invalidateRecommendations(); },
  recommendations(items) {
    const history = this.historyAffinity();
    const seen = new Set([
      ...Object.keys(history.mangas),
      ...Object.keys(this.saved()),
      ...Object.values(this.progress()).map(entry => entry.id).filter(Boolean)
    ]);
    const score = item => {
      const genreScore = (item.tags || []).reduce((n, tag) => n + (history.genres[tag] || 0), 0);
      const authorScore = (item.authors || []).reduce((n, author) => n + (history.authors[author] || 0) * 2, 0);
      const text = [item.title, ...(item.alts || []), ...(item.tags || [])].join(' ').toLocaleLowerCase();
      const searchScore = Object.entries(history.searches).reduce((n, [term, weight]) => n + (text.includes(term) ? weight * 3 : 0), 0);
      const viewedPenalty = seen.has(item.id) ? 2 : 0;
      return genreScore + authorScore + searchScore - viewedPenalty;
    };
    const candidates = [...new Map(items.filter(Boolean).map(item => [item.id, item]).values())]
      .filter(item => !seen.has(item.id));
    const ranked = candidates.sort((a, b) => score(b) - score(a));
    return ranked.filter(item => score(item) > 0).slice(0, 12).length
      ? ranked.filter(item => score(item) > 0).slice(0, 12)
      : ranked.slice(0, 12);
  },
  async recommendationsFor(items) {
    const seeds = [
      ...Object.values(this.saved()),
      ...Object.values(this.progress()).map(entry => entry.manga)
    ].filter(Boolean);
    for (const manga of seeds.filter(manga => !manga.tagIds?.length).slice(0, 5)) {
      try {
        Object.assign(manga, await this.getManga(manga.id, true));
      } catch (error) {
        console.warn('[MangaKindle] gênero do mangá indisponível:', error.message);
      }
    }
    const tagIds = [...new Set(seeds.flatMap(manga => manga.tagIds || []))].slice(0, 3);
    let candidates = items.filter(Boolean);
    if (tagIds.length) {
      try {
        const query = tagIds.map(id => `includedTags[]=${encodeURIComponent(id)}`).join('&') +
          '&includedTagsMode=OR&order[followedCount]=desc&limit=24';
        const result = await this.list(query);
        console.log('[MangaKindle] resposta de recomendações:', { query, total: result.total, items: result.items });
        candidates = [...candidates, ...(result.items || [])];
      } catch (error) {
        console.warn('[MangaKindle] busca de recomendações falhou:', error.message);
      }
    }
    const recommendations = this.recommendations(candidates);
    console.log('[MangaKindle] recomendações mapeadas:', recommendations);
    return recommendations;
  },
  async recommendationSections(force = false) {
    const cached = store.get(this.recommendationCacheKey, null);
    if (!force && cached && Date.now() - cached.ts < 30 * 60 * 1000) return cached.sections;
    const saved = Object.values(this.saved());
    const searches = this.recommendationSearches();
    const progress = Object.values(this.progress()).map(entry => entry.manga).filter(Boolean);
    for (const manga of [...saved, ...progress].filter(item => item && !item.tagIds?.length).slice(0, 2)) {
      try { Object.assign(manga, await this.getManga(manga.id, true)); }
      catch (error) { console.warn('[MangaKindle] não foi possível carregar gêneros:', error.message); }
    }
    const excluded = new Set([...saved, ...progress].map(manga => manga.id));
    const sections = [];
    const seen = new Set(excluded);
    const addSection = (title, reason, candidates) => {
      const unique = candidates.filter(item => item?.id && !seen.has(item.id));
      const fresh = [...new Map(unique.map(item => [item.id, item])).values()].slice(0, 12);
      fresh.forEach(item => seen.add(item.id));
      if (fresh.length) sections.push({ title, reason, items: fresh });
    };
    const fetchList = async extra => {
      try { return (await this.list(extra)).items || []; }
      catch (error) { console.warn('[MangaKindle] fonte de recomendações indisponível:', error.message); return []; }
    };
    for (const manga of saved.slice(0, 2)) {
      const tags = (manga.tagIds || []).slice(0, 2);
      if (!tags.length) continue;
      const tagQuery = tags.map(id => `includedTags[]=${encodeURIComponent(id)}`).join('&');
      let candidates = await fetchList(`${tagQuery}&includedTagsMode=AND&order[followedCount]=desc&limit=12`);
      if (candidates.length < 4) candidates = [...candidates, ...await fetchList(`${tagQuery}&includedTagsMode=OR&order[followedCount]=desc&limit=12`)];
      addSection(`Porque você salvou ${manga.title}`, `Porque você salvou ${manga.title}`, candidates);
    }
    const latestSearch = searches[0];
    if (latestSearch) {
      const tags = (latestSearch.topTagIds || []).slice(0, 3);
      const candidates = tags.length
        ? await fetchList(`${tags.map(tag => `includedTags[]=${encodeURIComponent(tag)}`).join('&')}&includedTagsMode=OR&order[followedCount]=desc&limit=24`)
        : await fetchList(`title=${encodeURIComponent(latestSearch.termo)}&order[followedCount]=desc&limit=24`);
      addSection('Baseado nas suas buscas', `Parecido com sua busca por “${latestSearch.termo}”`, candidates);
    }
    const tags = [...new Set([...saved, ...progress].flatMap(manga => manga.tags || []))].slice(0, 3);
    if (tags.length) {
      const candidates = await fetchList(`title=${encodeURIComponent(tags[0])}&order[followedCount]=desc&limit=24`);
      addSection('Mais do que você gosta', `Combina com seu gosto por ${tags[0]}`, candidates);
    }
    if (!sections.length) {
      const fallback = await fetchList('order[followedCount]=desc&limit=24');
      const reason = saved[0]
        ? `Porque você salvou ${saved[0].title}`
        : 'Com base no que você já explorou';
      addSection(saved[0] ? `Porque você salvou ${saved[0].title}` : 'Sugestões para você', reason, fallback);
    }
    const result = sections;
    store.set(this.recommendationCacheKey, { ts: Date.now(), sections: result });
    return result;
  },
  historyAffinity() {
    const result = {
      searches: { ...this.analytics.searches },
      genres: { ...this.analytics.genres },
      mangas: { ...this.analytics.mangas },
      authors: { ...this.analytics.authors },
      chapters: { ...this.analytics.chapters }
    };
    const addManga = (manga, weight) => {
      if (!manga?.id) return;
      result.mangas[manga.id] = (result.mangas[manga.id] || 0) + weight;
      (manga.tags || []).forEach(tag => { result.genres[tag] = (result.genres[tag] || 0) + weight; });
      (manga.authors || []).forEach(author => { result.authors[author] = (result.authors[author] || 0) + weight; });
    };
    Object.values(this.saved()).forEach(manga => addManga(manga, 3));
    Object.values(this.progress()).forEach(entry => addManga(entry.manga, 2));
    Object.values(this.downloadedChapters()).forEach(entry => addManga(entry.manga || this.offlineManga(entry.mangaId), 2));
    return result;
  },
  hasRecommendationHistory() {
    if (this.hasRecommendationSignals()) return true;
    const history = this.historyAffinity();
    const interactions = Object.values(history.searches).reduce((n, value) => n + value, 0) +
      Object.values(history.mangas).reduce((n, value) => n + value, 0) +
      Object.values(history.chapters).reduce((n, value) => n + value, 0);
    return Object.keys(this.saved()).length > 0 || Object.keys(this.progress()).length > 0 ||
      interactions >= 1 && (Object.keys(history.genres).length > 0 ||
      Object.keys(history.authors).length > 0 || Object.keys(history.searches).length > 0);
  },

  /* ----- persistência de preferências ----- */
  setCfg(p) { Object.assign(this.cfg, p); store.set('cfg', this.cfg); },
  setProfile(p) {
    if (p.readMode && p.readMode !== this.profile.readMode) this.setReader({ dir: p.readMode });
    Object.assign(this.profile, p); store.set('profile', this.profile);
    this.activateUserData(this.profile.id || '');
  },
  async syncProfile(profile) {
    const response = await fetch('/api/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: profile.username,
        email: profile.email,
        nome: profile.name,
        foto_url: profile.photoUrl
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível sincronizar o perfil.');
    const user = result.user;
    this.setProfile({
      username: user.username,
      email: user.email,
      name: user.nome || '',
      photoUrl: user.foto_url || '',
      id: user.id
    });
    return { user, created: result.created };
  },
  async login(username) {
    const response = await fetch('/api/usuarios/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível entrar.');
    this.setProfile({
      id: result.user.id, username: result.user.username, email: result.user.email,
      name: result.user.nome || '', photoUrl: result.user.foto_url || ''
    });
    return result;
  },
  async createAccount(profile) {
    return this.syncProfile(profile);
  },
  async restoreSocialSession() {
    const supabase = await getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    this.pendingSocialProfile = null;
    if (!session?.access_token) return false;
    const response = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${session.access_token}` }
    });
    if (response.status === 404) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error('O Google não retornou um e-mail para sua conta.');
      this.pendingSocialProfile = {
        email: user.email,
        name: user.user_metadata?.full_name || user.user_metadata?.name || '',
        photoUrl: user.user_metadata?.avatar_url || ''
      };
      return false;
    }
    if (!response.ok) throw new Error('Não foi possível carregar seu perfil social.');
    const result = await response.json();
    const user = result.user;
    this.setProfile({
      id: user.id, username: user.username, email: user.email,
      name: user.nome || '', photoUrl: user.foto_url || ''
    });
    return true;
  },
  async completeSocialProfile(username) {
    const value = String(username || '').trim();
    const supabase = await getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Sua sessão do Google expirou. Entre novamente.');
    const response = await fetch('/api/auth/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ username: value })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível criar seu perfil.');
    const user = result.user;
    this.setProfile({
      id: user.id, username: user.username, email: user.email,
      name: user.nome || '', photoUrl: user.foto_url || ''
    });
    this.pendingSocialProfile = null;
    return user;
  },
  async syncDownloads() {
    const userId = this.profile.id;
    if (!userId) return;
    const response = await fetch(`/api/usuarios/${encodeURIComponent(userId)}/downloads`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível sincronizar os downloads.');

    const allLocal = store.get('offlineChapters', {});
    const indexedLocal = await idbGetAll('downloads').catch(() => []);
    indexedLocal
      .filter(item => item.userId === userId && item.deviceId === this.deviceId && item.entry)
      .forEach(item => { allLocal[item.entry.chapterId] = item.entry; });
    store.set('offlineChapters', allLocal);
    const local = Object.values(allLocal).filter(entry =>
      entry?.ownerId === userId && entry.deviceId === this.deviceId)
      .reduce((items, entry) => { items[entry.chapterId] = entry; return items; }, {});
    const merged = {};
    for (const remote of [...new Map((result.downloads || [])
      .filter(entry => entry?.chapter_id)
      .map(entry => [entry.chapter_id, entry])).values()]) {
      const current = local[remote.chapter_id];
      const localAvailable = Boolean(current?.localAvailable && current.deviceId === this.deviceId);
      merged[remote.chapter_id] = localAvailable ? {
        ...current,
        syncError: '',
        updatedAt: new Date(remote.atualizado_em).getTime() || current.updatedAt || Date.now()
      } : {
        mangaId: remote.manga_id,
        manga: remote.manga || current?.manga || null,
        chapterId: remote.chapter_id,
        num: remote.numero || current?.num || '',
        title: remote.titulo || current?.title || '',
        language: remote.idioma || current?.language || this.cfg.lang,
        source: remote.origem || current?.source || 'MangaDex',
        pages: current?.pages || [],
        folder: current?.folder || '',
        downloaded: false,
        localAvailable: false,
        deviceId: remote.device_id || '',
        ownerId: userId,
        updatedAt: new Date(remote.atualizado_em).getTime() || Date.now()
      };
    }
    Object.values(local).forEach(entry => { merged[entry.chapterId] = entry; });
    store.set('offlineChapters', merged);

    const localToUpload = Object.values(local).filter(entry => entry?.localAvailable);
    for (const entry of localToUpload) await this.queueDownloadSync(entry);
    await this.processDownloadQueue();
    return merged;
  },
  async queueDownloadSync(entry) {
    if (!this.profile.id || !entry?.chapterId) return;
    await idbPut('queue', {
      key: `${this.profile.id}:${this.deviceId}:${entry.chapterId}`,
      userId: this.profile.id,
      deviceId: this.deviceId,
      entry
    });
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready.catch(() => null);
      await registration?.sync?.register('mangakindle-downloads').catch(() => undefined);
    }
    this.processDownloadQueue().catch(error => console.warn('[MangaKindle] fila de downloads:', error.message));
  },
  async processDownloadQueue() {
    if (!this.profile.id || !navigator.onLine) return;
    const queued = await idbGetAll('queue');
    for (const item of queued.filter(item => item.userId === this.profile.id && item.deviceId === this.deviceId)) {
      try {
        const synced = await this.saveDownloadRecord(item.entry);
        if (!synced) continue;
        await idbDelete('queue', item.key);
        const saved = store.get('offlineChapters', {});
        if (saved[item.entry.chapterId]) {
          saved[item.entry.chapterId].syncError = '';
          store.set('offlineChapters', saved);
        }
      } catch (error) {
        const saved = store.get('offlineChapters', {});
        if (saved[item.entry.chapterId]) {
          saved[item.entry.chapterId].syncError = error.message || 'Não foi possível sincronizar o download.';
          store.set('offlineChapters', saved);
        }
      }
    }
  },
  async saveDownloadRecord(entry) {
    if (!this.profile.id || entry.ownerId !== this.profile.id || entry.deviceId !== this.deviceId) return false;
    const response = await fetch(`/api/usuarios/${encodeURIComponent(this.profile.id)}/downloads`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chapterId: entry.chapterId,
        mangaId: entry.mangaId,
        manga: entry.manga,
        num: entry.num,
        title: entry.title,
        language: entry.language,
        source: entry.source,
        deviceId: entry.deviceId || this.deviceId
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível salvar o download na nuvem.');
    return true;
  },
  async startSocial(provider) {
    try {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: window.location.origin
        }
      });
      if (error) throw error;
      return data;
    } catch (error) {
      throw new Error(error.message || 'Não foi possível iniciar o login social.');
    }
  },
  async logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    this.profile = { name: '', avatar: '🦊', sysLang: 'pt-br', readMode: 'h' };
    store.set('profile', this.profile);
    this.activateUserData('');
  },
  async updateProfile(profile) {
    const response = await fetch(`/api/usuarios/${encodeURIComponent(profile.username)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: profile.email, nome: profile.name, foto_url: profile.photoUrl })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível atualizar o perfil.');
    this.setProfile({
      email: result.user.email,
      name: result.user.nome || '',
      photoUrl: result.user.foto_url || '',
      id: result.user.id
    });
    return result.user;
  },
  setReader(p) { Object.assign(this.reader, p); store.set('settings', this.reader); },
  setTheme(t) { this.theme = t; store.set('theme', t); },
  setAnimations(enabled) { this.animations = enabled; store.set('animations', enabled); },
  setTextSize(size) { this.textSize = size; store.set('textSize', size); },

  /* ----- salvos (leitura futura) ----- */
  saved: () => store.get('fav', {}),
  isSaved(id) { return !!this.saved()[id]; },
  toggleSaved(id) {
    const s = this.saved(), m = this.cache[id]; if (!m) return false;
    if (s[id]) delete s[id];
    else {
      s[id] = m;
      this.trackManga(m);
    }
    store.set('fav', s);
    this.invalidateRecommendations();
    return !!s[id];
  },
  async syncSaved() {
    if (!this.profile.id) return;
    const local = this.saved();
    const response = await fetch(`/api/usuarios/${encodeURIComponent(this.profile.id)}/salvos`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível sincronizar os mangás salvos.');
    const remote = result.saved || [];
    const remoteIds = new Set(remote.filter(entry => entry.manga_id).map(entry => String(entry.manga_id)));
    for (const id of Object.keys(local)) {
      if (!remoteIds.has(String(id))) delete local[id];
    }
    for (const entry of remote) {
      if (entry.manga_id && entry.manga) local[entry.manga_id] = entry.manga;
    }
    store.set('fav', local);
    for (const manga of Object.values(local)) {
      await this.saveSavedRecord(manga);
    }
    return local;
  },
  async saveSavedRecord(manga) {
    if (!this.profile.id || !manga?.id) return;
    const response = await fetch(`/api/usuarios/${encodeURIComponent(this.profile.id)}/salvos`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mangaId: manga.id, manga })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível salvar o mangá na nuvem.');
  },
  async removeSavedRecord(id) {
    if (!this.profile.id) return;
    const response = await fetch(`/api/usuarios/${encodeURIComponent(this.profile.id)}/salvos/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw new Error('Não foi possível remover o mangá salvo na nuvem.');
  },
  clearSaved() { store.set('fav', {}); this.invalidateRecommendations(); },
  async cacheManga(m) {
    const saved = store.get('offline', {});
    saved[m.id] = m;
    store.set('offline', saved);
    await this.chapters(m).catch(() => undefined);
    if ('caches' in window) {
      const cache = await caches.open('mangakindle-offline-v2');
      await Promise.all([m.cover, m.coverBig].filter(Boolean).map(url => cache.add(url).catch(() => undefined)));
    }
  },
  downloadedChapters() {
    const all = store.get('offlineChapters', {});
    if (!this.profile.id) return {};
    return Object.values(all)
      .filter(entry => entry?.ownerId === this.profile.id && entry.chapterId)
      .reduce((chapters, entry) => {
        const current = chapters[entry.chapterId];
        if (!current || (entry.localAvailable && !current.localAvailable) ||
          Number(entry.updatedAt || 0) > Number(current.updatedAt || 0)) chapters[entry.chapterId] = entry;
        return chapters;
      }, {});
  },
  offlineManga(id) { return store.get('offline', {})[id] || null; },
  isChapterDownloaded(id) { return !!this.downloadedChapters()[id]?.localAvailable; },
  async hasLocalChapter(entry) {
    if (!entry?.pages?.length) return false;
    const blobs = await idbGetAll('pages').catch(() => []);
    const stored = new Set(blobs
      .filter(page => page.userId === this.profile.id && page.deviceId === this.deviceId && page.chapterId === entry.chapterId && page.blob?.size)
      .map(page => page.index));
    if (stored.size === entry.pages.length) return true;
    if (!('caches' in window)) return false;
    const cache = await caches.open('mangakindle-offline-v2');
    const available = await Promise.all(entry.pages.map(page => cache.match(page)));
    return available.every(Boolean);
  },
  async refreshDownloadIntegrity() {
    const saved = this.downloadedChapters();
    const all = store.get('offlineChapters', {});
    await Promise.all(Object.values(saved).map(async entry => {
      entry.localAvailable = await this.hasLocalChapter(entry);
      entry.downloaded = entry.localAvailable;
    }));
    store.set('offlineChapters', { ...all, ...saved });
    return saved;
  },
  async removeChapterDownload(id) {
    const saved = store.get('offlineChapters', {}), entry = this.downloadedChapters()[id];
    if (!entry) return;
    if (entry.folder) {
      const response = await fetch(`/downloads/${encodeURIComponent(entry.folder)}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) throw new Error('Falha ao remover arquivo');
    }
    if ('caches' in window) {
      const cache = await caches.open('mangakindle-offline-v2');
      await Promise.all((entry.pages || []).map(page => cache.delete(page)));
    }
    delete saved[id];
    store.set('offlineChapters', saved);
    await idbDelete('downloads', `${this.profile.id}:${this.deviceId}:${id}`).catch(() => undefined);
    await idbDelete('queue', `${this.profile.id}:${this.deviceId}:${id}`).catch(() => undefined);
    const pages = await idbGetAll('pages').catch(() => []);
    await Promise.all(pages
      .filter(page => page.userId === this.profile.id && page.deviceId === this.deviceId && page.chapterId === id)
      .map(page => idbDelete('pages', page.key)));
    if (this.profile.id) {
      const response = await fetch(`/api/usuarios/${encodeURIComponent(this.profile.id)}/downloads/${encodeURIComponent(id)}?deviceId=${encodeURIComponent(this.deviceId)}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) throw new Error('Falha ao remover registro na nuvem');
    }
  },
  async downloadChapter(m, ch, onProgress = () => {}) {
    if (!('caches' in window)) throw new Error('Armazenamento offline indisponível');
    if (ch.source && ch.source !== 'MangaDex') throw new Error('Capítulo secundário não possui páginas compatíveis');
    const pages = await this.pages(ch.id, 'data');
    const cache = await caches.open('mangakindle-offline-v2');
    const saved = store.get('offlineChapters', {});
    const entry = {
      ownerId: this.profile.id, deviceId: this.deviceId, mangaId: m.id, manga: m, chapterId: ch.id, num: ch.num, title: ch.title || '',
      language: ch.language || this.cfg.lang, source: ch.source || 'MangaDex',
      pages, folder: '', downloaded: false, updatedAt: Date.now()
    };
    saved[ch.id] = entry;
    store.set('offlineChapters', saved);
    const offlineManga = store.get('offline', {});
    offlineManga[m.id] = m;
    store.set('offline', offlineManga);
    let completed = 0;
    const worker = async () => {
      while (completed < pages.length) {
        const index = completed++;
        const response = await fetch(pages[index]);
        if (!response.ok) throw new Error(`Página ${index + 1} indisponível`);
        const blob = await response.clone().blob();
        await Promise.all([
          cache.put(pages[index], new Response(blob, { headers: { 'Content-Type': response.headers.get('Content-Type') || 'image/jpeg' } })),
          idbPut('pages', { key: `${this.profile.id}:${this.deviceId}:${ch.id}:${index}`, userId: this.profile.id, deviceId: this.deviceId, chapterId: ch.id, index, blob })
        ]);
        onProgress(completed, pages.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, pages.length) }, worker));
    entry.downloaded = true;
    entry.localAvailable = true;
    entry.updatedAt = Date.now();
    store.set('offlineChapters', saved);
    await idbPut('downloads', { key: `${this.profile.id}:${this.deviceId}:${ch.id}`, userId: this.profile.id, deviceId: this.deviceId, entry });
    await this.queueDownloadSync(entry);
    store.set('offlineChapters', saved);
    return entry;
  },

  /* ----- progresso de leitura ----- */
  progress: () => store.get('progress', {}),
  progressOf(id) { return this.progress()[id] || null; },
  saveProgress() {
    const { m, chs, i, p, pages } = this.R; if (!m || !chs[i]) return;
    if (p >= pages.length && !this.analytics.chapters[chs[i].id]) this.track('chapters', chs[i].id);
    const all = this.progress();
    const entry = all[m.id] = { id: m.id, manga: m, chId: chs[i].id, chNum: chs[i].num, page: p, total: pages.length, ts: Date.now() };
    store.set('progress', all);
    this.invalidateRecommendations();
    clearTimeout(progressSyncTimer);
    progressSyncTimer = setTimeout(() => this.saveProgressRecord(entry)
      .catch(error => console.warn('[MangaKindle] progresso não sincronizado:', error.message)), 300);
  },
  async syncProgress() {
    if (!this.profile.id) return;
    const local = this.progress();
    const response = await fetch(`/api/usuarios/${encodeURIComponent(this.profile.id)}/progresso`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível sincronizar o progresso.');
    for (const record of result.progress || []) {
      const remote = record.progresso;
      if (remote?.id && (!local[remote.id] || Number(remote.ts) > Number(local[remote.id].ts))) local[remote.id] = remote;
    }
    for (const manga of Object.values(local).map(entry => entry.manga).filter(manga => manga && !manga.tagIds?.length).slice(0, 5)) {
      try {
        Object.assign(manga, await this.getManga(manga.id, true));
      } catch (error) {
        console.warn('[MangaKindle] metadados do progresso indisponíveis:', error.message);
      }
    }
    store.set('progress', local);
    for (const entry of Object.values(local)) await this.saveProgressRecord(entry);
    return local;
  },
  async saveProgressRecord(entry) {
    if (!this.profile.id || !entry?.id) return;
    const response = await fetch(`/api/usuarios/${encodeURIComponent(this.profile.id)}/progresso`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mangaId: entry.id, progress: entry })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível salvar o progresso na nuvem.');
  },
  clearProgress() { store.set('progress', {}); this.invalidateRecommendations(); },

  /* ----- rede (fila para respeitar os limites das APIs) ----- */
  async api(url, tries = 2) {
    const k = url.startsWith(JK) ? 'jk' : url.startsWith(TR) ? 'tr' : 'md';
    for (let i = 0; i <= tries; i++) {
      const w = Math.max(0, last[k] + GAP[k] - Date.now()); last[k] = Date.now() + w;
      await new Promise(r => setTimeout(r, w));
      try {
        const r = await fetch(url);
        if (r.status === 429) { await new Promise(r => setTimeout(r, 1500 * (i + 1))); continue; }
        if (!r.ok) throw new Error(r.status);
        return await r.json();
      } catch (e) { if (i === tries) throw e; }
    }
    throw new Error('Falha de rede');
  },

  /* ----- catálogo ----- */
  pick(o) {
    if (!o) return '';
    const target = this.profile.sysLang.toLowerCase();
    const key = Object.keys(o).find(k => k.toLowerCase() === target) ||
      Object.keys(o).find(k => k.toLowerCase().split('-')[0] === target.split('-')[0]);
    return o[key] || o.en || o['ja-ro'] || Object.values(o)[0] || '';
  },
  // filtra pelo idioma do catálogo: só mangás com capítulos traduzidos nele
  base() { return `includes[]=cover_art&includes[]=author&includes[]=artist&contentRating[]=safe&contentRating[]=suggestive&availableTranslatedLanguage[]=${this.cfg.lang}&hasAvailableChapters=true`; },
  norm(m) {
    const a = m.attributes, rel = t => m.relationships.filter(r => r.type === t);
    const f = rel('cover_art')[0]?.attributes?.fileName, u = s => f ? img(`https://uploads.mangadex.org/covers/${m.id}/${f}${s}`) : '';
    const d = a.description || {}, sys = this.profile.sysLang.toLowerCase();
    const dl = Object.keys(d).find(k => k.toLowerCase() === sys) ||
      Object.keys(d).find(k => k.toLowerCase().split('-')[0] === sys.split('-')[0]) ||
      (d.en ? 'en' : Object.keys(d)[0] || '');
    return {
      id: m.id, title: this.pick(a.title), alts: (a.altTitles || []).map(o => this.pick(o)).filter(Boolean),
      desc: d[dl] || '', descLang: dl, year: a.year, lang: a.originalLanguage, status: a.status,
      tags: (a.tags || []).map(t => t.attributes.name.en),
      tagIds: (a.tags || []).map(t => t.id).filter(Boolean), links: a.links || {},
      authors: [...new Set(rel('author').map(r => r.attributes?.name).filter(Boolean))],
      artists: [...new Set(rel('artist').map(r => r.attributes?.name).filter(Boolean))],
      cover: u('.256.jpg'), coverBig: u('.512.jpg'), rating: null
    };
  },
  async list(extra) {
    const d = await this.api(`${MD}/manga?${this.base()}&${extra}`);
    const items = d.data.map(x => this.norm(x));
    if (items.length) {
      try {
        const s = await this.api(`${MD}/statistics/manga?${items.map(i => 'manga[]=' + i.id).join('&')}`);
        items.forEach(i => i.rating = s.statistics[i.id]?.rating?.average ?? null);
      } catch { }
    }
    items.forEach(i => this.cache[i.id] = i);
    return { items, total: d.total };
  },
  async getManga(id, refresh = false) { // usado pelos links compartilhados (?manga=ID)
    if (this.cache[id] && !refresh) return this.cache[id];
    let m;
    try {
      const d = await this.api(`${MD}/manga/${id}?includes[]=cover_art&includes[]=author&includes[]=artist`);
      m = this.norm(d.data);
    } catch (e) {
      m = store.get('offline', {})[id];
      if (!m) throw e;
    }
    if (!m) throw new Error('Mangá não encontrado');
    try { m.rating = (await this.api(`${MD}/statistics/manga/${id}`)).statistics[id]?.rating?.average ?? null; } catch { }
    return this.cache[id] = m;
  },
  async search(query, offset = 0) {
    const exact = await this.list(`title=${encodeURIComponent(query)}&order[relevance]=desc&limit=24&offset=${offset}`);
    if (exact.items.length || offset > 0) return exact;

    const terms = [...new Set(query.split(/\s+/).map(t => t.trim()).filter(t => t.length >= 3))];
    const found = new Map();
    for (const term of terms) {
      const result = await this.list(`title=${encodeURIComponent(term)}&order[relevance]=desc&limit=24`);
      result.items.forEach(item => found.set(item.id, item));
    }
    const q = query.toLocaleLowerCase();
    const items = [...found.values()].sort((a, b) => {
      const score = item => {
        const title = [item.title, ...item.alts].join(' ').toLocaleLowerCase();
        return (title === q ? 100 : 0) + (title.includes(q) ? 30 : 0) +
          terms.reduce((n, term) => n + (title.includes(term.toLocaleLowerCase()) ? 5 : 0), 0);
      };
      return score(b) - score(a);
    });
    return { items: items.slice(offset, offset + 24), total: items.length };
  },
  async tags() {
    if (!this._tags) this._tags = (await this.api(`${MD}/manga/tag`)).data.map(t => ({ id: t.id, n: t.attributes.name.en, g: t.attributes.group }));
    return this._tags;
  },

  /* ----- capítulos e páginas ----- */
  async chapters(m) {
    const cacheKey = `${m.id}:${this.cfg.lang}`;
    const cached = this.chapterCache.get(cacheKey);
    if (cached) return cached;
    try {
      const response = await fetch(`/chapters?mangaId=${encodeURIComponent(m.id)}&title=${encodeURIComponent(m.title)}&language=${encodeURIComponent(this.cfg.lang)}`);
      if (!response.ok) throw new Error(`Falha ao carregar capítulos (${response.status})`);
      const data = await response.json();
      const chapters = (data.chapters || []).map(c => ({
        id: c.id, num: c.number, title: c.title, language: c.language, source: c.source
      })).sort((a, b) => {
        const an = Number.parseFloat(a.num), bn = Number.parseFloat(b.num);
        return (Number.isFinite(an) ? an : Number.MAX_SAFE_INTEGER) - (Number.isFinite(bn) ? bn : Number.MAX_SAFE_INTEGER);
      });
      this.chapterCache.set(cacheKey, chapters);
      return chapters;
    } catch (error) {
      const offline = Object.values(this.downloadedChapters())
        .filter(c => c.mangaId === m.id && c.downloaded)
        .map(c => ({ id: c.chapterId, num: c.num, title: c.title || '', language: c.language || this.cfg.lang, source: c.source || 'MangaDex' }));
      if (offline.length) {
        offline.sort((a, b) => Number.parseFloat(a.num) - Number.parseFloat(b.num));
        this.chapterCache.set(cacheKey, offline);
        return offline;
      }
      throw error;
    }
  },
  async pages(chId, quality = this.reader.q) {
    const offline = this.downloadedChapters()[chId];
    if (offline?.localAvailable) return offline.pages;
    const d = await this.api(`${MD}/at-home/server/${chId}`), c = d.chapter, q = quality;
    return (q === 'data' ? c.data : c.dataSaver).map(f => img(`${d.baseUrl}/${q}/${c.hash}/${f}`));
  },

  /* ----- metadados extras (Jikan) ----- */
  async extra(m) {
    let mal = m.links.mal;
    if (!mal) mal = (await this.api(`${JK}/manga?q=${encodeURIComponent(m.title)}&limit=1`, 1)).data[0]?.mal_id;
    if (!mal) return null;
    const { data } = await this.api(`${JK}/manga/${mal}/full`, 1);
    return { mag: data.serializations?.map(s => s.name).join(', '), year: data.published?.prop?.from?.year, score: data.score };
  },

  /* ----- tradução da sinopse (MyMemory) para o idioma do sistema ----- */
  needsTranslation(m) {
    const lang = value => String(value || '').toLowerCase().split('-')[0];
    return !!m.desc && !!m.descLang && lang(m.descLang) !== lang(this.profile.sysLang);
  },
  async translate(m) {
    const to = this.profile.sysLang, key = `${m.id}:${m.descLang}>${to}`, c = store.get('trcache', {});
    if (c[key]) return c[key];
    const text = m.desc.replace(/\s+/g, ' ').slice(0, 1800), parts = [];
    let buf = '';
    (text.match(/[^.!?。]+[.!?。]*\s*/g) || [text]).forEach(s => { if ((buf + s).length > 450) { parts.push(buf); buf = s; } else buf += s; });
    if (buf) parts.push(buf);
    const out = [];
    for (const p of parts) {
      const d = await this.api(`${TR}?q=${encodeURIComponent(p)}&langpair=${MM(m.descLang)}|${MM(to)}`, 1);
      const t = d.responseData?.translatedText;
      if (d.responseStatus != 200 || !t || /MYMEMORY WARNING/i.test(t)) throw new Error('tradução indisponível');
      out.push(t);
    }
    const res = out.join(' ');
    const keys = Object.keys(c); if (keys.length > 60) delete c[keys[0]];
    c[key] = res; store.set('trcache', c);
    return res;
  }
};
Model.activateUserData(Model.profile.id || '');
Model.reader.dir ??= Model.profile.readMode;
window.addEventListener('online', () => Model.processDownloadQueue().catch(error =>
  console.warn('[MangaKindle] fila de downloads:', error.message)));
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'sync-downloads') Model.processDownloadQueue().catch(error =>
      console.warn('[MangaKindle] fila de downloads:', error.message));
  });
}
