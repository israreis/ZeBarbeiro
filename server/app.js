import Fastify from 'fastify';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { RateLimiter } from './auth/rate-limiter.js';
import { SessionCache } from './auth/session-cache.js';
import { HttpError } from './http/errors.js';
import { nowInTimeZone } from './domain/time.js';
import { IMAGE_CONTENT_TYPES } from './infra/image-type.js';
import { apiRoutes } from './routes.js';
import { createAuthService } from './services/auth-service.js';
import { createBarbeirosService } from './services/barbeiros-service.js';
import { createServicosService } from './services/servicos-service.js';
import { createAgendamentosService } from './services/agendamentos-service.js';
import { createRelatoriosService } from './services/relatorios-service.js';

/** Mensagens para erros gerados pelo próprio Fastify (corpo inválido, grande demais...). */
const FRAMEWORK_ERRORS = Object.freeze({
  FST_ERR_CTP_INVALID_JSON_BODY: 'O corpo da requisição não é um JSON válido.',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'O corpo da requisição está vazio.',
  FST_ERR_CTP_BODY_TOO_LARGE: 'O conteúdo enviado é muito grande. Para fotos, o limite é 2 MB.',
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'Tipo de conteúdo não suportado.',
});

/**
 * Content-Security-Policy: só scripts/estilos locais e o Bootstrap via jsDelivr (com SRI
 * nas páginas). Imagens também podem vir do Storage do Supabase (fotos dos barbeiros).
 */
function cspDirectives(storageOrigin) {
  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
    scriptSrcAttr: ["'none'"],
    styleSrc: ["'self'", 'https://cdn.jsdelivr.net'],
    imgSrc: ["'self'", 'data:', 'blob:', ...(storageOrigin ? [storageOrigin] : [])],
    fontSrc: ["'self'", 'https://cdn.jsdelivr.net'],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  };
}

/**
 * Monta a aplicação Fastify (sem iniciar a escuta), o que permite testes com `app.inject`.
 * As dependências externas entram por parâmetro (portas e adaptadores):
 * em produção são as implementações do Supabase; nos testes, versões em memória.
 *
 * @param {object} deps
 * @param {object} deps.repos repositórios (perfis, servicos, barbeiros, agendamentos)
 * @param {object} deps.identity login, senhas e sessões (Supabase Auth)
 * @param {object} deps.photos armazenamento de fotos (Supabase Storage)
 * @param {object} deps.config ver server/config.js
 * @param {() => {date: string, time: string}} [deps.clock] relógio injetável (testes)
 * @param {object|boolean} [deps.logger] configuração do logger (pino) do Fastify
 * @param {object} [deps.loggerInstance] instância pronta do pino (compartilhada com outros módulos)
 */
export async function buildApp({
  repos, identity, photos, config, clock, logger = false, loggerInstance,
}) {
  const app = Fastify({
    ...(loggerInstance ? { loggerInstance } : { logger }),
    bodyLimit: config.maxBodyBytes,
    trustProxy: config.trustProxy ?? false,
  });

  const now = clock ?? (() => nowInTimeZone(config.timeZone));
  const sessionCache = new SessionCache({ ttlMs: config.authCacheMs ?? 0 });
  const services = {
    auth: createAuthService({
      repos, identity, sessionCache, loginLimiter: new RateLimiter(config.loginRateLimit), clock: now,
    }),
    barbeiros: createBarbeirosService({
      repos, identity, photos, sessionCache, clock: now,
    }),
    servicos: createServicosService({ repos }),
    agendamentos: createAgendamentosService({ repos, photos, clock: now }),
    relatorios: createRelatoriosService({ repos, clock: now }),
  };

  // ---- Segurança ----
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: cspDirectives(config.supabase?.url ? new URL(config.supabase.url).origin : null),
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'same-origin' },
    xFrameOptions: { action: 'deny' },
    // HSTS só faz sentido atrás de HTTPS (em produção, com proxy reverso).
    strictTransportSecurity: config.env === 'production',
  });
  app.addHook('onSend', async (request, reply) => {
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (request.url.startsWith('/api/') && !reply.hasHeader('Cache-Control')) {
      reply.header('Cache-Control', 'no-store');
    }
  });

  // Limite geral por IP (o login tem um limitador próprio, por IP + e-mail, que conta só falhas).
  await app.register(fastifyRateLimit, {
    max: config.apiRateLimitPerMinute ?? 300,
    timeWindow: '1 minute',
    allowList: (request) => !request.url.startsWith('/api/'),
    errorResponseBuilder: () => new HttpError(429, 'Muitas requisições em pouco tempo. Aguarde um instante.'),
  });

  // Fotos chegam como binário (image/jpeg, image/png, image/webp), com limite próprio.
  app.addContentTypeParser(
    IMAGE_CONTENT_TYPES,
    { parseAs: 'buffer', bodyLimit: config.maxUploadBytes },
    (request, body, done) => done(null, body),
  );

  // ---- Erros ----
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.status).send({ erro: error.message, detalhes: error.details });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ erro: FRAMEWORK_ERRORS[error.code] ?? 'Requisição inválida.' });
    }
    request.log.error(error);
    return reply.code(500).send({ erro: 'Erro interno do servidor.' });
  });

  app.setNotFoundHandler((request, reply) => {
    const erro = request.url.startsWith('/api/') ? 'Rota não encontrada.' : 'Página não encontrada.';
    reply.code(404).send({ erro });
  });

  // ---- Rotas ----
  await app.register(apiRoutes, { prefix: '/api', services });

  // Arquivos públicos: revalidados a cada acesso (ETag), para nunca usar CSS/JS antigo.
  await app.register(fastifyStatic, {
    root: config.publicDir,
    index: 'index.html',
    dotfiles: 'deny',
    etag: true,
    lastModified: true,
    cacheControl: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  });

  return app;
}
