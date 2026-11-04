// Servidor local do MangaKindle — sem dependências (Node 18+)
// Uso: node server.js  →  abra http://localhost:3000
// Serve os arquivos estáticos e faz proxy de: MangaDex (/md), Jikan (/jk), tradução (/tr), imagens (/img) e bandeiras (/flag)
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path');
const PORT = 3000, ROOT = __dirname;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function proxy(target, res, cache = 600) {
  const u = new URL(target);
  https.get({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, headers: { 'User-Agent': 'MangaKindle/1.0', Accept: '*/*' } }, r => {
    res.writeHead(r.statusCode, { 'Content-Type': r.headers['content-type'] || 'application/octet-stream', 'Cache-Control': `public, max-age=${cache}` });
    r.pipe(res);
  }).on('error', e => { res.writeHead(502); res.end('Erro no proxy: ' + e.message); });
}

http.createServer((req, res) => {
  const url = req.url;
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
