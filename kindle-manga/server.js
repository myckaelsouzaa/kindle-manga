// Servidor local do MangaKindle — sem dependências (Node 18+)
// Uso: node server.js  →  abra http://localhost:3000
// Serve os arquivos estáticos e faz proxy de: MangaDex (/md), Jikan (/jk), tradução (/tr), imagens (/img), capítulos (/chapters) e bandeiras (/flag)
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path'), dns = require('dns').promises;
const PORT = 3000, ROOT = __dirname;
const DOWNLOAD_ROOT = path.join(ROOT, 'downloads');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const MD_API = 'https://api.mangadex.org';
const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

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

function validateUserInput(payload, requireEmail = true) {
  const username = String(payload.username || '').trim().toLowerCase();
  const email = String(payload.email || '').trim().toLowerCase();
  const nome = String(payload.nome ?? payload.nome_completo ?? '').trim();
  const fotoUrl = String(payload.foto_url || '').trim();
  if (!/^[a-zA-Z0-9._-]{3,24}$/.test(username)) {
    throw new Error('Username deve ter de 3 a 24 caracteres: letras, números, ponto, hífen ou sublinhado.');
  }
  if (requireEmail && !email) throw new Error('E-mail é obrigatório.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Informe um e-mail válido.');
  if (fotoUrl && !/^https?:\/\//i.test(fotoUrl) && !/^data:image\/(?:jpeg|png|gif|webp);base64,/i.test(fotoUrl)) {
    throw new Error('A foto deve ser um link HTTP/HTTPS ou uma imagem válida.');
  }
  if (fotoUrl.startsWith('data:') && fotoUrl.length > 3 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 2 MB.');
  return { username, email, nome: nome || null, foto_url: fotoUrl || null };
}

async function validateEmailDomain(email) {
  const domain = email.split('@')[1];
  try {
    const records = await dns.resolveMx(domain);
    if (!records.length) throw new Error();
  } catch {
    const error = new Error('O domínio do e-mail não existe ou não aceita e-mails.');
    error.status = 422;
    throw error;
  }
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

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, nome: user.nome, username: user.username, email: user.email, foto_url: user.foto_url, criado_em: user.criado_em };
}

async function findUser(username) {
  const result = await supabaseRequest(`usuarios?select=id,nome,username,email,foto_url,criado_em&username=eq.${encodeURIComponent(username)}&limit=1`);
  return result[0] || null;
}

async function findUserByEmail(email) {
  const result = await supabaseRequest(`usuarios?select=id,nome,username,email,foto_url,criado_em&email=ilike.${encodeURIComponent(email)}&limit=1`);
  return result[0] || null;
}

async function findUserById(id) {
  const result = await supabaseRequest(`usuarios?select=id&id=eq.${encodeURIComponent(id)}&limit=1`);
  return result[0] || null;
}

function validateUserId(id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    const error = new Error('Usuário inválido.');
    error.status = 422;
    throw error;
  }
}

async function listDownloadRecords(userId) {
  validateUserId(userId);
  if (!await findUserById(userId)) {
    const error = new Error('Usuário não encontrado.');
    error.status = 404;
    throw error;
  }
  return supabaseRequest(`downloads_usuario?select=usuario_id,capitulo_id,manga_id,manga,numero,titulo,idioma,origem,device_id,atualizado_em&usuario_id=eq.${encodeURIComponent(userId)}&order=atualizado_em.desc`);
}

