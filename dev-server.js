import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import proxyHandler from './api/proxy.js';

const PORT = 8420;
const ROOT = process.cwd();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.yml': 'text/yaml',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
};

// Shim a Vercel-style req/res onto plain Node objects so api/proxy.js runs as-is.
function shimRes(res) {
  return {
    _status: 200,
    _headers: {},
    _body: null,
    setHeader(k, v) { this._headers[k] = v; },
    writeHead(status, headers) { this._status = status; if (headers) this._headers = { ...this._headers, ...headers }; },
    status(code) { this._status = code; return this; },
    json(obj) { this._body = JSON.stringify(obj); },
    send(body) { this._body = body; },
    end() {},
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname.startsWith('/api/proxy')) {
    const query = Object.fromEntries(url.searchParams);
    const shim = shimRes(res);
    await proxyHandler({ method: req.method, query }, shim);
    res.writeHead(shim._status, shim._headers);
    res.end(shim._body ?? '');
    return;
  }

  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = normalize(join(ROOT, decodeURIComponent(pathname)));
  if (!file.startsWith(ROOT + sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Explorer + /api/proxy on http://127.0.0.1:${PORT}`);
});