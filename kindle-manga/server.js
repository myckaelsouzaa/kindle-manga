// Servidor local do MangaKindle — sem dependências (Node 18+)
// Uso: node server.js  →  abra http://localhost:3000
// Serve os arquivos estáticos e faz proxy de: MangaDex (/md), Jikan (/jk), tradução (/tr), imagens (/img), capítulos (/chapters) e bandeiras (/flag)
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path');
const PORT = 3000, ROOT = __dirname;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const MD_API = 'https://api.mangadex.org';
const COMICK_API = 'https://api.comick.fun/v1.0';

function proxy(target, res, cache = 600) {
  const u = new URL(target);
  https.get({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, headers: { 'User-Agent': 'MangaKindle/1.0', Accept: '*/*' } }, r => {
    res.writeHead(r.statusCode, { 'Content-Type': r.headers['content-type'] || 'application/octet-stream', 'Cache-Control': `public, max-age=${cache}` });
    r.pipe(res);
  }).on('error', e => { res.writeHead(502); res.end('Erro no proxy: ' + e.message); });
}

async function json(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'MangaKindle/1.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function chapterNumber(value) {
  const n = Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function hasChapterGaps(chapters) {
  const nums = chapters.map(c => chapterNumber(c.number)).filter(Number.isFinite).sort((a, b) => a - b);
  if (nums.length < 2) return true;
  const unique = [...new Set(nums)];
  const max = unique[unique.length - 1], missing = Math.max(0, Math.floor(max) - unique.length);
  const largestGap = unique.reduce((gap, n, i) => Math.max(gap, i ? Math.floor(n - unique[i - 1]) : 0), 0);
  return (max >= 20 && missing / max >= .2) || largestGap >= 10;
}

function normalizeMangaDexChapter(chapter, language) {
  const a = chapter.attributes || {};
  return {
    id: chapter.id,
    number: a.chapter || 'Oneshot',
    title: a.title || '',
    language: a.translatedLanguage || language,
    source: 'MangaDex'
  };
}

function normalizeSecondaryChapter(chapter, language) {
  const number = chapter.chap ?? chapter.chapter ?? chapter.number;
  if (number == null || number === '') return null;
  const id = chapter.hid || chapter.id;
  return id ? {
    id: `secondary:${id}`,
    number: String(number),
    title: chapter.title || '',
    language: chapter.lang || language,
    source: 'Secondary'
  } : null;
}

async function mangaDexChapters(mangaId, language) {
  const out = [];
  for (let offset = 0, total = 1; offset < total && offset < 3000;) {
    const query = new URLSearchParams({
      'translatedLanguage[]': language,
      'order[chapter]': 'asc',
      limit: '500',
      offset: String(offset),
      includeExternalUrl: '0',
      'contentRating[]': 'safe'
    });
    query.append('contentRating[]', 'suggestive');
    const data = await json(`${MD_API}/manga/${encodeURIComponent(mangaId)}/feed?${query}`);
    total = data.total || 0;
    offset += 500;
    out.push(...(data.data || []).filter(c => c.attributes?.pages > 0).map(c => normalizeMangaDexChapter(c, language)));
  }
  return out;
}

async function secondaryChapters(title, language) {
  const search = await json(`${COMICK_API}/search/?q=${encodeURIComponent(title)}&limit=5`);
  const result = Array.isArray(search) ? search : search.results || search.data || [];
  const match = result[0];
  const hid = match?.hid || match?.slug;
  if (!hid) return [];
  const data = await json(`${COMICK_API}/manga/${encodeURIComponent(hid)}/chapters?lang=${encodeURIComponent(language)}&limit=1000`);
  const chapters = Array.isArray(data) ? data : data.chapters || data.data || [];
  return chapters.map(c => normalizeSecondaryChapter(c, language)).filter(Boolean);
}

async function mergedChapters(mangaId, title, language) {
  const primary = await mangaDexChapters(mangaId, language);
  let secondary = [];
  if (hasChapterGaps(primary)) {
    try { secondary = await secondaryChapters(title, language); } catch { secondary = []; }
  }
  const merged = new Map();
  primary.forEach(chapter => merged.set(String(chapter.number), chapter));
  secondary.forEach(chapter => {
    const key = String(chapter.number);
    if (!merged.has(key)) merged.set(key, chapter);
  });
  return [...merged.values()].sort((a, b) => {
    const an = chapterNumber(a.number), bn = chapterNumber(b.number);
    return (an ?? Number.MAX_SAFE_INTEGER) - (bn ?? Number.MAX_SAFE_INTEGER);
  });
}

http.createServer((req, res) => {
  const url = req.url;
  if (url.startsWith('/chapters?')) {
    const query = new URL(`http://localhost${url}`).searchParams;
    const mangaId = query.get('mangaId'), title = query.get('title'), language = query.get('language') || 'pt-br';
    if (!mangaId || !title) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'mangaId e title são obrigatórios' })); }
    return mergedChapters(mangaId, title, language)
      .then(chapters => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }); res.end(JSON.stringify({ chapters })); })
      .catch(error => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Não foi possível carregar os capítulos', detail: error.message })); });
  }
  if (url.startsWith('/md/')) return proxy('https://api.mangadex.org/' + url.slice(4), res);
  if (url.startsWith('/jk/')) return proxy('https://api.jikan.moe/v4/' + url.slice(4), res);
  if (url.startsWith('/tr?')) return proxy('https://api.mymemory.translated.net/get?' + url.slice(4), res, 3600);
  const flag = url.match(/^\/flag\/([a-z]{2})$/);
  if (flag) return proxy(`https://flagcdn.com/w40/${flag[1]}.png`, res, 86400);
  if (url.startsWith('/img?u=')) { // só hosts da MangaDex (evita proxy aberto)
    try {
      const t = decodeURIComponent(url.slice(7));
      if (/(^|\.)mangadex\.(org|network)$/.test(new URL(t).hostname)) return proxy(t, res);
    } catch { }
    res.writeHead(403); return res.end('Host não permitido');
  }
  // arquivos estáticos (qualquer rota desconhecida cai no index.html)
  let p = decodeURIComponent(url.split('?')[0]); if (p === '/') p = '/index.html';
  const file = path.join(ROOT, path.normalize(p));
  const ok = file.startsWith(ROOT) && /\.(html|css|js|svg|png|ico)$/.test(file) && !file.endsWith('server.js');
  fs.readFile(ok ? file : path.join(ROOT, 'index.html'), (err, data) => {
    if (err) { res.writeHead(404); return res.end('Não encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(ok ? file : 'x.html')] || 'text/html; charset=utf-8' }); res.end(data);
  });
}).listen(PORT, () => console.log(`MangaKindle rodando em http://localhost:${PORT}`));
