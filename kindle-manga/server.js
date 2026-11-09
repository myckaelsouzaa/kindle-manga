'use strict';
// Servidor do MangaKindle (Node 18+, sem dependências externas).
// Uso: node server.js  ->  http://localhost:3000
// Serve os estáticos e faz proxy de MangaDex (/md), Jikan (/jk), tradução (/tr) e imagens (/img).
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path'), dns = require('dns').promises, crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname, DOWNLOAD_ROOT = path.join(ROOT, 'downloads');
const MD_API = 'https://api.mangadex.org', COMICK_API = 'https://api.comick.fun/v1.0';
const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY } = process.env;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon'
};
const MANGADEX_HOSTS = ['mangadex.org', 'mangadex.network'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USERNAME = /^.{1,100}$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ID = /^[\w:.-]{1,200}$/;
const LANGUAGE = /^[a-z]{2,3}(-[a-z]{2,4})?$/i;
const PHOTO_URL = /^https?:\/\/\S+$/i, PHOTO_DATA = /^data:image\/(?:jpeg|png|gif|webp);base64,[a-z0-9+/=]+$/i;

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const fail = (status, message, code) => new HttpError(status, message, code);

/* ---------- respostas e cabecalhos de seguranca ---------- */

function securityHeaders(res) {
  let supabaseOrigin = '';
  try { supabaseOrigin = SUPABASE_URL ? new URL(SUPABASE_URL).origin : ''; } catch { /* URL de ambiente inválida */ }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self' https://cdn.jsdelivr.net https://pay.google.com", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:", `connect-src 'self' https://pay.google.com ${supabaseOrigin}`.trim(),
    "frame-src https://pay.google.com", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'"
  ].join('; '));
}

function sendJson(res, status, value, headers = {}) {
  const body = value === undefined ? '' : JSON.stringify(value);
  res.writeHead(status, { ...(body && { 'Content-Type': 'application/json; charset=utf-8' }), ...headers });
  res.end(body);
}

