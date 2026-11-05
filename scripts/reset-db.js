import fs from 'node:fs/promises';
import { config } from '../server/config.js';

/** Restaura o banco local (data/db.json) a partir dos dados de exemplo (data/seed.json). */
await fs.copyFile(config.seedFile, config.dataFile);
console.log(`Banco restaurado a partir de ${config.seedFile}`);
