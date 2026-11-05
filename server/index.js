import { config } from './config.js';
import { JsonStore } from './db/store.js';
import { createApp } from './app.js';

const store = await JsonStore.open(config.dataFile, config.seedFile);
const { server } = createApp({ store, config });

server.listen(config.port, config.host, () => {
  console.log(`BarberApp disponível em http://${config.host}:${config.port}`);
});

function shutdown(signal) {
  console.log(`${signal} recebido, encerrando...`);
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