function readJson(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, exceeded = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { exceeded = true; chunks.length = 0; } else if (!exceeded) chunks.push(chunk);
    });
    req.on('end', () => {
      if (exceeded) return reject(fail(413, 'Conteúdo muito grande.'));
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        resolve(value);
      } catch { reject(fail(400, 'JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

// Corpo bruto (necessário para validar a assinatura do webhook de pagamento).
function readRaw(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, exceeded = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { exceeded = true; chunks.length = 0; } else if (!exceeded) chunks.push(chunk);
    });
    req.on('end', () => exceeded ? reject(fail(413, 'Conteúdo muito grande.')) : resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Limite simples por IP para conter abuso dos endpoints de conta e dados.
const hits = new Map();
setInterval(() => hits.clear(), 60_000).unref();
function rateLimited(req, max = 240) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
  const ip = forwarded || req.socket.remoteAddress || 'local';
  const count = (hits.get(ip) || 0) + 1;
  hits.set(ip, count);
  return count > max;
}

/* ---------- Supabase (service role, somente no servidor) ---------- */

async function supabase(table, params = {}, { prefer, ...options } = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw fail(503, 'Serviço temporariamente indisponível.');
  const query = new URLSearchParams(params).toString();
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`, {
      ...options,
      signal: AbortSignal.timeout(15_000),
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json', Accept: 'application/json', ...(prefer && { Prefer: prefer })
      }
    });
  } catch (error) {
    console.error('[MangaKindle] Supabase indisponível:', error.message);
    throw fail(502, 'Não foi possível acessar o banco de dados.');
  }
  const text = await response.text();
  let value = null;
  try { value = text ? JSON.parse(text) : null; } catch { value = { message: text }; }
  if (!response.ok) {
    console.error('[MangaKindle] Supabase HTTP', response.status, value?.message);
    throw fail(response.status === 409 ? 409 : response.status >= 500 ? 502 : 400, 'Operação não concluída no banco de dados.');
  }
  return value;
}

const eq = value => `eq.${value}`;
const upsert = (table, conflict, row) => supabase(table, { on_conflict: conflict }, {
  method: 'POST', prefer: 'resolution=merge-duplicates,return=representation', body: JSON.stringify(row)
}).then(rows => rows?.[0] || null);

/* ---------- usuários ---------- */

const PROFILE_COLUMNS = 'id,nome,username,email,foto_url,criado_em';
const USER_COLUMNS = `${PROFILE_COLUMNS},role,subscription_status,subscription_expires_at,subscription_started_at,payment_customer_id,payment_subscription_id`;
const PASSWORD_MIN_LENGTH = 8;

/* ---------- Premium: sessão, permissões e pagamentos (pasta ./server) ---------- */

const premium = require('./server/index.js').createPremium({ supabase, eq, fail, readJson, readRaw });
const { session, permissions, guards } = premium;
// Nível e assinatura saem sempre calculados pelo servidor; o navegador só os exibe.
const publicUser = user => user && {
  ...Object.fromEntries(PROFILE_COLUMNS.split(',').map(key => [key, user[key]])),
  ...(({ role, subscription_status, subscription_expires_at, renews }) => ({ role, subscription_status, subscription_expires_at, renews }))(permissions.publicSubscription(user))
};
const withSession = user => ({ user: publicUser(user), token: session.sign(user.id) });
const findUserBy = async (column, value) => (await supabase('usuarios', { select: USER_COLUMNS, [column]: eq(value), limit: 1 }))[0] || null;
const findUser = username => findUserBy('username', username);
const findUserByEmail = email => findUserBy('email', email);

function validateUserInput(payload, requireEmail = true) {
  const username = String(payload.username ?? payload.nome ?? payload.name ?? '').trim().slice(0, 100);
  const email = String(payload.email ?? '').trim().toLowerCase();
  const nome = String(payload.nome ?? payload.nome_completo ?? '').trim().slice(0, 100);
  const fotoUrl = String(payload.foto_url ?? '').trim();
  if (!USERNAME.test(username)) throw fail(422, 'Nome deve ter entre 1 e 100 caracteres.');
  if (requireEmail && !email) throw fail(422, 'E-mail é obrigatório.');
  if (email && (email.length > 254 || !EMAIL.test(email))) throw fail(422, 'Informe um e-mail válido.');
  const validPhoto = !fotoUrl || (PHOTO_URL.test(fotoUrl) && fotoUrl.length <= 2048) || (PHOTO_DATA.test(fotoUrl) && fotoUrl.length <= 3 * 1024 * 1024);
  if (!validPhoto) throw fail(422, 'A foto deve ser um link HTTP/HTTPS ou uma imagem valida de até 2 MB.');
  return { username, email, nome: nome || null, foto_url: fotoUrl || null };
}

function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function passwordMatches(password, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return expectedBuffer.length === actual.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

async function assertEmailDomain(email) {
  try {
    if (!(await dns.resolveMx(email.split('@')[1])).length) throw new Error();
  } catch { throw fail(422, 'O domínio do e-mail não existe ou não aceita e-mails.'); }
}

async function loginUser(payload) {
  const email = String(payload.email ?? '').trim().toLowerCase();
  const password = String(payload.password ?? '');
  if (!EMAIL.test(email) || password.length < PASSWORD_MIN_LENGTH) throw fail(422, 'Informe um e-mail e uma senha válidos.');
  const user = (await supabase('usuarios', { select: `${USER_COLUMNS},senha_hash`, email: eq(email), limit: 1 }))[0] || null;
  if (!user || !passwordMatches(password, user.senha_hash)) throw fail(401, 'E-mail ou senha incorretos.');
  return { ...withSession(user), created: false };
}

async function createUser(payload) {
  const input = validateUserInput(payload);
  await assertEmailDomain(input.email);
  const password = String(payload.password ?? '');
  if (password.length < PASSWORD_MIN_LENGTH) throw fail(422, `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  const assertFree = async () => {
    if (await findUserByEmail(input.email)) throw fail(409, 'Este e-mail já está cadastrado.');
  };
  await assertFree();
  try {
    const [created] = await supabase('usuarios', {}, { method: 'POST', prefer: 'return=representation', body: JSON.stringify({ ...input, senha_hash: passwordHash(password) }) });
    return { ...withSession(created), created: true };
  } catch (error) {
    // Corrida entre cadastros: a restrição única do banco decide, e o erro vira mensagem amigavel.
    if (error.status === 409 || error.status === 400) await assertFree();
    throw error;
  }
}

async function updateUser(username, payload, sessionUserId) {
  const current = UUID.test(username) ? (await supabase('usuarios', { select: USER_COLUMNS, id: eq(username), limit: 1 }))[0] : await findUser(username);
  if (!current) throw fail(404, 'Usuário não encontrado.');
  if (String(current.id).toLowerCase() !== String(sessionUserId).toLowerCase()) throw fail(403, 'Você não tem permissão para alterar este perfil.', 'forbidden');
  const input = validateUserInput({ ...payload, username: payload.username ?? current.username }, true);
  if (input.email !== current.email) {
    await assertEmailDomain(input.email);
    const duplicate = await findUserByEmail(input.email);
    if (duplicate && duplicate.id !== current.id) throw fail(409, 'Este e-mail já está cadastrado.');
  }
  const [updated] = await supabase('usuarios', { id: eq(current.id) }, {
    method: 'PATCH', prefer: 'return=representation',
    body: JSON.stringify({ email: input.email, nome: input.nome, foto_url: input.foto_url })
  });
  if (!updated) throw fail(404, 'Usuário não encontrado.');
  return publicUser(updated);
}

/* ---------- login social (token validado no Supabase Auth) ---------- */

const bearerToken = session.bearerToken;

async function authUser(token) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !token) throw fail(401, 'Sessão social indisponível.');
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000)
    });
  } catch { throw fail(502, 'Não foi possível validar a sessão social.'); }
  if (!response.ok) throw fail(401, 'Não foi possível validar a sessão social.');
  const user = await response.json();
  const email = String(user.email ?? '').trim().toLowerCase();
  if (!email) throw fail(422, 'O provedor social não retornou um e-mail.');
  // Impede vincular uma conta a um e-mail que o provedor não verificou.
  if (!user.email_confirmed_at && user.user_metadata?.email_verified !== true) throw fail(403, 'O e-mail da conta social não está verificado.');
  return { ...user, email };
}

