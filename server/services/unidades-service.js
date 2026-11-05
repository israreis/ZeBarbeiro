import crypto from 'node:crypto';
import { notFound } from '../http/errors.js';
import * as v from '../validation.js';

function parseUnidade(body) {
  return {
    nome: v.requiredString(body?.nome, 'nome', { max: 60 }),
    endereco: v.requiredString(body?.endereco, 'endereço', { max: 200 }),
    telefone: v.phone(body?.telefone),
    email: v.email(body?.email),
  };
}

export function createUnidadesService({ store }) {
  return {
    list() {
      return store.snapshot.unidades;
    },

    create(body) {
      const dados = parseUnidade(body);
      return store.update((db) => {
        const unidade = { id: crypto.randomUUID(), ...dados };
        db.unidades.push(unidade);
        return unidade;
      });
    },

    update(id, body) {
      const dados = parseUnidade(body);
      return store.update((db) => {
        const unidade = db.unidades.find((u) => u.id === id);
        if (!unidade) throw notFound('Unidade não encontrada.');
        return Object.assign(unidade, dados);
      });
    },
  };
}
