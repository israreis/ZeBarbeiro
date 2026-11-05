import crypto from 'node:crypto';
import { conflict, notFound, unprocessable } from '../http/errors.js';
import { hashPassword } from '../auth/password.js';
import { ROLES, toPublicUser } from '../domain/roles.js';
import { WEEKDAYS, timeToMinutes } from '../domain/time.js';
import { SLOT_MINUTES } from '../domain/agenda.js';
import * as v from '../validation.js';
import { createPhotoStorage } from './photo-storage.js';
import { fotoUrl } from '../domain/barbeiro.js';

function parseDadosPessoais(body, today) {
  return {
    nome: v.requiredString(body?.nome, 'nome'),
    email: v.email(body?.email),
    telefone: v.phone(body?.telefone),
    dataNascimento: v.birthDate(body?.dataNascimento, today),
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

export function createBarbeirosService({
  store, sessions, uploadsDir, clock,
}) {
  const photos = createPhotoStorage(uploadsDir);

  const toAdminView = (barbeiro, db) => {
    const usuario = db.usuarios.find((u) => u.id === barbeiro.id);
    const { foto, ...dados } = barbeiro;
    return {
      ...toPublicUser(usuario),
      ...dados,
      fotoUrl: fotoUrl(barbeiro),
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
    fotoUrl: fotoUrl(barbeiro),
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
      const pessoais = parseDadosPessoais(body, clock().date);
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
      const pessoais = parseDadosPessoais(body, clock().date);
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

    /** Salva (ou substitui) a foto do barbeiro. O arquivo anterior é apagado após a troca. */
    async setFoto(id, buffer) {
      if (!store.snapshot.barbeiros.some((b) => b.id === id)) throw notFound('Barbeiro não encontrado.');
      const fileName = await photos.save(buffer);
      let anterior;
      try {
        const atualizado = await store.update((db) => {
          const barbeiro = db.barbeiros.find((b) => b.id === id);
          if (!barbeiro) throw notFound('Barbeiro não encontrado.');
          anterior = barbeiro.foto;
          barbeiro.foto = fileName;
          return toAdminView(barbeiro, db);
        });
        await photos.remove(anterior);
        return atualizado;
      } catch (error) {
        await photos.remove(fileName);
        throw error;
      }
    },

    async removeFoto(id) {
      let anterior;
      await store.update((db) => {
        const barbeiro = db.barbeiros.find((b) => b.id === id);
        if (!barbeiro) throw notFound('Barbeiro não encontrado.');
        anterior = barbeiro.foto;
        delete barbeiro.foto;
      });
      await photos.remove(anterior);
    },

    async getFoto(id) {
      const barbeiro = store.snapshot.barbeiros.find((b) => b.id === id);
      if (!barbeiro?.foto) throw notFound('Foto não encontrada.');
      try {
        return await photos.read(barbeiro.foto);
      } catch {
        throw notFound('Foto não encontrada.');
      }
    },
  };
}