async function createSocialUser(user, payload) {
  const meta = user.user_metadata || {};
  const input = validateUserInput({ username: payload.username, email: user.email, nome: meta.full_name || meta.name || payload.username, foto_url: meta.avatar_url });
  const existing = await findUserByEmail(input.email);
  if (existing) return existing;
  const [created] = await supabase('usuarios', {}, { method: 'POST', prefer: 'return=representation', body: JSON.stringify({ id: user.id, ...input }) });
  return created;
}

/* ---------- coleções por usuário: downloads, salvos e progresso ---------- */

const text = (value, max) => String(value ?? '').trim().slice(0, max);
function boundedObject(value, max, message, required = false) {
  if (value == null && !required) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > max) throw fail(422, message);
  return value;
}
const requireId = (value, message, pattern = ID) => {
  if (!pattern.test(value)) throw fail(422, message);
  return value;
};

const COLLECTIONS = {
  downloads: {
    table: 'downloads_usuario', list: 'downloads', item: 'download', idColumn: 'capitulo_id', deviceScoped: true,
    columns: 'usuario_id,capitulo_id,manga_id,manga,numero,titulo,idioma,origem,device_id,atualizado_em',
    conflict: 'usuario_id,capitulo_id,device_id',
    row(userId, p) {
      const message = 'Dados do download inválidos.';
      return {
        usuario_id: userId, capitulo_id: requireId(text(p.chapterId, 200), message), manga_id: requireId(text(p.mangaId, 100), message),
        manga: boundedObject(p.manga, 50_000, message), numero: text(p.num, 40), titulo: text(p.title, 300),
        idioma: text(p.language, 20) || null, origem: text(p.source || 'MangaDex', 30),
        device_id: requireId(text(p.deviceId, 120), message), atualizado_em: new Date().toISOString()
      };
    }
  },
  salvos: {
    table: 'salvos_usuario', list: 'saved', item: 'saved', idColumn: 'manga_id',
    columns: 'usuario_id,manga_id,manga,atualizado_em', conflict: 'usuario_id,manga_id',
    row: (userId, p) => ({
      usuario_id: userId, manga_id: requireId(text(p.mangaId, 100), 'Dados do mangá salvo inválidos.'),
      manga: boundedObject(p.manga, 50_000, 'Dados do mangá salvo inválidos.', true), atualizado_em: new Date().toISOString()
    })
  },
  progresso: {
    table: 'progresso_usuario', list: 'progress', item: 'progress', idColumn: 'manga_id',
    columns: 'usuario_id,manga_id,progresso,atualizado_em', conflict: 'usuario_id,manga_id',
    row(userId, p) {
      const message = 'Dados de progresso inválidos.', mangaId = requireId(text(p.mangaId, 100), message);
      const progress = boundedObject(p.progress, 300_000, message, true);
      if (progress.id !== mangaId) throw fail(422, message);
      return { usuario_id: userId, manga_id: mangaId, progresso: progress, atualizado_em: new Date().toISOString() };
    }
  }
};

