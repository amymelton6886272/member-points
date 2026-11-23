/* 仅用于本地预览 web/ 目录（浏览器版），生产环境由 Capacitor 原生壳加载 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, 'web');
const PORT = process.env.PORT ? Number(process.env.PORT) : 5179;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
};

http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    fs.readFile(file, (err, buf) => {
      if (err) return res.writeHead(404).end('Not found');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  })
  .listen(PORT, () => console.log(`web 预览: http://localhost:${PORT}`));
