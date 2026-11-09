const MD = '/md', JK = '/jk', TR = '/tr'; // rotas do proxy local (server.js)
const OFFLINE_CACHE = 'mangakindle-offline-v2';
const RECO_CACHE = 'recommendation-cache-v1';
const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.0/+esm';
const MANGA_ID = /^[\w-]{8,64}$/;

export const img = url => '/img?u=' + encodeURIComponent(url);

export const LANGS = [['pt-br', 'Português (Brasil)'], ['en', 'English'], ['es-la', 'Español (Latinoamérica)'], ['es', 'Español (España)'], ['fr', 'Français'], ['it', 'Italiano'], ['de', 'Deutsch'], ['ru', 'Русский'], ['id', 'Bahasa Indonesia']];
// idioma original -> [país, formato]
export const COUNTRY = { ja: ['Japão', 'Mangá'], ko: ['Coreia do Sul', 'Manhwa'], zh: ['China', 'Manhua'], 'zh-hk': ['Hong Kong', 'Manhua'], en: ['EUA/Reino Unido', 'Comic'] };

/* ---------- armazenamento local, isolado por usuário ---------- */

const USER_SCOPED_KEYS = new Set(['fav', 'progress', 'offline', 'offlineChapters', 'searches', RECO_CACHE, 'reco-opened']);
const readStorage = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const initialProfile = readStorage('profile', {}) || {};
let activeUserId = initialProfile.id || '';
const storeKey = key => USER_SCOPED_KEYS.has(key) ? `mk:${activeUserId ? `user:${activeUserId}` : 'guest'}:${key}` : key;
const store = {
  get: (key, fallback) => readStorage(storeKey(key), fallback),
  set(key, value) {
    try { localStorage.setItem(storeKey(key), JSON.stringify(value)); } catch (error) { console.warn('[MangaKindle] armazenamento local indisponível:', error.message); }
  }
};

const warn = (label, error) => console.warn(`[MangaKindle] ${label}:`, error?.message ?? error);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/* ---------- requisições ao servidor local ---------- */

// Rotas de conta e de assinatura exigem a sessão emitida pelo servidor no login.
const needsSession = url => /^\/api\/(usuarios\/[^/]+|premium)/.test(url) && !url.startsWith('/api/usuarios/login');
const sessionToken = () => (readStorage('profile', {}) || {}).sessionToken || '';

export async function request(url, { method = 'GET', body, token, fallback = 'Não foi possível concluir a operação.' } = {}) {
  const bearer = token ?? (needsSession(url) ? sessionToken() : '');
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { ...(body && { 'Content-Type': 'application/json' }), ...(bearer && { Authorization: `Bearer ${bearer}` }) },
      body: body && JSON.stringify(body)
    });
  } catch { throw new Error('Sem conexão com o servidor.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Sessão vencida ou inválida: o Controller encerra a conta local e pede um novo login.
    if (response.status === 401 && data.code === 'session_required' && bearer && token === undefined) window.dispatchEvent(new CustomEvent('mk:session-expired'));
    throw Object.assign(new Error(data.error || fallback), { status: response.status, code: data.code });
  }
  return data;
}
const ignoreMissing = error => { if (error.status !== 404) throw error; };
const userUrl = (id, ...rest) => `/api/usuarios/${[id, ...rest].filter(Boolean).map(encodeURIComponent).join('/')}`;

/* ---------- IndexedDB (páginas baixadas e fila de sincronização) ---------- */

const DEVICE_ID_KEY = 'mk:device-id';
const DOWNLOAD_DB = 'mangakindle-downloads';
let downloadDbPromise, supabaseClient, progressSyncTimer;

function deviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function downloadDb() {
  downloadDbPromise ??= new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB indisponível.'));
    const open = indexedDB.open(DOWNLOAD_DB, 1);
    open.onupgradeneeded = () => ['downloads', 'pages', 'queue'].forEach(name => open.result.createObjectStore(name, { keyPath: 'key' }));
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error || new Error('IndexedDB indisponível.'));
  }).catch(error => { downloadDbPromise = null; throw error; });
  return downloadDbPromise;
}

const idb = (name, mode, run) => downloadDb().then(db => new Promise((resolve, reject) => {
  const tx = db.transaction(name, mode);
  const request = run(tx.objectStore(name));
  tx.oncomplete = () => resolve(request?.result);
  tx.onerror = tx.onabort = () => reject(tx.error || new Error('Falha ao acessar o armazenamento offline.'));
}));
const idbPut = (name, value) => idb(name, 'readwrite', object => object.put(value));
const idbGetAll = name => idb(name, 'readonly', object => object.getAll());
const idbDelete = (name, key) => idb(name, 'readwrite', object => object.delete(key));

async function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  const config = await request('/api/auth/config', { fallback: 'Supabase não está configurado para autenticação social.' });
  if (!config.url || !config.anonKey) throw new Error('Supabase não está configurado para autenticação social.');
  const { createClient } = await import(SUPABASE_ESM);
  return supabaseClient = createClient(config.url, config.anonKey);
}

// Mapeia códigos de idioma do MangaDex para os aceitos pelo MyMemory
const MYMEMORY_LANG = { 'pt-br': 'pt-BR', pt: 'pt-PT', 'es-la': 'es', es: 'es', zh: 'zh-CN', 'ja-ro': 'ja', ja: 'ja', ko: 'ko' };
const toMyMemory = code => MYMEMORY_LANG[String(code).toLowerCase()] || code;

