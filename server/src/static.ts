import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Serves the built game page (client/dist) so a deployed server is one address for everything:
 * players open it in a browser and the page connects back to the same address for online play.
 */

const DIST = resolve(process.env.CLIENT_DIST ?? join(fileURLToPath(new URL('.', import.meta.url)), '../../client/dist'));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
};

export async function serveGamePage(url: string, res: ServerResponse): Promise<void> {
  const path = decodeURIComponent(url.split('?')[0]);
  // Stay inside the build folder whatever the URL says.
  const file = normalize(join(DIST, path === '/' ? 'index.html' : path));
  if (!file.startsWith(DIST + sep) && file !== DIST) {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(file);
    // Vite gives built assets content-hashed names, so they can be cached for a long time.
    const cache = file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': cache });
    res.end(body);
  } catch {
    // Unknown paths (e.g. /?room=CODE handled client-side) get the game page; missing build → 404.
    try {
      const index = await readFile(join(DIST, 'index.html'));
      res.writeHead(extname(path) ? 404 : 200, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' });
      res.end(extname(path) ? 'Not found' : index);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Game page not built. Run: npm run build');
    }
  }
}
