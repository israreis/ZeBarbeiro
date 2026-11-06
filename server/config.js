import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const positiveInt = (fallback) => z.coerce.number().int().positive().default(fallback);

/** Variáveis de ambiente aceitas (ver .env.example). */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: positiveInt(3000),
  APP_TIMEZONE: z.string().default('America/Sao_Paulo'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Ative quando a aplicação estiver atrás de um proxy reverso (Nginx, Render, Railway...). */
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),

  SUPABASE_URL: z.string().url('SUPABASE_URL deve ser a URL do projeto (https://xxxx.supabase.co).'),
  SUPABASE_ANON_KEY: z.string().min(20, 'Informe SUPABASE_ANON_KEY (chave anon/publishable).'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'Informe SUPABASE_SERVICE_ROLE_KEY (chave service_role/secret).'),
  SUPABASE_BUCKET_FOTOS: z.string().default('fotos-barbeiros'),

  LOGIN_MAX_ATTEMPTS: positiveInt(5),
  LOGIN_WINDOW_MINUTES: positiveInt(15),
  API_RATE_LIMIT_PER_MINUTE: positiveInt(300),

  /**
   * Por quanto tempo um token já validado é reaproveitado sem consultar o Supabase Auth
   * (nunca além da expiração do próprio token). Logout e trocas de senha limpam na hora.
   */
  AUTH_CACHE_SECONDS: z.coerce.number().int().min(0).max(3600).default(300),
  /** Cache de cadastros, perfis e agenda. Gravações pela API limpam na hora. */
  DATA_CACHE_SECONDS: z.coerce.number().int().min(0).max(3600).default(300),
});

/** Valores fixos e derivados, compartilhados com os testes. */
export const baseConfig = Object.freeze({
  publicDir: path.join(rootDir, 'public'),
  seedFile: path.join(rootDir, 'data', 'seed.json'),
  maxBodyBytes: 64 * 1024,
  maxUploadBytes: 2 * 1024 * 1024,
});

/**
 * Lê e valida a configuração a partir das variáveis de ambiente.
 * Falha cedo, com mensagem clara, se algo obrigatório estiver faltando.
 */
export function loadConfig(env = process.env) {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problemas = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Configuração inválida. Confira o arquivo .env:\n${problemas}`);
  }
  const e = result.data;
  return Object.freeze({
    ...baseConfig,
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    timeZone: e.APP_TIMEZONE,
    logLevel: e.LOG_LEVEL,
    trustProxy: e.TRUST_PROXY,
    supabase: Object.freeze({
      url: e.SUPABASE_URL,
      anonKey: e.SUPABASE_ANON_KEY,
      serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
      bucketFotos: e.SUPABASE_BUCKET_FOTOS,
    }),
    loginRateLimit: Object.freeze({
      maxAttempts: e.LOGIN_MAX_ATTEMPTS,
      windowMs: e.LOGIN_WINDOW_MINUTES * 60 * 1000,
    }),
    apiRateLimitPerMinute: e.API_RATE_LIMIT_PER_MINUTE,
    authCacheMs: e.AUTH_CACHE_SECONDS * 1000,
    dataCacheMs: e.DATA_CACHE_SECONDS * 1000,
  });
}

/** Carrega o arquivo .env da raiz, se existir (nativo do Node, sem dependência extra). */
export function loadEnvFile(file = path.join(rootDir, '.env')) {
  try {
    process.loadEnvFile(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