async function listRecords(collection, userId) {
  const c = COLLECTIONS[collection];
  requireId(userId, 'Usuário inválido.', UUID);
  if (!(await supabase('usuarios', { select: 'id', id: eq(userId), limit: 1 }))[0]) throw fail(404, 'Usuário não encontrado.');
  return { [c.list]: await supabase(c.table, { select: c.columns, usuario_id: eq(userId), order: 'atualizado_em.desc' }) };
}

async function saveRecord(collection, userId, payload) {
  const c = COLLECTIONS[collection];
  requireId(userId, 'Usuário inválido.', UUID);
  return { [c.item]: await upsert(c.table, c.conflict, c.row(userId, payload)) };
}

async function removeRecord(collection, userId, id, deviceId) {
  const c = COLLECTIONS[collection];
  requireId(userId, 'Usuário inválido.', UUID);
  requireId(id, 'Identificador inválido.');
  const filters = { usuario_id: eq(userId), [c.idColumn]: eq(id) };
  if (c.deviceScoped && deviceId) filters.device_id = eq(requireId(deviceId, 'Dispositivo inválido.'));
  await supabase(c.table, filters, { method: 'DELETE' });
}

/* ---------- capítulos (MangaDex com complemento secundario) ---------- */

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'MangaKindle/1.0' }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const chapterNumber = value => {
  const n = Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function hasChapterGaps(chapters) {
  const nums = [...new Set(chapters.map(c => chapterNumber(c.number)).filter(n => n !== null))].sort((a, b) => a - b);
  if (nums.length < 2) return true;
  const min = nums[0], max = nums.at(-1);
  const expected = Math.floor(max - min) + 1, missing = Math.max(0, expected - nums.length);
  const largestGap = nums.reduce((gap, n, i) => Math.max(gap, i ? Math.floor(n - nums[i - 1]) - 1 : 0), 0);
  return (max >= 20 && missing / expected >= .2) || largestGap >= 10;
}

async function mangaDexChapters(mangaId, language) {
  const page = offset => {
    const query = new URLSearchParams({
      'translatedLanguage[]': language, 'order[chapter]': 'asc', limit: '500', offset: String(offset),
      includeExternalUrl: '0', 'contentRating[]': 'safe'
    });
    query.append('contentRating[]', 'suggestive');
    return fetchJson(`${MD_API}/manga/${encodeURIComponent(mangaId)}/feed?${query}`);
  };
  const toChapters = data => (data.data || []).filter(c => c.attributes?.pages > 0).map(c => ({
      id: c.id, number: c.attributes.chapter || 'Oneshot', title: c.attributes.title || '',
      language: c.attributes.translatedLanguage || language, source: 'MangaDex'
    }));
  // A primeira página informa o total; as demais podem ser buscadas simultaneamente.
  const first = await page(0);
  const offsets = [];
  for (let offset = 500; offset < (first.total || 0); offset += 500) offsets.push(offset);
  return [first, ...await Promise.all(offsets.map(page))].flatMap(toChapters);
}

async function secondaryChapters(title, language) {
  const search = await fetchJson(`${COMICK_API}/search/?q=${encodeURIComponent(title)}&limit=5`);
  const match = (Array.isArray(search) ? search : search.results || search.data || [])[0];
  const hid = match?.hid || match?.slug;
  if (!hid) return [];
  const data = await fetchJson(`${COMICK_API}/manga/${encodeURIComponent(hid)}/chapters?lang=${encodeURIComponent(language)}&limit=1000`);
  return (Array.isArray(data) ? data : data.chapters || data.data || []).flatMap(c => {
    const number = c.chap ?? c.chapter ?? c.number, id = c.hid || c.id;
    return number == null || number === '' || !id ? [] : [{
      id: `secondary:${id}`, number: String(number), title: c.title || '', language: c.lang || language, source: 'Secondary'
    }];
  });
}

async function mergedChapters(mangaId, title, language) {
  const primary = await mangaDexChapters(mangaId, language);
  const secondary = hasChapterGaps(primary)
    ? await Promise.race([secondaryChapters(title, language).catch(() => []), new Promise(resolve => setTimeout(() => resolve([]), 5000))])
    : [];
  const keyOf = c => String(chapterNumber(c.number) ?? String(c.number).toLowerCase());
  const merged = new Map(primary.map(c => [keyOf(c), c]));
  secondary.forEach(c => merged.has(keyOf(c)) || merged.set(keyOf(c), c));
  const order = c => chapterNumber(c.number) ?? Number.MAX_SAFE_INTEGER;
  return [...merged.values()].sort((a, b) => order(a) - order(b));
}

// Lista de capítulos guardada por 10 minutos; pedidos simultâneos compartilham a mesma busca.
const chapterCache = new Map(), chapterPending = new Map();
function cachedChapters(mangaId, title, language) {
  const key = `${mangaId}:${language}`, hit = chapterCache.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
  if (chapterPending.has(key)) return chapterPending.get(key);
  const task = mergedChapters(mangaId, title, language).then(value => {
    chapterCache.set(key, { value, expires: Date.now() + 10 * 60 * 1000 });
    if (chapterCache.size > 300) chapterCache.delete(chapterCache.keys().next().value);
    return value;
  }).finally(() => chapterPending.delete(key));
  chapterPending.set(key, task);
  return task;
}

// Cache em memória das respostas JSON; as páginas MangaDex usam URLs temporárias e não são guardadas.
const API_CACHE_MAX = 500;
const apiCache = new Map(), apiPending = new Map();
const apiTtlSeconds = ({ pathname }) => pathname.includes('/at-home/') ? 0 : /\/(statistics|manga\/tag)/.test(pathname) ? 900 : 300;

function fetchBuffered(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'MangaKindle/1.0', Accept: '*/*' }, timeout: 15_000 }, upstream => {
      const chunks = [];
      let size = 0;
      upstream.on('data', chunk => {
        size += chunk.length;
        if (size > 5 * 1024 * 1024) upstream.destroy(new Error('resposta grande demais')); else chunks.push(chunk);
      });
      upstream.on('end', () => resolve({ status: upstream.statusCode, type: upstream.headers['content-type'] || 'application/json', body: Buffer.concat(chunks) }));
      upstream.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
  });
}