async function saveDownloadRecord(userId, payload) {
  validateUserId(userId);
  const chapterId = String(payload.chapterId || '').trim();
  const mangaId = String(payload.mangaId || '').trim();
  if (!chapterId || !mangaId || chapterId.length > 200 || mangaId.length > 100) {
    const error = new Error('Dados do download inválidos.');
    error.status = 422;
    throw error;
  }
  const manga = payload.manga && typeof payload.manga === 'object' ? payload.manga : null;
  const result = await supabaseRequest('downloads_usuario?on_conflict=usuario_id,capitulo_id,device_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      usuario_id: userId,
      capitulo_id: chapterId,
      manga_id: mangaId,
      manga,
      numero: String(payload.num || '').slice(0, 40),
      titulo: String(payload.title || '').slice(0, 300),
      idioma: String(payload.language || '').slice(0, 20) || null,
      origem: String(payload.source || 'MangaDex').slice(0, 30),
      device_id: String(payload.deviceId || '').slice(0, 120) || null,
      atualizado_em: new Date().toISOString()
    })
  });
  return result[0] || null;
}

async function removeDownloadRecord(userId, chapterId, deviceId) {
  validateUserId(userId);
  if (!chapterId || chapterId.length > 200) {
    const error = new Error('Capítulo inválido.');
    error.status = 422;
    throw error;
  }

  const deviceFilter = deviceId ? `&device_id=eq.${encodeURIComponent(deviceId)}` : '';
  await supabaseRequest(`downloads_usuario?usuario_id=eq.${encodeURIComponent(userId)}&capitulo_id=eq.${encodeURIComponent(chapterId)}${deviceFilter}`, {
    method: 'DELETE'
  });
}

async function listSavedRecords(userId) {
  validateUserId(userId);
  return supabaseRequest(`salvos_usuario?select=usuario_id,manga_id,manga,atualizado_em&usuario_id=eq.${encodeURIComponent(userId)}&order=atualizado_em.desc`);
}

async function saveSavedRecord(userId, payload) {
  validateUserId(userId);
  const mangaId = String(payload.mangaId || '').trim();
  if (!mangaId || mangaId.length > 100 || !payload.manga || typeof payload.manga !== 'object') {
    const error = new Error('Dados do mangá salvo inválidos.');
    error.status = 422;
    throw error;
  }
  const result = await supabaseRequest('salvos_usuario?on_conflict=usuario_id,manga_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      usuario_id: userId,
      manga_id: mangaId,
      manga: payload.manga,
      atualizado_em: new Date().toISOString()
    })
  });
  return result[0] || null;
}

async function removeSavedRecord(userId, mangaId) {
  validateUserId(userId);
  if (!mangaId || mangaId.length > 100) {
    const error = new Error('Mangá inválido.');
    error.status = 422;
    throw error;
  }
  await supabaseRequest(`salvos_usuario?usuario_id=eq.${encodeURIComponent(userId)}&manga_id=eq.${encodeURIComponent(mangaId)}`, {
    method: 'DELETE'
  });
}

async function listProgressRecords(userId) {
  validateUserId(userId);
  return supabaseRequest(`progresso_usuario?select=usuario_id,manga_id,progresso,atualizado_em&usuario_id=eq.${encodeURIComponent(userId)}&order=atualizado_em.desc`);
}

async function saveProgressRecord(userId, payload) {
  validateUserId(userId);
  const mangaId = String(payload.mangaId || '').trim();
  const progress = payload.progress && typeof payload.progress === 'object' ? payload.progress : null;
  if (!mangaId || mangaId.length > 100 || !progress || progress.id !== mangaId) {
    const error = new Error('Dados de progresso inválidos.');
    error.status = 422;
    throw error;
  }
  const result = await supabaseRequest('progresso_usuario?on_conflict=usuario_id,manga_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      usuario_id: userId,
      manga_id: mangaId,
      progresso: progress,
      atualizado_em: new Date().toISOString()
    })
  });
  return result[0] || null;
}

async function removeProgressRecord(userId, mangaId) {
  validateUserId(userId);
  await supabaseRequest(`progresso_usuario?usuario_id=eq.${encodeURIComponent(userId)}&manga_id=eq.${encodeURIComponent(mangaId)}`, {
    method: 'DELETE'
  });
}

