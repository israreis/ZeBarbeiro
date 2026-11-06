import crypto from 'node:crypto';
import {
  conflict, notFound, unauthorized, unprocessable,
} from '../../server/http/errors.js';
import { detectImageType } from '../../server/infra/image-type.js';

/**
 * Implementações em memória das portas da aplicação (repositórios, identidade e fotos),
 * com o mesmo contrato dos adaptadores do Supabase. Permitem testar a API inteira
 * com `app.inject`, sem rede e sem um projeto Supabase.
 */

const clone = (value) => structuredClone(value);

/**
 * @param {{ perfis: object[], servicos: object[], barbeiros: object[], agendamentos: object[] }} seed
 *   barbeiros: { id, ativo, horarioInicial, horarioFinal, diasDisponiveis, servicoIds, fotoPath? }
 *   (nome, e-mail etc. vêm do perfil com o mesmo id)
 */
export function createMemoryRepositories(seed) {
  const tables = {
    perfis: clone(seed.perfis ?? []),
    servicos: clone(seed.servicos ?? []),
    barbeiros: clone(seed.barbeiros ?? []),
    agendamentos: clone(seed.agendamentos ?? []).map((ag) => ({
      clienteId: null, clienteNome: null, clienteTelefone: null, valor: null, canceladoEm: null, ...ag,
    })),
  };

  const byId = (table, id) => tables[table].find((row) => row.id === id) ?? null;

  const toBarbeiro = (barbeiro) => {
    const perfil = byId('perfis', barbeiro.id);
    return clone({
      id: barbeiro.id,
      nome: perfil.nome,
      email: perfil.email,
      telefone: perfil.telefone,
      dataNascimento: perfil.dataNascimento,
      ativo: barbeiro.ativo,
      horarioInicial: barbeiro.horarioInicial,
      horarioFinal: barbeiro.horarioFinal,
      diasDisponiveis: barbeiro.diasDisponiveis,
      servicoIds: barbeiro.servicoIds,
      fotoPath: barbeiro.fotoPath ?? null,
    });
  };

  const emailDuplicado = (email, id) => tables.perfis.some((p) => p.email === email && p.id !== id);
  const ocupa = (ag) => ag.status !== 'Cancelado';

  return {
    tables,

    perfis: {
      async findById(id) {
        const perfil = byId('perfis', id);
        return perfil ? clone(perfil) : null;
      },
      async findManyByIds(ids) {
        return tables.perfis.filter((p) => ids.includes(p.id)).map(clone);
      },
      async emailEmUso(email, ignorarId = null) {
        return emailDuplicado(email, ignorarId);
      },
      async insert(perfil) {
        if (emailDuplicado(perfil.email)) throw conflict('Este e-mail já está cadastrado.');
        tables.perfis.push(clone(perfil));
        return clone(perfil);
      },
      async update(id, dados) {
        const perfil = byId('perfis', id);
        if (!perfil) throw notFound('Usuário não encontrado.');
        if (emailDuplicado(dados.email, id)) throw conflict('Este e-mail já está cadastrado.');
        Object.assign(perfil, {
          nome: dados.nome, email: dados.email, telefone: dados.telefone, dataNascimento: dados.dataNascimento,
        });
        return clone(perfil);
      },
    },

    servicos: {
      async list() {
        return [...tables.servicos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map(clone);
      },
      async findById(id) {
        const servico = byId('servicos', id);
        return servico ? clone(servico) : null;
      },
      async insert(dados) {
        const servico = { id: crypto.randomUUID(), ...dados };
        tables.servicos.push(servico);
        return clone(servico);
      },
      async update(id, dados) {
        const servico = byId('servicos', id);
        return servico ? clone(Object.assign(servico, dados)) : null;
      },
    },

    barbeiros: {
      async list() {
        return tables.barbeiros.map(toBarbeiro).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      },
      async findById(id) {
        const barbeiro = byId('barbeiros', id);
        return barbeiro ? toBarbeiro(barbeiro) : null;
      },
      async save(dados) {
        if (emailDuplicado(dados.email, dados.id)) throw conflict('Este e-mail já está cadastrado.');
        const perfil = byId('perfis', dados.id);
        const pessoais = {
          nome: dados.nome, email: dados.email, telefone: dados.telefone, dataNascimento: dados.dataNascimento,
        };
        if (perfil) Object.assign(perfil, pessoais);
        else tables.perfis.push({ id: dados.id, ...pessoais, perfil: 'barbeiro' });

        const agenda = {
          ativo: dados.ativo,
          horarioInicial: dados.horarioInicial,
          horarioFinal: dados.horarioFinal,
          diasDisponiveis: dados.diasDisponiveis,
          servicoIds: dados.servicoIds,
        };
        const barbeiro = byId('barbeiros', dados.id);
        if (barbeiro) Object.assign(barbeiro, agenda);
        else tables.barbeiros.push({ id: dados.id, ...agenda, fotoPath: null });
        return toBarbeiro(byId('barbeiros', dados.id));
      },
      async setFotoPath(id, fotoPath) {
        const barbeiro = byId('barbeiros', id);
        if (!barbeiro) throw notFound('Barbeiro não encontrado.');
        const anterior = barbeiro.fotoPath ?? null;
        barbeiro.fotoPath = fotoPath;
        return anterior;
      },
    },

    agendamentos: {
      async findById(id) {
        const agendamento = byId('agendamentos', id);
        return agendamento ? clone(agendamento) : null;
      },
      async listOcupados({ barbeiroIds, data }) {
        return tables.agendamentos
          .filter((ag) => barbeiroIds.includes(ag.barbeiroId) && ag.data === data && ocupa(ag))
          .map(clone);
      },
      async listPeriodo({
        inicio, fim, barbeiroId = null, clienteId = null, excluirStatus = [],
      }) {
        return tables.agendamentos
          .filter((ag) => ag.data >= inicio && ag.data <= fim
            && (!barbeiroId || ag.barbeiroId === barbeiroId)
            && (!clienteId || ag.clienteId === clienteId)
            && !excluirStatus.includes(ag.status))
          .sort((a, b) => a.data.localeCompare(b.data) || a.horarioInicio.localeCompare(b.horarioInicio))
          .map(clone);
      },
      /** Atômico como o INSERT único no Postgres: o índice parcial é verificado antes de gravar. */
      async insertMany(lista) {
        const colide = lista.some((novo) => tables.agendamentos.some((ag) => ocupa(ag)
          && ag.barbeiroId === novo.barbeiroId && ag.data === novo.data && ag.horarioInicio === novo.horarioInicio));
        if (colide) throw conflict('Um dos horários selecionados não está mais disponível.');
        const criados = lista.map((ag) => ({ ...ag, criadoEm: new Date().toISOString(), canceladoEm: null }));
        tables.agendamentos.push(...criados);
        return criados.map(clone);
      },
      async updateStatus(id, { de, para, canceladoEm = null }) {
        const agendamento = byId('agendamentos', id);
        if (!agendamento || !de.includes(agendamento.status)) return null;
        Object.assign(agendamento, { status: para }, canceladoEm ? { canceladoEm } : {});
        return clone(agendamento);
      },
    },
  };
}

/**
 * Supabase Auth simulado: usuários com senha, sessões com access/refresh token.
 * @param {Array<{ id: string, email: string, senha: string }>} usuarios
 */
export function createMemoryIdentity(usuarios = []) {
  const users = new Map(usuarios.map((u) => [u.id, { ...u }]));
  /** accessToken → { userId, refreshToken } */
  const sessions = new Map();

  const findByEmail = (email) => [...users.values()].find((u) => u.email === email);

  function openSession(userId) {
    const session = {
      accessToken: `at-${crypto.randomUUID()}`,
      refreshToken: `rt-${crypto.randomUUID()}`,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      userId,
    };
    sessions.set(session.accessToken, session);
    return { ...session };
  }

  const identity = {
    users,
    sessions,

    async signIn(email, senha) {
      const user = findByEmail(email);
      return user && user.senha === senha ? openSession(user.id) : null;
    },
    async refresh(refreshToken) {
      const atual = [...sessions.values()].find((s) => s.refreshToken === refreshToken);
      if (!atual) throw unauthorized();
      sessions.delete(atual.accessToken);
      return openSession(atual.userId);
    },
    async verifyToken(accessToken) {
      return sessions.get(accessToken)?.userId ?? null;
    },
    async verifyPassword(email, senha) {
      return findByEmail(email)?.senha === senha;
    },
    async signOut(accessToken, scope = 'local') {
      const atual = sessions.get(accessToken);
      if (!atual) return;
      for (const [token, session] of sessions) {
        if (session.userId !== atual.userId) continue;
        const mesma = token === accessToken;
        if (scope === 'global' || (scope === 'local' && mesma) || (scope === 'others' && !mesma)) sessions.delete(token);
      }
    },
    async createUser({ email, senha }) {
      if (findByEmail(email)) throw conflict('Este e-mail já está cadastrado.');
      const id = crypto.randomUUID();
      users.set(id, { id, email, senha });
      return id;
    },
    async updateUser(id, { email, senha }) {
      const user = users.get(id);
      if (email) {
        if (findByEmail(email) && findByEmail(email).id !== id) throw conflict('Este e-mail já está cadastrado.');
        user.email = email;
      }
      if (senha) user.senha = senha;
    },
    async deleteUser(id) {
      users.delete(id);
    },
    async revokeAllSessions(id) {
      for (const [token, session] of sessions) if (session.userId === id) sessions.delete(token);
    },
  };
  return identity;
}

/** Storage simulado: guarda os arquivos num Map e gera URLs fictícias. */
export function createMemoryPhotoStorage() {
  const files = new Map();
  return {
    files,
    async save(buffer) {
      const type = detectImageType(buffer);
      if (!type) throw unprocessable('Envie uma imagem JPG, PNG ou WEBP.');
      const path = `barbeiros/${crypto.randomUUID()}.${type.ext}`;
      files.set(path, buffer);
      return path;
    },
    async remove(path) {
      if (path) files.delete(path);
    },
    publicUrl(path) {
      return path ? `https://storage.teste/fotos-barbeiros/${path}` : null;
    },
  };
}
