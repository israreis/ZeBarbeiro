import { loadConfig, loadEnvFile } from './config.js';
import { buildApp } from './app.js';
import { createSupabaseClients } from './infra/supabase/client.js';
import { createSupabaseRepositories } from './infra/supabase/repositories.js';
import { createSupabaseIdentity } from './infra/supabase/identity.js';
import { createSupabasePhotoStorage } from './infra/supabase/photo-storage.js';

loadEnvFile();
const config = loadConfig();

const clients = createSupabaseClients(config.supabase);
const logger = {
  level: config.logLevel,
  // Nunca registrar tokens ou senhas nos logs.
  redact: ['req.headers.authorization'],
};

const app = await buildApp({
  config,
  logger,
  repos: createSupabaseRepositories(clients.admin),
  identity: createSupabaseIdentity(clients),
  photos: createSupabasePhotoStorage({ admin: clients.admin, bucket: config.supabase.bucketFotos }),
});

try {
  await app.listen({ host: config.host, port: config.port });
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
