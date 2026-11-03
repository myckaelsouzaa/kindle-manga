// MangaKindle — servidor Node.js sem dependências externas
// Local: http://localhost:3000
// Render: utiliza automaticamente a variável PORT fornecida pela plataforma.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const HTML = path.join(__dirname, 'kindle-manga-reader.html');

function proxy(target, res) {
  let u;

  try {
    u = new URL(target);
    if (u.protocol !== 'https:') throw new Error('Protocolo não permitido');
  } catch {
    res.writeHead(400);
    return res.end('URL inválida');
  }

  https.get({
    hostname: u.hostname,
    port: u.port || 443,
    path: u.pathname + u.search,
    headers: {
      'User-Agent': 'MangaKindle/1.0',
      Accept: '*/*'
    }
  }, r => {
    res.writeHead(r.statusCode || 502, {
      'Content-Type': r.headers['content-type'] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=600'
    });
    r.pipe(res);
  }).on('error', e => {
    if (!res.headersSent) res.writeHead(502);
    res.end('Erro no proxy: ' + e.message);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';

  if (url.startsWith('/md/')) {
    return proxy('https://api.mangadex.org/' + url.slice(4), res);
  }

  if (url.startsWith('/jk/')) {
    return proxy('https://api.jikan.moe/v4/' + url.slice(4), res);
  }

  if (url.startsWith('/img?u=')) {
    try {
      const target = decodeURIComponent(url.slice(7));
      const hostname = new URL(target).hostname;
      if (/(^|\\.)mangadex\\.(org|network)$/.test(hostname)) {
        return proxy(target, res);
      }
    } catch {}

    res.writeHead(403);
    return res.end('Host não permitido');
  }

  fs.readFile(HTML, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('kindle-manga-reader.html não encontrado ao lado do server.js');
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`MangaKindle rodando na porta ${PORT}`);
});
