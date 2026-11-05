import fs from 'node:fs/promises';
import path from 'node:path';

const COLLECTIONS = ['usuarios', 'barbeiros', 'servicos', 'unidades', 'agendamentos'];

/**
 * Persistência em arquivo JSON.
 *
 * - Leituras usam o estado em memória (`snapshot`), que é imutável.
 * - Escritas passam por `update`, que serializa as transações (evitando
 *   condições de corrida como dois clientes reservando o mesmo horário),
 *   aplica a alteração numa cópia e grava de forma atômica (arquivo temporário
 *   + rename). Se a gravação falhar, o estado em memória não é alterado.
 */
export class JsonStore {
  #file;
  #state;
  #queue = Promise.resolve();

  constructor(file, state) {
    this.#file = file;
    this.#state = deepFreeze(state);
  }

  static async open(file, seedFile) {
    let raw;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT' || !seedFile) throw error;
      raw = await fs.readFile(seedFile, 'utf8');
      await writeAtomic(file, raw);
    }
    return new JsonStore(file, normalize(JSON.parse(raw)));
  }

  /** Cria um store apenas em memória (útil para testes). */
  static inMemory(state) {
    return new JsonStore(null, normalize(structuredClone(state)));
  }

  get snapshot() {
    return this.#state;
  }

  /**
   * Executa `mutator` sobre uma cópia mutável do estado e persiste o resultado.
   * O valor retornado pelo mutator é repassado ao chamador.
   */
  update(mutator) {
    const run = async () => {
      const draft = structuredClone(this.#state);
      const result = await mutator(draft);
      if (this.#file) await writeAtomic(this.#file, `${JSON.stringify(draft, null, 2)}\n`);
      this.#state = deepFreeze(draft);
      return result;
    };
    const next = this.#queue.then(run, run);
    this.#queue = next.catch(() => {});
    return next;
  }
}

function normalize(state) {
  for (const name of COLLECTIONS) {
    if (!Array.isArray(state[name])) state[name] = [];
  }
  return state;
}

async function writeAtomic(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, content, 'utf8');
  await fs.rename(temp, file);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
