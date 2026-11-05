import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readInt(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Configuração centralizada da aplicação.
 * Todos os valores podem ser sobrescritos por variáveis de ambiente.
 */
export const config = Object.freeze({
  host: process.env.HOST || '127.0.0.1',
  port: readInt('PORT', 3000),
  timeZone: process.env.APP_TIMEZONE || 'America/Sao_Paulo',

  publicDir: path.join(rootDir, 'public'),
  dataFile: process.env.DATA_FILE || path.join(rootDir, 'data', 'db.json'),
  seedFile: path.join(rootDir, 'data', 'seed.json'),

  sessionTtlMs: readInt('SESSION_TTL_MINUTES', 8 * 60) * 60 * 1000,
  maxBodyBytes: 64 * 1024,

  loginRateLimit: Object.freeze({
    maxAttempts: readInt('LOGIN_MAX_ATTEMPTS', 5),
    windowMs: readInt('LOGIN_WINDOW_MINUTES', 15) * 60 * 1000,
  }),
});
