// Servidor local do MangaKindle — sem dependências (Node 18+)
// Uso: node server.js  →  abra http://localhost:3000
// Serve os arquivos estáticos e faz proxy de: MangaDex (/md), Jikan (/jk), tradução (/tr), imagens (/img), capítulos (/chapters) e bandeiras (/flag)
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path');
const PORT = 3000, ROOT = __dirname;
const DOWNLOAD_ROOT = path.join(ROOT, 'downloads');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const MD_API = 'https://api.mangadex.org';
const COMICK_API = 'https://api.comick.fun/v1.0';
const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

function body(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 10 * 1024 * 1024) reject(new Error('Payload muito grande'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function jsonResponse(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function validateUserInput(payload, requireUsername = true) {
  const username = String(payload.username || '').trim().toLowerCase();
  const email = String(payload.email || '').trim().toLowerCase();
  const nomeCompleto = String(payload.nome_completo || '').trim();
  const fotoUrl = String(payload.foto_url || '').trim();
  if (requireUsername && !/^[a-zA-Z0-9._-]{3,24}$/.test(username)) {
    throw new Error('Username deve ter de 3 a 24 caracteres: letras, números, ponto, hífen ou sublinhado.');
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe um e-mail válido.');
  if (requireUsername && !email) throw new Error('E-mail é obrigatório.');
  if (fotoUrl && !/^https?:\/\//i.test(fotoUrl) && !/^data:image\/(?:jpeg|png|gif|webp);base64,/i.test(fotoUrl)) {
    throw new Error('A foto deve ser um link HTTP/HTTPS ou uma imagem válida.');
  }
  if (fotoUrl.startsWith('data:') && fotoUrl.length > 3 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 2 MB.');
  return { username, email, nome_completo: nomeCompleto || null, foto_url: fotoUrl || null };
}

async function supabaseRequest(endpoint, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
  }
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let value = null;
  try { value = text ? JSON.parse(text) : null; } catch { value = { message: text }; }
  if (!response.ok) {
    const error = new Error(value?.message || value?.hint || `Supabase HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return value;
}

async function findUser(username) {
  const result = await supabaseRequest(`usuarios?select=id,username,nome_completo,email,foto_url,criado_em&username=eq.${encodeURIComponent(username)}&limit=1`);
  return result[0] || null;
}

async function loginOrCreateUser(payload) {
  const input = validateUserInput(payload);
  const existing = await findUser(input.username);
  if (existing) {
    if (existing.email.toLowerCase() !== input.email) {
      const error = new Error('Este nome de usuário já está em uso. Informe o e-mail correto.');
      error.status = 409;
      throw error;
    }
    return { user: existing, created: false };
  }
  try {
    const created = await supabaseRequest('usuarios', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(input)
    });
    return { user: created[0], created: true };
  } catch (error) {
    if (error.status === 409 || error.status === 400) {
      const duplicate = await findUser(input.username);
      if (duplicate) {
        const conflict = new Error('Este nome de usuário já está em uso.');
        conflict.status = 409;
        throw conflict;
      }
    }
    throw error;
  }
}

async function updateUser(username, payload) {
  const input = validateUserInput({ ...payload, username }, false);
  if (!input.email) throw new Error('E-mail é obrigatório.');
  const updated = await supabaseRequest(`usuarios?username=eq.${encodeURIComponent(username)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ email: input.email, nome_completo: input.nome_completo, foto_url: input.foto_url })
  });
  if (!updated.length) {
    const error = new Error('Usuário não encontrado.');
    error.status = 404;
    throw error;
  }
  return updated[0];
}

function downloadFolder(id) {
  return Buffer.from(String(id)).toString('base64url').replace(/[^a-zA-Z0-9_-]/g, '');
}

function imageTarget(value) {
  const parsed = new URL(value, 'http://localhost');
  if (parsed.pathname !== '/img') throw new Error('URL de imagem inválida');
  const target = new URL(parsed.searchParams.get('u') || '');
  if (!/(^|\.)mangadex\.(org|network)$/.test(target.hostname)) throw new Error('Host de imagem não permitido');
  return target;
}

async function saveChapter(chapterId, pages) {
  if (!Array.isArray(pages) || !pages.length || pages.length > 2000) throw new Error('Lista de páginas inválida');
  const folder = downloadFolder(chapterId);
  const dir = path.join(DOWNLOAD_ROOT, folder);
  await fs.promises.rm(dir, { recursive: true, force: true });
  await fs.promises.mkdir(dir, { recursive: true });
  const savedPages = [];
  try {
    for (let i = 0; i < pages.length; i++) {
      const target = imageTarget(pages[i]);
      const response = await fetch(target);
      if (!response.ok) throw new Error(`Página ${i + 1} indisponível`);
      const file = `${String(i + 1).padStart(4, '0')}.jpg`;
      await fs.promises.writeFile(path.join(dir, file), Buffer.from(await response.arrayBuffer()));
      savedPages.push(`/downloads/${folder}/${file}`);
    }
    return { folder, pages: savedPages };
  } catch (error) {
    await fs.promises.rm(dir, { recursive: true, force: true });
    throw error;
  }
}

function chapterNumber(value) {
  const n = Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function hasChapterGaps(chapters) {
  const nums = chapters.map(c => chapterNumber(c.number)).filter(Number.isFinite).sort((a, b) => a - b);
  if (nums.length < 2) return true;
  const unique = [...new Set(nums)];
  const min = unique[0], max = unique[unique.length - 1];
  const expected = Math.floor(max - min) + 1;
  const missing = Math.max(0, expected - unique.length);
  const largestGap = unique.reduce((gap, n, i) => Math.max(gap, i ? Math.floor(n - unique[i - 1]) - 1 : 0), 0);
  return (max >= 20 && missing / expected >= .2) || largestGap >= 10;
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
  for (let offset = 0, total = 1; offset < total;) {
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
    const items = data.data || [];
    total = data.total || 0;
    offset += items.length;
    out.push(...items.filter(c => c.attributes?.pages > 0).map(c => normalizeMangaDexChapter(c, language)));
    if (!items.length) break;
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
  const keyOf = chapter => {
    const n = chapterNumber(chapter.number);
    return n == null ? String(chapter.number).toLowerCase() : String(n);
  };
  primary.forEach(chapter => merged.set(keyOf(chapter), chapter));
  secondary.forEach(chapter => {
    const key = keyOf(chapter);
    if (!merged.has(key)) merged.set(key, chapter);
  });
  return [...merged.values()].sort((a, b) => {
    const an = chapterNumber(a.number), bn = chapterNumber(b.number);
    return (an ?? Number.MAX_SAFE_INTEGER) - (bn ?? Number.MAX_SAFE_INTEGER);
  });
}

http.createServer((req, res) => {
  const url = req.url;
  if (req.method === 'POST' && url === '/api/usuarios') {
    return body(req).then(loginOrCreateUser)
      .then(result => jsonResponse(res, result.created ? 201 : 200, result))
      .catch(error => jsonResponse(res, error.status || 400, { error: error.message }));
  }
  const userMatch = url.match(/^\/api\/usuarios\/([^/?]+)$/);
  if (userMatch && req.method === 'PATCH') {
    return body(req).then(payload => updateUser(decodeURIComponent(userMatch[1]), payload))
      .then(user => jsonResponse(res, 200, { user }))
      .catch(error => jsonResponse(res, error.status || 400, { error: error.message }));
  }
  if (req.method === 'POST' && url === '/downloads') {
    return body(req).then(payload => saveChapter(payload.chapterId, payload.pages))
      .then(result => { res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result)); })
      .catch(error => { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); });
  }
  const downloadMatch = url.match(/^\/downloads\/([a-zA-Z0-9_-]+)(?:\/([0-9]+\.jpg))?$/);
  if (downloadMatch && req.method === 'DELETE' && !downloadMatch[2]) {
    return fs.promises.rm(path.join(DOWNLOAD_ROOT, downloadMatch[1]), { recursive: true, force: true })
      .then(() => { res.writeHead(204); res.end(); })
      .catch(() => { res.writeHead(500); res.end('Não foi possível remover o download'); });
  }
  if (downloadMatch && req.method === 'GET' && downloadMatch[2]) {
    const file = path.join(DOWNLOAD_ROOT, downloadMatch[1], downloadMatch[2]);
    return fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); return res.end('Não encontrado'); }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' }); res.end(data);
    });
  }
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
