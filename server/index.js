import pino from 'pino';
import { loadConfig, loadEnvFile } from './config.js';
import { buildApp } from './app.js';
import { withCache } from './infra/cached-repositories.js';
import { createSupabaseClients } from './infra/supabase/client.js';
import { createSupabaseRepositories } from './infra/supabase/repositories.js';
import { createSupabaseIdentity } from './infra/supabase/identity.js';
import { createSupabasePhotoStorage } from './infra/supabase/photo-storage.js';

loadEnvFile();
const config = loadConfig();

const logger = pino({
  level: config.logLevel,
  // Nunca registrar tokens ou senhas nos logs.
  redact: ['req.headers.authorization'],
});

const clients = createSupabaseClients(config.supabase, { logger });
const repos = withCache(createSupabaseRepositories(clients.admin), { ttlMs: config.dataCacheMs });

const app = await buildApp({
  config,
  loggerInstance: logger,
  repos,
  identity: createSupabaseIdentity(clients),
  photos: createSupabasePhotoStorage({ admin: clients.admin, bucket: config.supabase.bucketFotos, logger }),
});

try {
  await app.listen({ host: config.host, port: config.port });
  // Abre a conexão com o Supabase e já preenche o cache antes do primeiro acesso.
  Promise.all([repos.servicos.list(), repos.barbeiros.list()])
    .catch((error) => app.log.warn(`Não foi possível pré-carregar dados do Supabase: ${error.message}`));
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

async function shutdown(signal) {
  app.log.info(`${signal} recebido, encerrando...`);
  await app.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