async function loginUser(payload) {
  const username = String(payload.username || '').trim().toLowerCase();
  if (!/^[a-zA-Z0-9._-]{3,24}$/.test(username)) {
    const error = new Error('Informe um username válido.');
    error.status = 422;
    throw error;
  }
  const user = await findUser(username);
  if (!user) {
    const error = new Error('Username não encontrado. Crie sua conta primeiro.');
    error.status = 404;
    throw error;
  }
  return { user: publicUser(user), created: false };
}

async function createUser(payload) {
  const input = validateUserInput(payload);
  if (!input.nome) throw new Error('Nome é obrigatório para criar a conta.');
  await validateEmailDomain(input.email);
  if (await findUser(input.username)) {
    const error = new Error('Este username já está em uso.');
    error.status = 409;
    throw error;
  }
  if (await findUserByEmail(input.email)) {
    const error = new Error('Este e-mail já está cadastrado.');
    error.status = 409;
    throw error;
  }
  try {
    const created = await supabaseRequest('usuarios', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(input)
    });
    return { user: publicUser(created[0]), created: true };
  } catch (error) {
    if (error.status === 409 || error.status === 400) {
      if (await findUserByEmail(input.email)) {
        const conflict = new Error('Este e-mail já está cadastrado.');
        conflict.status = 409;
        throw conflict;
      }
      if (await findUser(input.username)) {
        const conflict = new Error('Este username já está em uso.');
        conflict.status = 409;
        throw conflict;
      }
    }
    throw error;
  }
}

