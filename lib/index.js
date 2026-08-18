/**
 * dsh-pixel-pet — node/host half.
 *
 * Serves the 30 state GIFs (6 tiers × 5 states) from
 * `/plugins/dsh-pixel-pet/gifs/…`. The browser half addresses them as
 * `/plugins/dsh-pixel-pet/gifs/{01-06}_{idle,rest,work,done,wait}.gif`.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GIF_DIR = join(PACKAGE_ROOT, 'assets', 'gifs');
const GIF_PREFIX = '/plugins/dsh-pixel-pet/gifs';
const GIF_RE = /^(\d{2})_(idle|rest|work|done|wait)\.gif$/;

/** Decode a request pathname; null on malformed percent-encoding (never throw). */
function decodePathname(url) {
  try {
    return decodeURIComponent(new URL(url ?? '/', 'http://x').pathname);
  } catch {
    return null;
  }
}

export const inject = ['webServer'];

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: GIF_PREFIX,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405);
        res.end();
        return;
      }
      const pathname = decodePathname(req.url);
      if (pathname === null) {
        res.writeHead(400);
        res.end();
        return;
      }
      if (!pathname.startsWith(`${GIF_PREFIX}/`)) {
        res.writeHead(404);
        res.end();
        return;
      }
      const rel = pathname.slice(GIF_PREFIX.length + 1);
      if (!GIF_RE.test(rel)) {
        res.writeHead(404);
        res.end();
        return;
      }
      const file = resolve(join(GIF_DIR, rel));
      if (file !== GIF_DIR && !file.startsWith(GIF_DIR + sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        const body = await readFile(file);
        res.writeHead(200, {
          'content-type': 'image/gif',
          'cache-control': 'public, max-age=3600',
          'x-content-type-options': 'nosniff',
        });
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch {
        res.writeHead(404);
        res.end();
      }
    },
  }), 'dsh-pixel-pet: state gif images');
}
