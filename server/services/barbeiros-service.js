import crypto from 'node:crypto';
import { conflict, notFound, unprocessable } from '../http/errors.js';
import { hashPassword } from '../auth/password.js';
import { ROLES, toPublicUser } from '../domain/roles.js';
import { WEEKDAYS, timeToMinutes } from '../domain/time.js';
import { SLOT_MINUTES } from '../domain/agenda.js';
import * as v from '../validation.js';

function parseDadosPessoais(body) {
  return {
    nome: v.requiredString(body?.nome, 'nome'),
    email: v.email(body?.email),
    telefone: v.phone(body?.telefone),
    dataNascimento: v.optionalIsoDate(body?.dataNascimento, 'data de nascimento'),
  };
}

function parseAgenda(body, servicosExistentes) {
  const horarioInicial = v.time(body?.horarioInicial, 'horário inicial');
  const horarioFinal = v.time(body?.horarioFinal, 'horário final');
  if (timeToMinutes(horarioFinal) - timeToMinutes(horarioInicial) < SLOT_MINUTES) {
    throw unprocessable(`O expediente deve terminar pelo menos ${SLOT_MINUTES} minutos após o início.`);
  }
  return {
    ativo: body?.ativo === undefined ? true : v.boolean(body.ativo, 'ativo'),
    servicoIds: v.stringArray(body?.servicoIds, 'serviços', {
      allowed: servicosExistentes.map((s) => s.id),
      minItems: 1,
    }),
    diasDisponiveis: v.stringArray(body?.diasDisponiveis, 'dias disponíveis', { allowed: WEEKDAYS, minItems: 1 })
      .sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b)),
    horarioInicial,
    horarioFinal,
  };
}

function assertEmailDisponivel(db, email, ignoreId) {
  if (db.usuarios.some((u) => u.id !== ignoreId && u.email === email)) {
    throw conflict('Este e-mail já está cadastrado.');
  }
}

export function createBarbeirosService({ store, sessions }) {
  const toAdminView = (barbeiro, db) => {
    const usuario = db.usuarios.find((u) => u.id === barbeiro.id);
    return {
      ...toPublicUser(usuario),
      ...barbeiro,
      servicos: barbeiro.servicoIds
        .map((id) => db.servicos.find((s) => s.id === id))
        .filter(Boolean)
        .map(({ id, nome }) => ({ id, nome })),
    };
  };

  /** Visão reduzida para clientes: só barbeiros ativos e serviços ativos que eles oferecem. */
  const toClienteView = (barbeiro, db) => ({
    id: barbeiro.id,
    nome: db.usuarios.find((u) => u.id === barbeiro.id)?.nome ?? '',
    servicos: barbeiro.servicoIds
      .map((id) => db.servicos.find((s) => s.id === id && s.ativo))
      .filter(Boolean),
  });

  return {
    list(actor) {
      const db = store.snapshot;
      const barbeiros = db.barbeiros.filter((b) => db.usuarios.some((u) => u.id === b.id));
      if (actor.perfil === ROLES.ADMIN) return barbeiros.map((b) => toAdminView(b, db));
      return barbeiros.filter((b) => b.ativo).map((b) => toClienteView(b, db));
    },

    get(id) {
      const db = store.snapshot;
      const barbeiro = db.barbeiros.find((b) => b.id === id);
      if (!barbeiro) throw notFound('Barbeiro não encontrado.');
      return toAdminView(barbeiro, db);
    },

    async create(body) {
      const pessoais = parseDadosPessoais(body);
      const agenda = parseAgenda(body, store.snapshot.servicos);
      const senhaHash = await hashPassword(v.password(body?.senha));

      return store.update((db) => {
        assertEmailDisponivel(db, pessoais.email);
        const id = crypto.randomUUID();
        db.usuarios.push({ id, ...pessoais, senhaHash, perfil: ROLES.BARBEIRO });
        db.barbeiros.push({ id, ...agenda });
        return toAdminView(db.barbeiros.at(-1), db);
      });
    },

    async update(id, body) {
      const pessoais = parseDadosPessoais(body);
      const agenda = parseAgenda(body, store.snapshot.servicos);
      const novaSenha = body?.novaSenha ? v.password(body.novaSenha, 'nova senha') : null;
      const senhaHash = novaSenha ? await hashPassword(novaSenha) : null;

      const atualizado = await store.update((db) => {
        const barbeiro = db.barbeiros.find((b) => b.id === id);
        const usuario = db.usuarios.find((u) => u.id === id);
        if (!barbeiro || !usuario) throw notFound('Barbeiro não encontrado.');
        assertEmailDisponivel(db, pessoais.email, id);

        Object.assign(usuario, pessoais, senhaHash ? { senhaHash } : {});
        Object.assign(barbeiro, agenda);
        return toAdminView(barbeiro, db);
      });

      // Senha redefinida pelo administrador invalida as sessões abertas do barbeiro.
      if (senhaHash) sessions.revokeUser(id);
      return atualizado;
    },
  };
}
