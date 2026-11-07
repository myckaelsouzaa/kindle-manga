'use strict';
// Sessão assinada (HMAC-SHA256, sem estado). Prova a identidade do usuário nas rotas protegidas.
const crypto = require('crypto');
const config = require('./config');

const encode = value => Buffer.from(value).toString('base64url');
const mac = payload => crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');

function sign(userId, ttlSeconds = config.SESSION_TTL_SECONDS) {
  const payload = encode(JSON.stringify({ sub: String(userId), exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  return `${payload}.${mac(payload)}`;
}

// Retorna o id do usuário ou null quando o token é inválido, adulterado ou expirado.
function verify(token) {
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(mac(payload)), received = Buffer.from(signature);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
  try {
    const { sub, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof sub === 'string' && Number(exp) > Date.now() / 1000 ? sub : null;
  } catch { return null; }
}

const bearerToken = req => /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')?.[1] || '';

module.exports = { sign, verify, bearerToken };
