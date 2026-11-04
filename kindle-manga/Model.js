const MD = '/md', JK = '/jk', TR = '/tr'; // rotas do proxy local (server.js)
export const img = u => '/img?u=' + encodeURIComponent(u);

export const LANGS = [['pt-br', 'Português (Brasil)'], ['en', 'English'], ['es-la', 'Español (Latinoamérica)'], ['es', 'Español (España)'], ['fr', 'Français'], ['it', 'Italiano'], ['de', 'Deutsch'], ['ru', 'Русский'], ['id', 'Bahasa Indonesia']];
// idioma original → [código da bandeira, país, formato]
export const COUNTRY = { ja: ['jp', 'Japão', 'Mangá'], ko: ['kr', 'Coreia do Sul', 'Manhwa'], zh: ['cn', 'China', 'Manhua'], 'zh-hk': ['hk', 'Hong Kong', 'Manhua'], en: ['us', 'EUA/Reino Unido', 'Comic'] };

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { } }
};
const MM = c => ({ 'pt-br': 'pt-BR', pt: 'pt-PT', 'es-la': 'es', zh: 'zh-CN', 'ja-ro': 'ja' }[c] || c); // códigos do MyMemory
const last = { md: 0, jk: 0, tr: 0 }, GAP = { md: 240, jk: 420, tr: 300 };

export const Model = {
  /* ----- estado ----- */
  cache: {},                 // mangás já carregados (id → mangá)
  tab: 'home',
  filters: null,             // listagem atual {title, extra, g2, offset, total}
  R: { m: null, chs: [], i: 0, pages: [], p: 1 }, // posição de leitura atual
  cfg: { lang: 'pt-br', ...store.get('cfg', {}) },  // idioma do catálogo
  profile: { name: '', avatar: '🦊', sysLang: 'pt-br', readMode: 'h', ...store.get('profile', {}) },
  reader: { bg: '#000000', dir: null, q: 'data-saver', br: 100, ...store.get('settings', {}) },
  theme: store.get('theme', 'dark'),

  /* ----- persistência de preferências ----- */
  setCfg(p) { Object.assign(this.cfg, p); store.set('cfg', this.cfg); },
  setProfile(p) {
    if (p.readMode && p.readMode !== this.profile.readMode) this.setReader({ dir: p.readMode });
    Object.assign(this.profile, p); store.set('profile', this.profile);
  },
  setReader(p) { Object.assign(this.reader, p); store.set('settings', this.reader); },
  setTheme(t) { this.theme = t; store.set('theme', t); },

  /* ----- salvos (leitura futura) ----- */
  saved: () => store.get('fav', {}),
  isSaved(id) { return !!this.saved()[id]; },
  toggleSaved(id) {
    const s = this.saved(), m = this.cache[id]; if (!m) return false;
    s[id] ? delete s[id] : s[id] = m; store.set('fav', s); return !!s[id];
  },
  clearSaved() { store.set('fav', {}); },

  /* ----- progresso de leitura ----- */
  progress: () => store.get('progress', {}),
  progressOf(id) { return this.progress()[id] || null; },
  saveProgress() {
    const { m, chs, i, p, pages } = this.R; if (!m || !chs[i]) return;
    const all = this.progress();
    all[m.id] = { id: m.id, manga: m, chId: chs[i].id, chNum: chs[i].num, page: p, total: pages.length, ts: Date.now() };
    store.set('progress', all);
  },
  clearProgress() { store.set('progress', {}); },

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
  pick(o) { return o && (o[this.profile.sysLang] || o.en || o['ja-ro'] || Object.values(o)[0]) || ''; },
  // filtra pelo idioma do catálogo: só mangás com capítulos traduzidos nele
  base() { return `includes[]=cover_art&includes[]=author&includes[]=artist&contentRating[]=safe&contentRating[]=suggestive&availableTranslatedLanguage[]=${this.cfg.lang}&hasAvailableChapters=true`; },
  norm(m) {
    const a = m.attributes, rel = t => m.relationships.filter(r => r.type === t);
    const f = rel('cover_art')[0]?.attributes?.fileName, u = s => f ? img(`https://uploads.mangadex.org/covers/${m.id}/${f}${s}`) : '';
    const d = a.description || {}, sys = this.profile.sysLang;
    const dl = d[sys] ? sys : d.en ? 'en' : Object.keys(d)[0] || '';
    return {
      id: m.id, title: this.pick(a.title), alts: (a.altTitles || []).map(o => this.pick(o)).filter(Boolean),
      desc: d[dl] || '', descLang: dl, year: a.year, lang: a.originalLanguage, status: a.status,
      tags: (a.tags || []).map(t => t.attributes.name.en), links: a.links || {},
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
  async getManga(id) { // usado pelos links compartilhados (?manga=ID)
    if (this.cache[id]) return this.cache[id];
    const d = await this.api(`${MD}/manga/${id}?includes[]=cover_art&includes[]=author&includes[]=artist`);
    const m = this.norm(d.data);
    try { m.rating = (await this.api(`${MD}/statistics/manga/${id}`)).statistics[id]?.rating?.average ?? null; } catch { }
    return this.cache[id] = m;
  },
  async tags() {
    if (!this._tags) this._tags = (await this.api(`${MD}/manga/tag`)).data.map(t => ({ id: t.id, n: t.attributes.name.en, g: t.attributes.group }));
    return this._tags;
  },

  /* ----- capítulos e páginas ----- */
  async chapters(m) {
    const out = []; let off = 0, total = 1;
    while (off < total && off < 3000) {
      const d = await this.api(`${MD}/manga/${m.id}/feed?translatedLanguage[]=${this.cfg.lang}&order[chapter]=asc&limit=500&offset=${off}&includeExternalUrl=0&contentRating[]=safe&contentRating[]=suggestive`);
      total = d.total; off += 500;
      d.data.forEach(c => c.attributes.pages > 0 && out.push({ id: c.id, num: c.attributes.chapter || 'Oneshot' }));
    }
    const seen = new Set();
    return out.filter(c => !seen.has(c.num) && seen.add(c.num));
  },
  async pages(chId) {
    const d = await this.api(`${MD}/at-home/server/${chId}`), c = d.chapter, q = this.reader.q;
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
    return !!m.desc && !!m.descLang && m.descLang.split('-')[0] !== this.profile.sysLang.split('-')[0];
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
Model.reader.dir ??= Model.profile.readMode;
