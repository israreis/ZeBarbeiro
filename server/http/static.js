import fs from 'node:fs/promises';
import path from 'node:path';

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
});

/** Imagens mudam raramente; HTML, CSS e JS precisam refletir cada atualização do código. */
const LONG_CACHE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.ico', '.webp']);

/**
 * Serve arquivos estáticos de `rootDir`, bloqueando path traversal
 * e arquivos ocultos. Retorna `false` quando o arquivo não existe.
 *
 * HTML, CSS e JS usam `no-cache` + ETag: o navegador guarda o arquivo, mas
 * confirma com o servidor a cada acesso (resposta 304 quando nada mudou).
 * Assim uma atualização nunca mistura HTML novo com CSS/JS antigos.
 */
export async function serveStatic(req, res, pathname, rootDir) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (decoded.includes('\0')) return false;

  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const filePath = path.resolve(rootDir, relative);
  if (!filePath.startsWith(rootDir + path.sep)) return false;
  if (relative.split('/').some((segment) => segment.startsWith('.'))) return false;

  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension];
  if (!contentType) return false;

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': LONG_CACHE_EXTENSIONS.has(extension) ? 'public, max-age=86400' : 'no-cache',
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
  };

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }

  let content;
  try {
    content = await fs.readFile(filePath);
  } catch {
    return false;
  }
  res.writeHead(200, { ...headers, 'Content-Length': content.length });
  res.end(req.method === 'HEAD' ? undefined : content);
  return true;
}