async function updateUser(username, payload) {
  const input = validateUserInput({ ...payload, username }, true);
  await validateEmailDomain(input.email);
  const current = await findUser(username);
  if (!current) {
    const error = new Error('Usuário não encontrado.');
    error.status = 404;
    throw error;
  }
  const duplicate = await findUserByEmail(input.email);
  if (duplicate && duplicate.id !== current.id) {
    const error = new Error('Este e-mail já está cadastrado.');
    error.status = 409;
    throw error;
  }
  const updated = await supabaseRequest(`usuarios?username=eq.${encodeURIComponent(username)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ email: input.email, nome: input.nome, foto_url: input.foto_url })
  });
  if (!updated.length) {
    const error = new Error('Usuário não encontrado.');
    error.status = 404;
    throw error;
  }
  return publicUser(updated[0]);
}

function cookieValue(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  const item = cookies.find(value => value.trim().startsWith(`${name}=`));
  return item ? decodeURIComponent(item.trim().slice(name.length + 1)) : '';
}

async function findSocialUser(authUser) {
  const email = String(authUser.email || '').trim().toLowerCase();
  if (!email) throw new Error('O provedor social não retornou um e-mail.');
  const existing = await findUserByEmail(email);
  return existing ? publicUser(existing) : null;
}

async function createSocialUser(authUser, payload) {
  const email = String(authUser.email || '').trim().toLowerCase();
  if (!email) throw new Error('O provedor social não retornou um e-mail.');
  const input = validateUserInput({
    username: payload.username,
    email,
    nome: authUser.user_metadata?.full_name || authUser.user_metadata?.name || payload.username,
    foto_url: authUser.user_metadata?.avatar_url || null
  });
  const existing = await findUserByEmail(email);
  if (existing) return publicUser(existing);
  if (await findUser(input.username)) {
    const error = new Error('Este username já está em uso.');
    error.status = 409;
    throw error;
  }
  const created = await supabaseRequest('usuarios', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      id: authUser.id,
      username: input.username,
      email: input.email,
      nome: input.nome,
      foto_url: input.foto_url
    })
  });
  return publicUser(created[0]);
}

async function supabaseAuthUser(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !accessToken) throw new Error('Sessão social indisponível.');
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error('Não foi possível validar a sessão social.');
  return response.json();
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
      const response = await fetch(target, {
        headers: {
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          Referer: 'https://mangadex.org/',
          'User-Agent': 'MangaKindle/1.0'
        }
      });
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

function normalizeMangaDexChapter(chapter, language) {
  const a = chapter.attributes || {};
  const groupRelation = chapter.relationships?.find(r => r.type === 'scanlation_group');
  const group = groupRelation?.attributes?.name || groupRelation?.id || '';
  return {
    id: chapter.id,
    number: a.chapter || 'Oneshot',
    title: a.title || '',
    pages: Number(a.pages) || 0,
    externalUrl: /^https:\/\//i.test(String(a.externalUrl || '')) ? a.externalUrl : '',
    group,
    language: a.translatedLanguage || language,
    source: 'MangaDex'
  };
}

async function mangaDexChapters(mangaId, language) {
  const out = [];
  for (let offset = 0, total = 1; offset < total;) {
    const query = new URLSearchParams({
      'translatedLanguage[]': language,
      'order[chapter]': 'asc',
      limit: '500',
      offset: String(offset),
      includeExternalUrl: '1',
      'contentRating[]': 'safe'
    });
    query.append('contentRating[]', 'suggestive');
    const data = await json(`${MD_API}/manga/${encodeURIComponent(mangaId)}/feed?${query}`);
    const items = data.data || [];
    total = data.total || 0;
    offset += items.length;
    out.push(...items.map(c => normalizeMangaDexChapter(c, language)));
    if (!items.length) break;
  }
  return out;
}

async function mergedChapters(mangaId, title, language) {
  const primary = await mangaDexChapters(mangaId, language);
  const merged = new Map();
  const keyOf = chapter => {
    const n = chapterNumber(chapter.number);
    return n == null ? String(chapter.number).toLowerCase() : String(n);
  };
  primary.forEach(chapter => merged.set(keyOf(chapter), chapter));
  primary.forEach(chapter => {
    const key = keyOf(chapter), current = merged.get(key);
    if (!current || (chapter.pages > 0 && !chapter.externalUrl && (current.externalUrl || current.pages === 0))) {
      merged.set(key, chapter);
    }
  });
  return [...merged.values()].sort((a, b) => {
    const an = chapterNumber(a.number), bn = chapterNumber(b.number);
    return (an ?? Number.MAX_SAFE_INTEGER) - (bn ?? Number.MAX_SAFE_INTEGER);
  });
}

http.createServer((req, res) => {
  const url = req.url;
  if (req.method === 'POST' && url === '/api/usuarios/login') {
    return body(req).then(loginUser)
      .then(result => jsonResponse(res, 200, result))
      .catch(error => jsonResponse(res, error.status || 400, { error: error.message }));
  }
  if (req.method === 'POST' && url === '/api/usuarios') {
    return body(req).then(createUser)
      .then(result => jsonResponse(res, result.created ? 201 : 200, result))
      .catch(error => jsonResponse(res, error.status || 400, { error: error.message }));
  }
  const userMatch = url.match(/^\/api\/usuarios\/([^/?]+)$/);
  if (userMatch && req.method === 'PATCH') {
    return body(req).then(payload => updateUser(decodeURIComponent(userMatch[1]), payload))
      .then(user => jsonResponse(res, 200, { user }))
      .catch(error => jsonResponse(res, error.status || 400, { error: error.message }));
  }
  const downloadsMatch = new URL(`http://localhost${url}`).pathname.match(/^\/api\/usuarios\/([^/?]+)\/downloads(?:\/([^/?]+))?$/);
  if (downloadsMatch && req.method === 'GET' && !downloadsMatch[2]) {
    return listDownloadRecords(decodeURIComponent(downloadsMatch[1]))
      .then(downloads => jsonResponse(res, 200, { downloads }))
      .catch(error => jsonResponse(res, error.status || 400, { error: error.message }));
  }
  if (downloadsMatch && req.method === 'PUT' && !downloadsMatch[2]) {
    return body(req).then(payload => saveDownloadRecord(decodeURIComponent(downloadsMatch[1]), payload))
      .then(download => jsonResponse(res, 200, { download }))
      .catch(error => jsonResponse(res, error.status || 400, { error: error.message }));
  }
  if (downloadsMatch && req.method === 'DELETE' && downloadsMatch[2]) {
    const deviceId = new URL(`http://localhost${url}`).searchParams.get('deviceId') || '';
    return removeDownloadRecord(decodeURIComponent(downloadsMatch[1]), decodeURIComponent(downloadsMatch[2]), deviceId)
      .then(() => { res.writeHead(204); res.end(); })
      .catch(error => jsonResponse(res, error.status || 400, { error: error.message }));
  }
  const savedMatch = url.match(/^\/api\/usuarios\/([^/?]+)\/salvos(?:\/([^/?]+))?$/);
  if (savedMatch && req.method === 'GET' && !savedMatch[2]) {
    return listSavedRecords(decodeURIComponent(savedMatch[1]))
      .then(saved => jsonResponse(res, 200, { saved }))
      .catch(error => jsonResponse(res, error.status || 400, { error: error.message }));
  }
  if (savedMatch && req.method === 'PUT' && !savedMatch[2]) {
    return body(req).then(payload => saveSavedRecord(decodeURIComponent(savedMatch[1]), payload))
      .then(saved => jsonResponse(res, 200, { saved }))
      .catch(error => jsonResponse(res, error.status || 400, { error: error.message }));
  }
  if (savedMatch && req.method === 'DELETE' && savedMatch[2]) {
    return removeSavedRecord(decodeURIComponent(savedMatch[1]), decodeURIComponent(savedMatch[2]))
      .then(() => { res.writeHead(204); res.end(); })
      .catch(error => jsonResponse(res, error.status || 400, { error: error.message }));
  }
  const progressMatch = url.match(/^\/api\/usuarios\/([^/?]+)\/progresso(?:\/([^/?]+))?$/);
  if (progressMatch && req.method === 'GET' && !progressMatch[2]) {
    return listProgressRecords(decodeURIComponent(progressMatch[1]))
      .then(progress => jsonResponse(res, 200, { progress }))
      .catch(error => jsonResponse(res, error.status || 400, { error: error.message }));
  }
  if (progressMatch && req.method === 'PUT' && !progressMatch[2]) {
    return body(req).then(payload => saveProgressRecord(decodeURIComponent(progressMatch[1]), payload))
      .then(progress => jsonResponse(res, 200, { progress }))
      .catch(error => jsonResponse(res, error.status || 400, { error: error.message }));
  }
  if (progressMatch && req.method === 'DELETE' && progressMatch[2]) {
    return removeProgressRecord(decodeURIComponent(progressMatch[1]), decodeURIComponent(progressMatch[2]))
      .then(() => { res.writeHead(204); res.end(); })
      .catch(error => jsonResponse(res, error.status || 400, { error: error.message }));
  }
  if (req.method === 'GET' && url === '/api/auth/config') {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return jsonResponse(res, 503, { error: 'Supabase não configurado.' });
    return jsonResponse(res, 200, { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
  }
  if (req.method === 'GET' && url === '/api/auth/me') {
    const authorization = String(req.headers.authorization || '');
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : cookieValue(req, 'mk_session');
    return supabaseAuthUser(token).then(findSocialUser)
      .then(user => user
        ? jsonResponse(res, 200, { user })
        : jsonResponse(res, 404, { requiresProfile: true }))
      .catch(error => jsonResponse(res, error.status === 404 ? 404 : 401, { error: error.message }));
  }
  if (req.method === 'POST' && url === '/api/auth/profile') {
    const authorization = String(req.headers.authorization || '');
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : cookieValue(req, 'mk_session');
    return body(req)
      .then(payload => supabaseAuthUser(token).then(authUser => createSocialUser(authUser, payload)))
      .then(user => jsonResponse(res, 201, { user }))
      .catch(error => jsonResponse(res, error.status || 400, { error: error.message }));
  }
  if (req.method === 'POST' && url === '/api/auth/logout') {
    res.writeHead(204, { 'Set-Cookie': 'mk_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' }); return res.end();
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