async function cachedProxy(res, url) {
  const key = url.href, hit = apiCache.get(key), fresh = hit && hit.expires > Date.now();
  let entry = fresh ? hit : null;
  if (!entry) {
    let pending = apiPending.get(key);
    if (!pending) {
      pending = fetchBuffered(url).finally(() => apiPending.delete(key));
      apiPending.set(key, pending);
    }
    try { entry = await pending; } catch {
      entry = hit || null; // entrega a última resposta disponível se o serviço externo falhar
      if (!entry) return sendJson(res, 502, { error: 'Serviço externo indisponível.' });
    }
    const ttl = apiTtlSeconds(url);
    if (entry !== hit && entry.status === 200 && ttl > 0) {
      apiCache.set(key, { ...entry, expires: Date.now() + ttl * 1000 });
      if (apiCache.size > API_CACHE_MAX) apiCache.delete(apiCache.keys().next().value);
    }
  }
  res.writeHead(entry.status, { 'Content-Type': entry.type, 'Cache-Control': `public, max-age=${apiTtlSeconds(url) || 0}` });
  res.end(entry.body);
}

function proxy(res, target, hosts, { cache = 600, imagesOnly = false } = {}) {
  let url;
  try { url = new URL(target); } catch { throw fail(400, 'Endereço inválido.'); }
  if (url.protocol !== 'https:' || !hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw fail(403, 'Host não permitido.');
  if (!imagesOnly) {
    cachedProxy(res, url).catch(() => res.headersSent ? res.end() : sendJson(res, 502, { error: 'Serviço externo indisponível.' }));
    return;
  }
  const request = https.get(url, { headers: { 'User-Agent': 'MangaKindle/1.0', Accept: '*/*' }, timeout: 15_000 }, upstream => {
    const type = upstream.headers['content-type'] || 'application/octet-stream';
    if (!type.startsWith('image/')) {
      upstream.resume();
      return sendJson(res, 502, { error: 'Resposta inválida do servidor de imagens.' });
    }
    res.writeHead(upstream.statusCode, { 'Content-Type': type, 'Cache-Control': `public, max-age=${cache}` });
    upstream.pipe(res);
  });
  request.on('timeout', () => request.destroy(new Error('timeout')));
  request.on('error', () => res.headersSent ? res.end() : sendJson(res, 502, { error: 'Serviço externo indisponível.' }));
}

/* ---------- rotas ---------- */

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });
const COLLECTION_PATH = '(downloads|salvos|progresso)';

