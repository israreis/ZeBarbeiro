/**
 * Cabeçalhos de segurança aplicados a todas as respostas.
 * A CSP permite apenas scripts/estilos locais e o Bootstrap via jsDelivr (com SRI nas páginas).
 */
const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' https://cdn.jsdelivr.net",
    "style-src 'self' https://cdn.jsdelivr.net",
    "img-src 'self' data: blob:",
    "font-src 'self' https://cdn.jsdelivr.net",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
});

export function applySecurityHeaders(res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
}

export function sendJson(res, status, payload) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function sendNoContent(res) {
  res.writeHead(204, { 'Cache-Control': 'no-store' });
  res.end();
}
