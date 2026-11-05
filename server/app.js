import http from 'node:http';
import { SessionStore } from './auth/sessions.js';
import { RateLimiter } from './auth/rate-limiter.js';
import { HttpError, notFound } from './http/errors.js';
import { readJsonBody } from './http/body.js';
import { applySecurityHeaders, sendJson, sendNoContent } from './http/response.js';
import { serveStatic } from './http/static.js';
import { buildRouter } from './routes.js';
import { nowInTimeZone } from './domain/time.js';
import { createAuthService } from './services/auth-service.js';
import { createBarbeirosService } from './services/barbeiros-service.js';
import { createServicosService } from './services/servicos-service.js';
import { createUnidadesService } from './services/unidades-service.js';
import { createAgendamentosService } from './services/agendamentos-service.js';

/**
 * Monta a aplicação (sem iniciar a escuta), permitindo uso em testes.
 * @param {object} options
 * @param {import('./db/store.js').JsonStore} options.store
 * @param {object} options.config
 * @param {() => {date: string, time: string}} [options.clock] relógio injetável
 */
export function createApp({ store, config, clock, logger = console }) {
  const sessions = new SessionStore({ ttlMs: config.sessionTtlMs });
  const loginLimiter = new RateLimiter(config.loginRateLimit);
  const now = clock ?? (() => nowInTimeZone(config.timeZone));

  const services = {
    auth: createAuthService({ store, sessions, loginLimiter }),
    barbeiros: createBarbeirosService({ store, sessions }),
    servicos: createServicosService({ store }),
    unidades: createUnidadesService({ store }),
    agendamentos: createAgendamentosService({ store, clock: now }),
  };
  const router = buildRouter({ sessions, store, services });

  async function handleApi(req, res, url) {
    const match = router.match(req.method, url.pathname);
    if (!match) throw notFound('Rota não encontrada.');
    if (match.methodNotAllowed) throw new HttpError(405, 'Método não permitido.');

    const authorization = req.headers.authorization ?? '';
    const ctx = {
      req,
      params: match.params,
      query: Object.fromEntries(url.searchParams),
      body: await readJsonBody(req, config.maxBodyBytes),
      ip: req.socket.remoteAddress ?? 'desconhecido',
      token: authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : null,
      status: 200,
      user: null,
    };

    let result;
    for (const handler of match.handlers) {
      result = await handler(ctx);
    }
    if (ctx.status === 204) sendNoContent(res);
    else sendJson(res, ctx.status, result ?? null);
  }

  async function handle(req, res) {
    applySecurityHeaders(res);
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method) || !(await serveStatic(req, res, url.pathname, config.publicDir))) {
        sendJson(res, 404, { erro: 'Página não encontrada.' });
      }
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { erro: error.message, detalhes: error.details });
        return;
      }
      logger.error('[erro inesperado]', error);
      sendJson(res, 500, { erro: 'Erro interno do servidor.' });
    }
  }

  return { server: http.createServer(handle), sessions };
}
