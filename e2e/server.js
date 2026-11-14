import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ALLOWED_ROOTS = [resolve(REPO_ROOT, 'e2e'), resolve(REPO_ROOT, 'src')];
const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendNotFound(response) {
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found');
}

export function startServer() {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');

    if (url.pathname === '/') {
      response.writeHead(302, { Location: '/e2e/fixture.html' });
      response.end();
      return;
    }

    const file = resolve(REPO_ROOT, `.${url.pathname}`);
    const allowed = ALLOWED_ROOTS.some(
      root => file === root || file.startsWith(root + sep),
    );
    if (!allowed) {
      sendNotFound(response);
      return;
    }

    try {
      const body = await readFile(file);
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type':
          CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(body);
    } catch {
      sendNotFound(response);
    }
  });

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolvePromise({ server, port: server.address().port });
    });
  });
}