route('POST', /^\/api\/usuarios\/login$/, async ({ req }) => [200, await loginUser(await readJson(req))]);
route('POST', /^\/api\/usuarios$/, async ({ req }) => [201, await createUser(await readJson(req))]);
route('PATCH', /^\/api\/usuarios\/([^/]+)$/, async ({ req, params: [username] }) => [200, { user: await updateUser(username, await readJson(req), guards.authenticate(req)) }]);

// Controle de acesso: todas as coleções exigem sessão do próprio dono; salvar e baixar exigem Premium ou Admin.
const FEATURE_BY_COLLECTION = { salvos: 'save', downloads: 'download' };
const premiumFeature = ({ params: [, name] }) => FEATURE_BY_COLLECTION[name];
route('GET', new RegExp(`^/api/usuarios/([^/]+)/${COLLECTION_PATH}$`), guards.owner(null)(async ({ params: [userId, name] }) => [200, await listRecords(name, userId)]));
route('PUT', new RegExp(`^/api/usuarios/([^/]+)/${COLLECTION_PATH}$`), guards.owner(premiumFeature)(async ({ req, params: [userId, name] }) => [200, await saveRecord(name, userId, await readJson(req))]));
// Remover continua liberado: quem perdeu o Premium ainda pode apagar o que já guardou.
route('DELETE', new RegExp(`^/api/usuarios/([^/]+)/${COLLECTION_PATH}/([^/]+)$`), guards.owner(null)(async ({ query, params: [userId, name, id] }) => {
  await removeRecord(name, userId, id, query.get('deviceId') || '');
  return [204];
}));

/* ---------- assinatura Premium ---------- */

const { controller: pay } = premium;
route('GET', /^\/api\/premium\/config$/, pay.publicConfig);
route('GET', /^\/api\/premium\/status$/, guards.authenticated(pay.status));
route('POST', /^\/api\/premium\/checkout\/card$/, guards.authenticated(pay.checkoutCard));
route('POST', /^\/api\/premium\/checkout\/pix$/, guards.authenticated(pay.checkoutPix));
route('POST', /^\/api\/premium\/checkout\/google-pay$/, guards.authenticated(pay.googlePay));
route('POST', /^\/api\/premium\/portal$/, guards.authenticated(pay.portal));
route('POST', /^\/webhooks\/stripe$/, pay.webhook); // fora de /api: sem limite por IP; a assinatura autentica a chamada

route('GET', /^\/api\/auth\/config$/, () => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw fail(503, 'Supabase não configurado.');
  return [200, { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }];
});
route('GET', /^\/api\/auth\/me$/, async ({ req }) => {
  const existing = await findUserByEmail((await authUser(bearerToken(req))).email);
  return existing ? [200, withSession(existing)] : [404, { requiresProfile: true }];
});
route('POST', /^\/api\/auth\/profile$/, async ({ req }) => {
  const user = await authUser(bearerToken(req));
  return [201, withSession(await createSocialUser(user, await readJson(req)))];
});
route('POST', /^\/api\/auth\/logout$/, () => [204]);

route('GET', /^\/chapters$/, async ({ query, res }) => {
  const mangaId = query.get('mangaId') || '', title = text(query.get('title'), 200), language = query.get('language') || 'pt-br';
  if (!UUID.test(mangaId) && !/^[\w-]{8,64}$/.test(mangaId)) throw fail(400, 'mangaId inválido.');
  if (!title || !LANGUAGE.test(language)) throw fail(400, 'title e language são obrigatórios e devem ser válidos.');
  try {
    sendJson(res, 200, { chapters: await cachedChapters(mangaId, title, language) }, { 'Cache-Control': 'public, max-age=300' });
  } catch (error) {
    console.error('[MangaKindle] capítulos:', error.message);
    throw fail(502, 'Não foi possível carregar os capítulos.');
  }
});

