/**
 * Cache em memória na frente dos repositórios do Supabase, para reduzir consultas.
 *
 * Por que é seguro:
 * - Toda gravação passa por esta API, e cada gravação limpa na hora o cache afetado.
 *   Quem grava vê o resultado na próxima leitura (não há "dado velho" depois de salvar).
 * - Leituras que começaram antes de uma gravação não são guardadas (controle por geração),
 *   então uma resposta antiga nunca sobrescreve o cache já limpo.
 * - Reserva dupla continua impossível: quem garante é o índice único no banco,
 *   não o cache. Se o cache estiver desatualizado, o INSERT é recusado (409).
 * - O TTL só limita alterações feitas por fora da API (ex.: SQL Editor do Supabase).
 *
 * Pensado para uma única instância do servidor. Com várias instâncias, cada uma tem seu
 * cache e só enxerga as próprias gravações: nesse caso, use um TTL baixo ou um cache
 * compartilhado (ex.: Redis).
 */

const clone = (value) => structuredClone(value);

/** Mapa com validade e limite de tamanho (descarta as entradas mais antigas). */
class TtlMap {
  constructor({ ttlMs, now, maxEntries }) {
    Object.assign(this, { ttlMs, now, maxEntries });
    this.entries = new Map();
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value) {
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  clear() {
    this.entries.clear();
  }
}

/**
 * Grupo de caches que é invalidado junto. A geração impede que uma leitura iniciada
 * antes de uma gravação guarde dados antigos depois que o cache foi limpo.
 */
class CacheGroup {
  constructor(options) {
    this.options = options;
    this.maps = [];
    this.generation = 0;
  }

  map(maxEntries = this.options.maxEntries) {
    const map = new TtlMap({ ...this.options, maxEntries });
    this.maps.push(map);
    return map;
  }

  /** Lê de `map` ou executa `load`; requisições simultâneas compartilham a mesma consulta. */
  async read(map, key, load) {
    const cached = map.get(key);
    if (cached !== undefined) return cached;

    map.pending ??= new Map();
    if (!map.pending.has(key)) {
      const generation = this.generation;
      const promise = load()
        .then((value) => {
          if (generation === this.generation) map.set(key, value);
          return value;
        })
        .finally(() => map.pending.delete(key));
      map.pending.set(key, promise);
    }
    return map.pending.get(key);
  }

  invalidate() {
    this.generation += 1;
    for (const map of this.maps) {
      map.clear();
      map.pending?.clear();
    }
  }

  /** Executa uma gravação e limpa o grupo ao final (mesmo se falhar: o banco pode ter mudado). */
  async write(action) {
    try {
      return await action();
    } finally {
      this.invalidate();
    }
  }
}

/**
 * @param {object} repos repositórios originais (Supabase)
 * @param {{ ttlMs?: number, now?: () => number, maxEntries?: number }} [options]
 */
export function withCache(repos, { ttlMs = 300_000, now = Date.now, maxEntries = 500 } = {}) {
  if (!ttlMs) return repos;
  const options = { ttlMs, now, maxEntries };

  // Cadastros: pequenos, lidos em quase toda tela.
  const cadastros = new CacheGroup(options);
  const servicosLista = cadastros.map(1);
  const barbeirosLista = cadastros.map(1);
  const listarServicos = () => cadastros.read(servicosLista, 'todos', () => repos.servicos.list());
  const listarBarbeiros = () => cadastros.read(barbeirosLista, 'todos', () => repos.barbeiros.list());

  // Agenda: horários ocupados por barbeiro/dia e listas por período (histórico, relatórios).
  const agenda = new CacheGroup(options);
  const ocupadosPorDia = agenda.map(2_000);
  const periodos = agenda.map(200);

  // Perfis: usados na validação de login (após o cache de sessão expirar) e no login.
  const perfisCache = new CacheGroup(options);
  const perfisPorId = perfisCache.map(5_000);

  const servicos = {
    list: async () => clone(await listarServicos()),
    async findById(id) {
      const servico = (await listarServicos()).find((s) => s.id === id);
      return servico ? clone(servico) : null;
    },
    insert: (dados) => cadastros.write(() => repos.servicos.insert(dados)),
    update: (id, dados) => cadastros.write(() => repos.servicos.update(id, dados)),
  };

  const barbeiros = {
    list: async () => clone(await listarBarbeiros()),
    async findById(id) {
      const barbeiro = (await listarBarbeiros()).find((b) => b.id === id);
      return barbeiro ? clone(barbeiro) : null;
    },
    save: (dados) => cadastros.write(async () => {
      try {
        return await repos.barbeiros.save(dados);
      } finally {
        perfisCache.invalidate();
      }
    }),
    setFotoPath: (id, fotoPath) => cadastros.write(() => repos.barbeiros.setFotoPath(id, fotoPath)),
  };

  const perfis = {
    async findById(id) {
      const perfil = await perfisCache.read(perfisPorId, id, () => repos.perfis.findById(id));
      return perfil ? clone(perfil) : null;
    },
    findManyByIds: (ids) => repos.perfis.findManyByIds(ids),
    // Verificação de e-mail duplicado precisa ser sempre atual.
    emailEmUso: (email, ignorarId) => repos.perfis.emailEmUso(email, ignorarId),
    insert: (perfil) => perfisCache.write(() => repos.perfis.insert(perfil)),
    update: (id, dados) => perfisCache.write(async () => {
      try {
        return await repos.perfis.update(id, dados);
      } finally {
        // Nome de barbeiro aparece na lista de barbeiros; nome de cliente, nos agendamentos.
        cadastros.invalidate();
        agenda.invalidate();
      }
    }),
  };

  const agendamentos = {
    // Antes de concluir/cancelar: leitura sempre atual.
    findById: (id) => repos.agendamentos.findById(id),

    /** Busca no banco apenas os barbeiros cujo dia ainda não está em cache. */
    async listOcupados({ barbeiroIds, data }) {
      const chave = (barbeiroId) => `${barbeiroId}|${data}`;
      const faltando = barbeiroIds.filter((id) => ocupadosPorDia.get(chave(id)) === undefined);

      if (faltando.length) {
        const generation = agenda.generation;
        const encontrados = await repos.agendamentos.listOcupados({ barbeiroIds: faltando, data });
        if (generation === agenda.generation) {
          for (const id of faltando) ocupadosPorDia.set(chave(id), encontrados.filter((ag) => ag.barbeiroId === id));
        }
        const emCache = barbeiroIds.filter((id) => !faltando.includes(id))
          .flatMap((id) => ocupadosPorDia.get(chave(id)) ?? []);
        return clone([...emCache, ...encontrados]);
      }
      return clone(barbeiroIds.flatMap((id) => ocupadosPorDia.get(chave(id)) ?? []));
    },

    async listPeriodo(filtros) {
      const chave = JSON.stringify([
        filtros.inicio, filtros.fim, filtros.barbeiroId ?? null, filtros.clienteId ?? null,
        [...(filtros.excluirStatus ?? [])].sort(),
      ]);
      return clone(await agenda.read(periodos, chave, () => repos.agendamentos.listPeriodo(filtros)));
    },

    insertMany: (lista) => agenda.write(() => repos.agendamentos.insertMany(lista)),
    updateStatus: (id, mudanca) => agenda.write(() => repos.agendamentos.updateStatus(id, mudanca)),
  };

  return {
    ...repos, servicos, barbeiros, perfis, agendamentos,
  };
}