// Limite de cadência por API externa
const last = { md: 0, jk: 0, tr: 0 }, GAP = { md: 150, jk: 420, tr: 300 };

// Memória das respostas das APIs: evita repetir consultas e compartilha pedidos idênticos em andamento.
const API_TTL = 5 * 60 * 1000, API_MEMO_MAX = 300;
const apiMemo = new Map(), apiPending = new Map();

const tagQuery = (ids, mode = 'OR', limit = 24) =>
  `${ids.map(id => `includedTags[]=${encodeURIComponent(id)}`).join('&')}&includedTagsMode=${mode}&order[followedCount]=desc&limit=${limit}`;

export const Model = {
  /* ----- estado ----- */
  cache: {},                 // mangás já carregados (id -> mangá)
  tab: 'home',
  filters: null,             // listagem atual {title, extra, g2, search, offset}
  current: null,
  pendingSocialProfile: null,
  recommendationOpened: false,
  R: { m: null, chs: [], i: 0, pages: [], p: 1 }, // posição de leitura atual
  cfg: { lang: 'pt-br', ...store.get('cfg', {}) },
  profile: { name: '', sysLang: 'pt-br', readMode: 'h', ...store.get('profile', {}) },
  reader: { bg: '#000000', dir: null, q: 'data', br: 100, layout: 'single', progress: true, ...store.get('settings', {}) },
  theme: store.get('theme', 'purple-night'),
  animations: store.get('animations', true),
  textSize: store.get('textSize', 'normal'),
  chapterCache: new Map(),
  deviceId: deviceId(),

  // Troca o usuário ativo; dados antigos sem dono são migrados uma única vez para o primeiro usuário.
  activateUserData(userId) {
    if (userId && userId === initialProfile.id && !localStorage.getItem('mk:legacy-owner')) {
      for (const key of USER_SCOPED_KEYS) {
        const legacy = localStorage.getItem(key), scopedKey = `mk:user:${userId}:${key}`;
        if (legacy !== null && localStorage.getItem(scopedKey) === null) localStorage.setItem(scopedKey, legacy);
      }
      localStorage.setItem('mk:legacy-owner', userId);
    }
    activeUserId = userId || '';
    this.cache = {};
    this.chapterCache.clear();
    const downloads = store.get('offlineChapters', {});
    let migrated = false;
    for (const entry of Object.values(downloads)) {
      if (entry?.ownerId === activeUserId && !entry.deviceId) { entry.deviceId = this.deviceId; migrated = true; }
    }
    if (migrated) store.set('offlineChapters', downloads);
    this.recommendationOpened = store.get('reco-opened', false);
  },

  /* ----- recomendações baseadas no uso ----- */
  recommendationSearches: () => store.get('searches', []),
  markRecommendationOpened() {
    this.recommendationOpened = true;
    store.set('reco-opened', true);
  },
  hasRecommendationSignals() { return Object.keys(this.saved()).length > 0; },
  trackSearch(term, items) {
    const value = String(term || '').trim().toLocaleLowerCase();
    if (value.length < 2 || !items?.length) return;
    const searches = this.recommendationSearches();
    if (searches[0]?.termo === value) return;
    searches.unshift({
      termo: value,
      ts: Date.now(),
      topTags: [...new Set(items.flatMap(item => item.tags || []))].slice(0, 8),
      topTagIds: [...new Set(items.flatMap(item => item.tagIds || []))].slice(0, 8),
      topIds: items.slice(0, 5).map(item => item.id)
    });
    store.set('searches', searches.slice(0, 20));
    this.invalidateRecommendations();
  },
  invalidateRecommendations() { store.set(RECO_CACHE, null); },
  async hydrateTags(mangas, limit) {
    for (const manga of mangas.filter(item => item && !item.tagIds?.length).slice(0, limit)) {
      try { Object.assign(manga, await this.getManga(manga.id, true)); } catch (error) { warn('gêneros indisponíveis', error); }
    }
  },
  async recommendationSections(force = false) {
    const cached = store.get(RECO_CACHE, null);
    if (!force && cached && Date.now() - cached.ts < 30 * 60 * 1000) return cached.sections;
    const saved = Object.values(this.saved());
    const progress = Object.values(this.progress()).map(entry => entry.manga).filter(Boolean);
    const [latestSearch] = this.recommendationSearches();
    await this.hydrateTags([...saved, ...progress], 2);

    const seen = new Set([...saved, ...progress].map(manga => manga.id)), sections = [];
    const addSection = (title, reason, candidates) => {
      const fresh = [...new Map(candidates.filter(item => item?.id && !seen.has(item.id)).map(item => [item.id, item])).values()].slice(0, 12);
      fresh.forEach(item => seen.add(item.id));
      if (fresh.length) sections.push({ title, reason, items: fresh });
    };
    const fetchList = async extra => {
      try { return (await this.list(extra)).items || []; } catch (error) { warn('fonte de recomendações indisponível', error); return []; }
    };

    for (const manga of saved.slice(0, 2)) {
      const tags = (manga.tagIds || []).slice(0, 2);
      if (!tags.length) continue;
      let candidates = await fetchList(tagQuery(tags, 'AND', 12));
      if (candidates.length < 4) candidates = [...candidates, ...await fetchList(tagQuery(tags, 'OR', 12))];
      const title = `Porque você salvou ${manga.title}`;
      addSection(title, title, candidates);
    }
    if (latestSearch) {
      const tags = (latestSearch.topTagIds || []).slice(0, 3);
      const query = tags.length ? tagQuery(tags) : `title=${encodeURIComponent(latestSearch.termo)}&order[followedCount]=desc&limit=24`;
      addSection('Baseado nas suas buscas', `Parecido com sua busca por “${latestSearch.termo}”`, await fetchList(query));
    }
    const favoriteTag = [...saved, ...progress].flatMap(manga => manga.tags || [])[0];
    if (favoriteTag) {
      addSection('Mais do que você gosta', `Combina com seu gosto por ${favoriteTag}`,
        await fetchList(`title=${encodeURIComponent(favoriteTag)}&order[followedCount]=desc&limit=24`));
    }
    if (!sections.length) {
      const title = saved[0] ? `Porque você salvou ${saved[0].title}` : 'Sugestões para você';
      addSection(title, saved[0] ? title : 'Com base no que você já explorou', await fetchList('order[followedCount]=desc&limit=24'));
    }
    store.set(RECO_CACHE, { ts: Date.now(), sections });
    return sections;
  },

  /* ----- preferências e perfil ----- */
  setCfg(p) { Object.assign(this.cfg, p); store.set('cfg', this.cfg); },
  setProfile(p) {
    if (p.readMode && p.readMode !== this.profile.readMode) this.setReader({ dir: p.readMode });
    Object.assign(this.profile, p);
    store.set('profile', this.profile);
    this.activateUserData(this.profile.id || '');
  },
  // Atualiza o perfil sem invalidar caches de mangás e capítulos.
  patchProfile(p) {
    Object.assign(this.profile, p);
    store.set('profile', this.profile);
  },
  applyUser(user, token) {
    this.setProfile({
      id: user.id, username: user.username, email: user.email, name: user.username || user.nome || '', photoUrl: user.foto_url || '',
      role: user.role || 'free', subscriptionStatus: user.subscription_status || 'inactive',
      subscriptionExpiresAt: user.subscription_expires_at || null, renews: Boolean(user.renews),
      ...(token && { sessionToken: token })
    });
    return user;
  },
  async syncProfile(profile) {
    const result = await request('/api/usuarios', {
      method: 'POST', fallback: 'Não foi possível sincronizar o perfil.',
      body: { username: profile.username, email: profile.email, password: profile.password, foto_url: profile.photoUrl }
    });
    return { user: this.applyUser(result.user, result.token), created: result.created };
  },
  async login(email, password) {
    await this.signOutSocial();
    const result = await request('/api/usuarios/login', { method: 'POST', body: { email, password }, fallback: 'Não foi possível entrar.' });
    this.applyUser(result.user, result.token);
    return result;
  },
  async createAccount(profile) {
    await this.signOutSocial();
    return this.syncProfile(profile);
  },
  async signOutSocial() {
    try { await (await getSupabaseClient()).auth.signOut(); } catch { /* conta local funciona sem login social configurado */ }
  },
  async restoreSocialSession() {
    const supabase = await getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    this.pendingSocialProfile = null;
    if (!session?.access_token) return false;
    try {
      const me = await request('/api/auth/me', { token: session.access_token });
      this.applyUser(me.user, me.token);
      return true;
    } catch (error) {
      if (error.status !== 404) throw new Error('Não foi possível carregar seu perfil social.');
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) throw new Error('O Google não retornou um e-mail para sua conta.');
    this.pendingSocialProfile = {
      email: user.email,
      name: user.user_metadata?.full_name || user.user_metadata?.name || '',
      photoUrl: user.user_metadata?.avatar_url || ''
    };
    return false;
  },
  async completeSocialProfile(username) {
    const { data: { session } } = await (await getSupabaseClient()).auth.getSession();
    if (!session?.access_token) throw new Error('Sua sessão do Google expirou. Entre novamente.');
    const result = await request('/api/auth/profile', {
      method: 'POST', token: session.access_token, body: { username: String(username || '').trim() }, fallback: 'Não foi possível criar seu perfil.'
    });
    this.pendingSocialProfile = null;
    return this.applyUser(result.user, result.token);
  },
  async startSocial(provider) {
    try {
      const { data, error } = await (await getSupabaseClient()).auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });
      if (error) throw error;
      return data;
    } catch (error) {
      throw new Error(error.message || 'Não foi possível iniciar o login social.');
    }
  },
  async logout() {
    await request('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    await this.signOutSocial();
    clearTimeout(progressSyncTimer);
    this.profile = { name: '', sysLang: 'pt-br', readMode: 'h' };
    store.set('profile', this.profile);
    this.activateUserData('');
  },
  async updateProfile(profile) {
    const result = await request(userUrl(profile.id), {
      method: 'PATCH', body: { email: profile.email, nome: profile.name, foto_url: profile.photoUrl }, fallback: 'Não foi possível atualizar o perfil.'
    });
    this.applyUser(result.user);
    return result.user;
  },
  setReader(p) { Object.assign(this.reader, p); store.set('settings', this.reader); },
  setTheme(theme) { this.theme = theme; store.set('theme', theme); },
  setAnimations(enabled) { this.animations = enabled; store.set('animations', enabled); },
  setTextSize(size) { this.textSize = size; store.set('textSize', size); },

  /* ----- salvos (leitura futura) ----- */
  saved: () => store.get('fav', {}),
  isSaved(id) { return !!this.saved()[id]; },
  toggleSaved(id) {
    const saved = this.saved(), manga = this.cache[id];
    if (!manga) return false;
    if (saved[id]) delete saved[id]; else saved[id] = manga;
    store.set('fav', saved);
    this.invalidateRecommendations();
    return !!saved[id];
  },
  // O servidor é a fonte da verdade: itens locais ausentes na nuvem são descartados.
  async syncSaved() {
    if (!this.profile.id) return;
    const { saved = [] } = await request(userUrl(this.profile.id, 'salvos'), { fallback: 'Não foi possível sincronizar os mangás salvos.' });
    const remote = new Map(saved.filter(entry => entry.manga_id && entry.manga).map(entry => [String(entry.manga_id), entry.manga]));
    const local = this.saved();
    Object.keys(local).forEach(id => { if (!remote.has(id)) delete local[id]; });
    remote.forEach((manga, id) => { local[id] = manga; });
    store.set('fav', local);
    return local;
  },
  async saveSavedRecord(manga) {
    if (!this.profile.id || !manga?.id) return;
    await request(userUrl(this.profile.id, 'salvos'), { method: 'PUT', body: { mangaId: manga.id, manga }, fallback: 'Não foi possível salvar o mangá na nuvem.' });
  },
  async removeSavedRecord(id) {
    if (!this.profile.id) return;
    await request(userUrl(this.profile.id, 'salvos', id), { method: 'DELETE', fallback: 'Não foi possível remover o mangá salvo na nuvem.' }).catch(ignoreMissing);
  },
  async cacheManga(manga) {
    store.set('offline', { ...store.get('offline', {}), [manga.id]: manga });
    await this.chapters(manga).catch(() => undefined);
    if (!('caches' in window)) return;
    const cache = await caches.open(OFFLINE_CACHE);
    await Promise.all([manga.cover, manga.coverBig].filter(Boolean).map(url => cache.add(url).catch(() => undefined)));
  },

  // Libera espaço: remove do cache tudo o que foi guardado só por ter sido lido.
  // Ficam apenas as páginas de capítulos baixados e as capas dos mangás salvos/baixados.
  async pruneReadingCache() {
    if (!('caches' in window) || localStorage.getItem('mk:cache-pruned-v2')) return;
    const keep = new Set(), absolute = url => new URL(url, location.origin).href;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || '';
      if (/^mk:(user:[^:]+|guest):offlineChapters$/.test(key)) Object.values(readStorage(key, {})).forEach(entry => (entry?.pages || []).forEach(page => keep.add(absolute(page))));
      if (/^mk:(user:[^:]+|guest):(offline|fav)$/.test(key)) Object.values(readStorage(key, {})).forEach(manga => [manga?.cover, manga?.coverBig].forEach(url => url && keep.add(absolute(url))));
    }
    const cache = await caches.open(OFFLINE_CACHE);
    const volatile = ({ pathname }) => pathname === '/img' || pathname === '/tr' || ['/md/', '/jk/', '/downloads/'].some(prefix => pathname.startsWith(prefix));
    await Promise.all((await cache.keys()).filter(request => volatile(new URL(request.url)) && !keep.has(request.url)).map(request => cache.delete(request)));
    localStorage.setItem('mk:cache-pruned-v2', '1');
  },

  /* ----- downloads offline ----- */
  downloadedChapters() {
    if (!this.profile.id) return {};
    return Object.values(store.get('offlineChapters', {}))
      .filter(entry => entry?.ownerId === this.profile.id && entry.chapterId)
      .reduce((chapters, entry) => {
        const current = chapters[entry.chapterId];
        if (!current || (entry.localAvailable && !current.localAvailable) || Number(entry.updatedAt || 0) > Number(current.updatedAt || 0)) chapters[entry.chapterId] = entry;
        return chapters;
      }, {});
  },
  offlineManga: id => store.get('offline', {})[id] || null,
  isChapterDownloaded(id) { return !!this.downloadedChapters()[id]?.localAvailable; },
  async hasLocalChapter(entry) {
    if (!entry?.pages?.length) return false;
    const stored = new Set((await idbGetAll('pages').catch(() => []))
      .filter(page => page.userId === this.profile.id && page.deviceId === this.deviceId && page.chapterId === entry.chapterId && page.blob?.size)
      .map(page => page.index));
    if (stored.size === entry.pages.length) return true;
    if (!('caches' in window)) return false;
    const cache = await caches.open(OFFLINE_CACHE);
    return (await Promise.all(entry.pages.map(page => cache.match(page)))).every(Boolean);
  },
  async refreshDownloadIntegrity() {
    const saved = this.downloadedChapters(), all = store.get('offlineChapters', {});
    await Promise.all(Object.values(saved).map(async entry => {
      entry.localAvailable = await this.hasLocalChapter(entry);
      entry.downloaded = entry.localAvailable;
    }));
    store.set('offlineChapters', { ...all, ...saved });
    return saved;
  },
  setSyncError(chapterId, message) {
    const saved = store.get('offlineChapters', {});
    if (!saved[chapterId]) return;
    saved[chapterId].syncError = message;
    store.set('offlineChapters', saved);
  },
  async syncDownloads() {
    const userId = this.profile.id;
    if (!userId) return;
    const { downloads = [] } = await request(userUrl(userId, 'downloads'), { fallback: 'Não foi possível sincronizar os downloads.' });
    const allLocal = store.get('offlineChapters', {});
    (await idbGetAll('downloads').catch(() => []))
      .filter(item => item.userId === userId && item.deviceId === this.deviceId && item.entry)
      .forEach(item => { allLocal[item.entry.chapterId] = item.entry; });
    store.set('offlineChapters', allLocal);
    const local = Object.fromEntries(Object.values(allLocal)
      .filter(entry => entry?.ownerId === userId && entry.deviceId === this.deviceId)
      .map(entry => [entry.chapterId, entry]));

    const merged = {};
    for (const remote of new Map(downloads.filter(entry => entry?.chapter_id).map(entry => [entry.chapter_id, entry])).values()) {
      const current = local[remote.chapter_id], remoteTime = new Date(remote.atualizado_em).getTime();
      merged[remote.chapter_id] = current?.localAvailable && current.deviceId === this.deviceId
        ? { ...current, syncError: '', updatedAt: remoteTime || current.updatedAt || Date.now() }
        : {
          mangaId: remote.manga_id, manga: remote.manga || current?.manga || null, chapterId: remote.chapter_id,
          num: remote.numero || current?.num || '', title: remote.titulo || current?.title || '',
          language: remote.idioma || current?.language || this.cfg.lang, source: remote.origem || current?.source || 'MangaDex',
          pages: current?.pages || [], folder: current?.folder || '', downloaded: false, localAvailable: false,
          deviceId: remote.device_id || '', ownerId: userId, updatedAt: remoteTime || Date.now()
        };
    }
    Object.values(local).forEach(entry => { merged[entry.chapterId] = entry; });
    store.set('offlineChapters', merged);

    for (const entry of Object.values(local).filter(item => item?.localAvailable)) await this.queueDownloadSync(entry);
    await this.processDownloadQueue();
    return merged;
  },
  async queueDownloadSync(entry) {
    if (!this.profile.id || !entry?.chapterId) return;
    await idbPut('queue', { key: `${this.profile.id}:${this.deviceId}:${entry.chapterId}`, userId: this.profile.id, deviceId: this.deviceId, entry });
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready.catch(() => null);
      await registration?.sync?.register('mangakindle-downloads').catch(() => undefined);
    }
    this.processDownloadQueue().catch(error => warn('fila de downloads', error));
  },
  async processDownloadQueue() {
    if (!this.profile.id || !navigator.onLine) return;
    const queued = (await idbGetAll('queue')).filter(item => item.userId === this.profile.id && item.deviceId === this.deviceId);
    for (const { key, entry } of queued) {
      try {
        if (!await this.saveDownloadRecord(entry)) continue;
        await idbDelete('queue', key);
        this.setSyncError(entry.chapterId, '');
      } catch (error) {
        this.setSyncError(entry.chapterId, error.message || 'Não foi possível sincronizar o download.');
      }
    }
  },
  async saveDownloadRecord(entry) {
    if (!this.profile.id || entry.ownerId !== this.profile.id || entry.deviceId !== this.deviceId) return false;
    await request(userUrl(this.profile.id, 'downloads'), {
      method: 'PUT', fallback: 'Não foi possível salvar o download na nuvem.',
      body: {
        chapterId: entry.chapterId, mangaId: entry.mangaId, manga: entry.manga, num: entry.num, title: entry.title,
        language: entry.language, source: entry.source, deviceId: entry.deviceId || this.deviceId
      }
    });
    return true;
  },
  async removeChapterDownload(id) {
    const saved = store.get('offlineChapters', {}), entry = this.downloadedChapters()[id];
    if (!entry) return;
    const key = `${this.profile.id}:${this.deviceId}:${id}`;
    if (entry.folder) { // download legado em disco
      const response = await fetch(`/downloads/${encodeURIComponent(entry.folder)}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) throw new Error('Falha ao remover arquivo');
    }
    if ('caches' in window) {
      const cache = await caches.open(OFFLINE_CACHE);
      await Promise.all((entry.pages || []).map(page => cache.delete(page)));
    }
    delete saved[id];
    store.set('offlineChapters', saved);
    await Promise.all([idbDelete('downloads', key), idbDelete('queue', key)].map(task => task.catch(() => undefined)));
    const pages = await idbGetAll('pages').catch(() => []);
    await Promise.all(pages
      .filter(page => page.userId === this.profile.id && page.deviceId === this.deviceId && page.chapterId === id)
      .map(page => idbDelete('pages', page.key)));
    if (this.profile.id) {
      await request(`${userUrl(this.profile.id, 'downloads', id)}?deviceId=${encodeURIComponent(this.deviceId)}`, { method: 'DELETE', fallback: 'Falha ao remover registro na nuvem' }).catch(ignoreMissing);
    }
  },
  async downloadChapter(manga, chapter, onProgress = () => { }) {
    if (!('caches' in window)) throw new Error('Armazenamento offline indisponível');
    if (chapter.source && chapter.source !== 'MangaDex') throw new Error('Capítulo secundário não possui páginas compatíveis');
    const pages = await this.pages(chapter.id, 'data');
    const cache = await caches.open(OFFLINE_CACHE), saved = store.get('offlineChapters', {});
    const entry = {
      ownerId: this.profile.id, deviceId: this.deviceId, mangaId: manga.id, manga, chapterId: chapter.id, num: chapter.num, title: chapter.title || '',
      language: chapter.language || this.cfg.lang, source: chapter.source || 'MangaDex', pages, folder: '', downloaded: false, updatedAt: Date.now()
    };
    saved[chapter.id] = entry;
    store.set('offlineChapters', saved);
    store.set('offline', { ...store.get('offline', {}), [manga.id]: manga });

    let next = 0;
    const worker = async () => {
      while (next < pages.length) {
        const index = next++;
        const response = await fetch(pages[index]);
        if (!response.ok) throw new Error(`Página ${index + 1} indisponível`);
        const blob = await response.clone().blob();
        await Promise.all([
          cache.put(pages[index], new Response(blob, { headers: { 'Content-Type': response.headers.get('Content-Type') || 'image/jpeg' } })),
          idbPut('pages', { key: `${this.profile.id}:${this.deviceId}:${chapter.id}:${index}`, userId: this.profile.id, deviceId: this.deviceId, chapterId: chapter.id, index, blob })
        ]);
        onProgress(next, pages.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, pages.length) }, worker));
    Object.assign(entry, { downloaded: true, localAvailable: true, updatedAt: Date.now() });
    store.set('offlineChapters', saved);
    await idbPut('downloads', { key: `${this.profile.id}:${this.deviceId}:${chapter.id}`, userId: this.profile.id, deviceId: this.deviceId, entry });
    await this.queueDownloadSync(entry);
    store.set('offlineChapters', saved);
    return entry;
  },

  /* ----- progresso de leitura ----- */
  progress: () => store.get('progress', {}),
  progressOf(id) { return this.progress()[id] || null; },
  isChapterRead(mangaId, chapterId) {
    const entry = this.progressOf(mangaId);
    return Boolean(entry?.readChapters?.[chapterId] || entry?.chId === chapterId && Number(entry.page) >= Number(entry.total));
  },
  saveProgress() {
    const { m, chs, i, p, pages } = this.R;
    if (!m || !chs[i]) return;
    const all = this.progress(), previous = all[m.id] || {};
    const readChapters = { ...previous.readChapters };
    if (p >= pages.length) readChapters[chs[i].id] = Date.now();
    const entry = all[m.id] = { ...previous, id: m.id, manga: m, chId: chs[i].id, chNum: chs[i].num, page: p, total: pages.length, ts: Date.now(), readChapters };
    store.set('progress', all);
    this.invalidateRecommendations();
    clearTimeout(progressSyncTimer);
    progressSyncTimer = setTimeout(() => this.saveProgressRecord(entry).catch(error => warn('progresso não sincronizado', error)), 300);
  },
  // Mantém o registro mais recente de cada mangá e une os capítulos lidos nos dois lados.
  async syncProgress() {
    if (!this.profile.id) return;
    const local = this.progress();
    const { progress: records = [] } = await request(userUrl(this.profile.id, 'progresso'), { fallback: 'Não foi possível sincronizar o progresso.' });
    const remoteById = new Map(records.map(record => record.progresso).filter(remote => remote?.id).map(remote => [remote.id, remote]));
    for (const [id, remote] of remoteById) {
      const current = local[id];
      if (!current || Number(remote.ts) > Number(current.ts)) {
        local[id] = { ...remote, readChapters: { ...current?.readChapters, ...remote.readChapters } };
      } else {
        current.readChapters = { ...remote.readChapters, ...current.readChapters };
      }
    }
    store.set('progress', local);
    // Gêneros faltantes são buscados em segundo plano, sem atrasar a abertura do app.
    this.hydrateTags(Object.values(local).map(entry => entry.manga), 3).then(() => store.set('progress', local)).catch(() => undefined);
    const readCount = entry => Object.keys(entry?.readChapters || {}).length;
    for (const entry of Object.values(local)) {
      const remote = remoteById.get(entry.id);
      if (!remote || Number(entry.ts) > Number(remote.ts) || readCount(entry) > readCount(remote)) await this.saveProgressRecord(entry);
    }
    return local;
  },
  async saveProgressRecord(entry) {
    if (!this.profile.id || !entry?.id) return;
    await request(userUrl(this.profile.id, 'progresso'), { method: 'PUT', body: { mangaId: entry.id, progress: entry }, fallback: 'Não foi possível salvar o progresso na nuvem.' });
  },

  /* ----- rede (fila para respeitar os limites das APIs) ----- */
  api(url, tries = 2) {
    const volatile = url.includes('/at-home/'); // endereços de página expiram: nunca reaproveitar
    if (!volatile) {
      const hit = apiMemo.get(url);
      if (hit && Date.now() - hit.ts < API_TTL) return Promise.resolve(hit.data);
      if (apiPending.has(url)) return apiPending.get(url);
    }
    const task = this.apiFetch(url, tries).then(data => {
      if (!volatile) {
        apiMemo.set(url, { ts: Date.now(), data });
        if (apiMemo.size > API_MEMO_MAX) apiMemo.delete(apiMemo.keys().next().value);
      }
      return data;
    }).finally(() => apiPending.delete(url));
    if (!volatile) apiPending.set(url, task);
    return task;
  },
  async apiFetch(url, tries) {
    const key = url.startsWith(JK) ? 'jk' : url.startsWith(TR) ? 'tr' : 'md';
    for (let attempt = 0; attempt <= tries; attempt++) {
      const wait = Math.max(0, last[key] + GAP[key] - Date.now());
      last[key] = Date.now() + wait;
      await sleep(wait);
      try {
        const response = await fetch(url);
        if (response.status === 429) { await sleep(1500 * (attempt + 1)); continue; }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        if (attempt === tries) throw error;
      }
    }
    throw new Error('Falha de rede');
  },

  /* ----- catálogo ----- */
  pick(titles) {
    if (!titles) return '';
    const target = this.profile.sysLang.toLowerCase();
    const key = Object.keys(titles).find(k => k.toLowerCase() === target) || Object.keys(titles).find(k => k.toLowerCase().split('-')[0] === target.split('-')[0]);
    return titles[key] || titles.en || titles['ja-ro'] || Object.values(titles)[0] || '';
  },
  // Filtra pelo idioma do catálogo: só mangás com capítulos traduzidos nele
  base() {
    return `includes[]=cover_art&includes[]=author&includes[]=artist&contentRating[]=safe&contentRating[]=suggestive&availableTranslatedLanguage[]=${encodeURIComponent(this.cfg.lang)}&hasAvailableChapters=true`;
  },
  norm(manga) {
    const a = manga.attributes, related = type => manga.relationships.filter(r => r.type === type);
    const file = related('cover_art')[0]?.attributes?.fileName;
    const cover = suffix => file ? img(`https://uploads.mangadex.org/covers/${manga.id}/${file}${suffix}`) : '';
    const descriptions = a.description || {}, sys = this.profile.sysLang.toLowerCase();
    const descLang = Object.keys(descriptions).find(k => k.toLowerCase() === sys) ||
      Object.keys(descriptions).find(k => k.toLowerCase().split('-')[0] === sys.split('-')[0]) ||
      (descriptions.en ? 'en' : Object.keys(descriptions)[0] || '');
    const names = type => [...new Set(related(type).map(r => r.attributes?.name).filter(Boolean))];
    return {
      id: manga.id, title: this.pick(a.title), alts: (a.altTitles || []).map(o => this.pick(o)).filter(Boolean),
      desc: descriptions[descLang] || '', descLang, year: a.year, lang: a.originalLanguage, status: a.status,
      tags: (a.tags || []).map(t => t.attributes?.name?.en).filter(Boolean),
      tagIds: (a.tags || []).map(t => t.id).filter(Boolean), links: a.links || {},
      authors: names('author'), artists: names('artist'),
      cover: cover('.256.jpg'), coverBig: cover('.512.jpg'), rating: null
    };
  },
  async list(extra) {
    const data = await this.api(`${MD}/manga?${this.base()}&${extra}`);
    const items = data.data.map(item => this.norm(item));
    if (items.length) {
      try {
        const { statistics } = await this.api(`${MD}/statistics/manga?${items.map(i => 'manga[]=' + i.id).join('&')}`);
        items.forEach(i => { i.rating = statistics[i.id]?.rating?.average ?? null; });
      } catch { /* a nota é opcional */ }
    }
    items.forEach(i => { this.cache[i.id] = i; });
    return { items, total: data.total };
  },
  async getManga(id, refresh = false) { // também usado pelos links compartilhados (?manga=ID)
    if (!MANGA_ID.test(String(id))) throw new Error('Mangá não encontrado');
    if (this.cache[id] && !refresh) return this.cache[id];
    const stats = this.api(`${MD}/statistics/manga/${encodeURIComponent(id)}`).catch(() => null); // em paralelo com o mangá
    let manga;
    try {
      manga = this.norm((await this.api(`${MD}/manga/${encodeURIComponent(id)}?includes[]=cover_art&includes[]=author&includes[]=artist`)).data);
    } catch (error) {
      manga = store.get('offline', {})[id];
      if (!manga) throw error;
    }
    manga.rating = (await stats)?.statistics?.[id]?.rating?.average ?? null; // a nota é opcional
    return this.cache[id] = manga;
  },
  async search(query, offset = 0) {
    const exact = await this.list(`title=${encodeURIComponent(query)}&order[relevance]=desc&limit=24&offset=${offset}`);
    if (exact.items.length || offset > 0) return exact;
    // Sem resultado exato: busca por cada termo e ordena por aderência ao texto digitado
    const terms = [...new Set(query.split(/\s+/).filter(term => term.length >= 3))].slice(0, 3);
    const found = new Map();
    const results = await Promise.all(terms.map(term =>
      this.list(`title=${encodeURIComponent(term)}&order[relevance]=desc&limit=24`).catch(() => ({ items: [] }))
    ));
    results.forEach(({ items }) => items.forEach(item => found.set(item.id, item)));
    const q = query.toLocaleLowerCase();
    const score = item => {
      const title = [item.title, ...item.alts].join(' ').toLocaleLowerCase();
      return (title === q ? 100 : 0) + (title.includes(q) ? 30 : 0) + terms.reduce((n, term) => n + (title.includes(term.toLocaleLowerCase()) ? 5 : 0), 0);
    };
    const items = [...found.values()].sort((a, b) => score(b) - score(a));
    return { items: items.slice(offset, offset + 24), total: items.length };
  },
  // Destaques da semana: obras atualizadas nos últimos 7 dias, das mais populares para as menos.
  async weeklyHighlights() {
    const HOUR = 3_600_000, since = new Date(Math.floor((Date.now() - 7 * 24 * HOUR) / HOUR) * HOUR).toISOString().slice(0, 19);
    return (await this.list(`order[followedCount]=desc&updatedAtSince=${encodeURIComponent(since)}&limit=30`)).items;
  },
  // O conjunto exibido muda a cada 6 horas, percorrendo a lista inteira de forma circular.
  pickHighlights(items, count = 6) {
    const withDesc = items.filter(item => item.desc), pool = withDesc.length >= count ? withDesc : items;
    if (pool.length <= count) return pool;
    const start = (Math.floor(Date.now() / (6 * 3_600_000)) * count) % pool.length;
    return Array.from({ length: count }, (_, i) => pool[(start + i) % pool.length]);
  },
  async tags() {
    this.tagList ??= (await this.api(`${MD}/manga/tag`)).data.map(t => ({ id: t.id, n: t.attributes.name.en, g: t.attributes.group }));
    return this.tagList;
  },

  /* ----- capítulos e páginas ----- */
  async chapters(manga) {
    const cacheKey = `${manga.id}:${this.cfg.lang}`;
    if (this.chapterCache.has(cacheKey)) return this.chapterCache.get(cacheKey);
    const order = chapter => { const n = Number.parseFloat(chapter.num); return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER; };
    let chapters;
    try {
      const data = await request(`/chapters?mangaId=${encodeURIComponent(manga.id)}&title=${encodeURIComponent(manga.title)}&language=${encodeURIComponent(this.cfg.lang)}`, { fallback: 'Falha ao carregar capítulos.' });
      chapters = (data.chapters || []).map(c => ({ id: c.id, num: c.number, title: c.title, language: c.language, source: c.source })).sort((a, b) => order(a) - order(b));
    } catch (error) { // sem rede: usa apenas os capítulos baixados
      chapters = Object.values(this.downloadedChapters()).filter(c => c.mangaId === manga.id && c.downloaded)
        .map(c => ({ id: c.chapterId, num: c.num, title: c.title || '', language: c.language || this.cfg.lang, source: c.source || 'MangaDex' }))
        .sort((a, b) => Number.parseFloat(a.num) - Number.parseFloat(b.num));
      if (!chapters.length) throw error;
    }
    this.chapterCache.set(cacheKey, chapters);
    return chapters;
  },
  async pages(chapterId, quality = this.reader.q) {
    const offline = this.downloadedChapters()[chapterId];
    if (offline?.localAvailable) return offline.pages;
    const data = await this.api(`${MD}/at-home/server/${encodeURIComponent(chapterId)}`);
    const chapter = data?.chapter;
    if (!chapter?.hash || !data?.baseUrl) throw new Error('O provedor não retornou os dados das páginas.');
    const requested = quality === 'data' ? chapter.data : chapter.dataSaver;
    const files = Array.isArray(requested) && requested.length ? requested :
      (quality === 'data' ? chapter.dataSaver : chapter.data);
    if (!Array.isArray(files) || !files.length) throw new Error('Nenhuma página disponível para este capítulo.');
    const useDataSaver = files === chapter.dataSaver;
    const pages = files.filter(file => typeof file === 'string' && file);
    if (!pages.length) throw new Error('Nenhuma página válida disponível para este capítulo.');
    return pages.map(file => img(`${data.baseUrl}/${useDataSaver ? 'data-saver' : 'data'}/${chapter.hash}/${file}`));
  },

  /* ----- metadados extras (Jikan) ----- */
  async extra(manga) {
    const mal = manga.links.mal || (await this.api(`${JK}/manga?q=${encodeURIComponent(manga.title)}&limit=1`, 1)).data[0]?.mal_id;
    if (!mal) return null;
    const { data } = await this.api(`${JK}/manga/${encodeURIComponent(mal)}/full`, 1);
    return { mag: data.serializations?.map(s => s.name).join(', '), year: data.published?.prop?.from?.year, score: data.score };
  },

  /* ----- tradução da sinopse (MyMemory) para o idioma do sistema ----- */
  needsTranslation(manga) {
    const lang = value => String(value || '').toLowerCase().split('-')[0];
    return !!manga.desc && !!manga.descLang && lang(manga.descLang) !== lang(this.profile.sysLang);
  },
  async translate(manga) {
    const to = this.profile.sysLang, key = `${manga.id}:${manga.descLang}>${to}`, translations = store.get('trcache', {});
    if (translations[key]) return translations[key];
    // O MyMemory limita o tamanho por requisição: divide a sinopse em blocos de até ~450 caracteres
    const text = manga.desc.replace(/\s+/g, ' ').slice(0, 1800), parts = [];
    let buffer = '';
    for (const sentence of text.match(/[^.!?。]+[.!?。]*\s*/g) || [text]) {
      if ((buffer + sentence).length > 450 && buffer) { parts.push(buffer); buffer = sentence; } else buffer += sentence;
    }
    if (buffer) parts.push(buffer);
    const out = [];
    for (const part of parts) {
      const data = await this.api(`${TR}?q=${encodeURIComponent(part)}&langpair=${toMyMemory(manga.descLang)}|${toMyMemory(to)}`, 1);
      const translated = data.responseData?.translatedText;
      if (Number(data.responseStatus) !== 200 || !translated || /MYMEMORY WARNING/i.test(translated)) throw new Error('tradução indisponível');
      out.push(translated);
    }
    const keys = Object.keys(translations);
    if (keys.length > 60) delete translations[keys[0]];
    translations[key] = out.join(' ');
    store.set('trcache', translations);
    return translations[key];
  }
};

Model.activateUserData(Model.profile.id || '');
Model.reader.dir ??= Model.profile.readMode;

const flushDownloadQueue = () => Model.processDownloadQueue().catch(error => warn('fila de downloads', error));
window.addEventListener('online', flushDownloadQueue);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => { if (event.data?.type === 'sync-downloads') flushDownloadQueue(); });
}