// Downloads legados em disco: mantidos apenas para leitura e remoção de capítulos já baixados.
route('DELETE', /^\/downloads\/([\w-]+)$/, async ({ params: [folder] }) => {
  await fs.promises.rm(path.join(DOWNLOAD_ROOT, folder), { recursive: true, force: true }).catch(() => { throw fail(500, 'Não foi possível remover o download.'); });
  return [204];
});
route('GET', /^\/downloads\/([\w-]+)\/(\d+\.jpg)$/, async ({ res, params: [folder, file] }) => {
  const data = await fs.promises.readFile(path.join(DOWNLOAD_ROOT, folder, file)).catch(() => null);
  if (!data) throw fail(404, 'Não encontrado.');
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' });
  res.end(data);
});

const upstreamRoute = (prefix, base, hosts, options) => route('GET', new RegExp(`^${prefix}(/.*)?$`), ({ req, res }) => {
  proxy(res, base + req.url.slice(prefix.length).replace(/^\/+/, ''), hosts, options);
});
upstreamRoute('/md', `${MD_API}/`, ['api.mangadex.org']);
upstreamRoute('/jk', 'https://api.jikan.moe/v4/', ['api.jikan.moe']);
route('GET', /^\/tr$/, ({ req, res }) => proxy(res, `https://api.mymemory.translated.net/get${new URL(req.url, 'http://localhost').search}`, ['api.mymemory.translated.net'], { cache: 3600 }));
route('GET', /^\/img$/, ({ query, res }) => proxy(res, query.get('u') || '', MANGADEX_HOSTS, { imagesOnly: true, cache: 86400 }));

/* ---------- arquivos estáticos (rotas desconhecidas caem no index.html) ---------- */

function serveStatic(req, res, pathname) {
  let requested = '/index.html';
  try { if (pathname !== '/') requested = decodeURIComponent(pathname); } catch { throw fail(400, 'Endereço inválido.'); }
  const file = path.join(ROOT, path.normalize(requested));
  const relative = path.relative(ROOT, file);
  const allowed = !requested.includes('\0') && relative && !relative.startsWith('..') && !path.isAbsolute(relative) &&
    MIME[path.extname(file).toLowerCase()] && !/(^|[\\/])(\.|node_modules|downloads|server)/.test(relative) && relative !== 'server.js';
  const target = allowed ? file : path.join(ROOT, 'index.html');
  fs.readFile(target, (error, data) => {
    if (error) return sendJson(res, 404, { error: 'Não encontrado.' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target).toLowerCase()] });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

async function handle(req, res) {
  securityHeaders(res);
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { throw fail(400, 'Endereço inválido.'); }
  for (const { method, pattern, handler } of routes) {
    const match = method === req.method && pattern.exec(url.pathname);
    if (!match) continue;
    if (url.pathname.startsWith('/api/') && rateLimited(req)) throw fail(429, 'Muitas requisições. Tente novamente em instantes.');
    let params;
    try { params = match.slice(1).map(value => value && decodeURIComponent(value)); } catch { throw fail(400, 'Endereço inválido.'); }
    const result = await handler({ req, res, params, query: url.searchParams });
    if (result) sendJson(res, ...result);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') throw fail(405, 'Método não permitido.');
  serveStatic(req, res, url.pathname);
}

process.on('unhandledRejection', error => console.error('[MangaKindle] erro não tratado:', error));

http.createServer((req, res) => {
  handle(req, res).catch(error => {
    const known = error instanceof HttpError;
    if (!known) console.error('[MangaKindle] erro interno:', error);
    if (res.headersSent) return res.end();
    sendJson(res, known ? error.status : 500, { error: known ? error.message : 'Erro interno do servidor.', ...(known && error.code && { code: error.code }) });
  });
}).listen(PORT, () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) console.warn('[MangaKindle] Defina SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e SUPABASE_ANON_KEY para habilitar contas.');
  if (premium.config.ephemeralSecret) console.warn('[MangaKindle] Defina SESSION_SECRET (32+ caracteres) ou configure SUPABASE_SERVICE_ROLE_KEY para preservar sessões entre reinícios.');
  if (!premium.config.adminEmails.size) console.warn('[MangaKindle] ADMIN_EMAILS vazio: o administrador depende apenas da coluna role no banco.');
  if (!process.env.STRIPE_SECRET_KEY) console.warn('[MangaKindle] STRIPE_SECRET_KEY ausente: checkout Premium desativado.');
  console.log(`MangaKindle rodando em http://localhost:${PORT}`);
});
