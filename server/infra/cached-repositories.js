/**
 * Cache em memória para dados pequenos e lidos o tempo todo (serviços e barbeiros).
 * Gravações feitas pela API invalidam o cache na hora; alterações feitas por fora
 * (ex.: SQL Editor do Supabase) aparecem em no máximo `ttlMs`.
 *
 * Pensado para uma única instância do servidor. Com várias instâncias, reduza o TTL.
 */

function cachedList(load, { ttlMs, now }) {
  let value = null;
  let expiresAt = 0;
  let pending = null;

  return {
    async get() {
      if (value && expiresAt > now()) return value;
      // Requisições simultâneas compartilham a mesma consulta.
      pending ??= load()
        .then((result) => {
          value = result;
          expiresAt = now() + ttlMs;
          return result;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
    invalidate() {
      value = null;
      expiresAt = 0;
    },
  };
}

const clone = (value) => structuredClone(value);

/**
 * Envolve os repositórios com cache para `servicos` e `barbeiros`.
 * Os demais repositórios passam direto.
 */
export function withCache(repos, { ttlMs = 60_000, now = Date.now } = {}) {
  if (!ttlMs) return repos;

  const servicosCache = cachedList(() => repos.servicos.list(), { ttlMs, now });
  const barbeirosCache = cachedList(() => repos.barbeiros.list(), { ttlMs, now });

  const servicos = {
    async list() {
      return clone(await servicosCache.get());
    },
    async findById(id) {
      const servico = (await servicosCache.get()).find((s) => s.id === id);
      return servico ? clone(servico) : null;
    },
    async insert(dados) {
      try {
        return await repos.servicos.insert(dados);
      } finally {
        servicosCache.invalidate();
      }
    },
    async update(id, dados) {
      try {
        return await repos.servicos.update(id, dados);
      } finally {
        servicosCache.invalidate();
        barbeirosCache.invalidate();
      }
    },
  };

  const barbeiros = {
    async list() {
      return clone(await barbeirosCache.get());
    },
    async findById(id) {
      const barbeiro = (await barbeirosCache.get()).find((b) => b.id === id);
      return barbeiro ? clone(barbeiro) : null;
    },
    async save(dados) {
      try {
        return await repos.barbeiros.save(dados);
      } finally {
        barbeirosCache.invalidate();
      }
    },
    async setFotoPath(id, fotoPath) {
      try {
        return await repos.barbeiros.setFotoPath(id, fotoPath);
      } finally {
        barbeirosCache.invalidate();
      }
    },
  };

  const perfis = {
    ...repos.perfis,
    async update(id, dados) {
      try {
        return await repos.perfis.update(id, dados);
      } finally {
        // Nome/e-mail do barbeiro aparecem na lista de barbeiros.
        barbeirosCache.invalidate();
      }
    },
  };

  return {
    ...repos, servicos, barbeiros, perfis,
  };
}
