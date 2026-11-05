import crypto from 'node:crypto';
import { conflict, notFound } from '../http/errors.js';
import { ROLES } from '../domain/roles.js';
import * as v from '../validation.js';

function parseServico(body) {
  return {
    nome: v.requiredString(body?.nome, 'nome', { max: 60 }),
    valor: v.positiveNumber(body?.valor, 'valor'),
    duracaoMinutos: v.positiveInteger(body?.duracaoMinutos, 'duração (minutos)', { max: 480 }),
    ativo: body?.ativo === undefined ? true : v.boolean(body.ativo, 'ativo'),
  };
}

function assertNomeDisponivel(db, nome, ignoreId) {
  const key = nome.toLocaleLowerCase('pt-BR');
  if (db.servicos.some((s) => s.id !== ignoreId && s.nome.toLocaleLowerCase('pt-BR') === key)) {
    throw conflict('Já existe um serviço com este nome.');
  }
}

export function createServicosService({ store }) {
  return {
    /** Administrador vê todos; demais perfis apenas os serviços ativos. */
    list(actor) {
      const { servicos } = store.snapshot;
      return actor.perfil === ROLES.ADMIN ? servicos : servicos.filter((s) => s.ativo);
    },

    create(body) {
      const dados = parseServico(body);
      return store.update((db) => {
        assertNomeDisponivel(db, dados.nome);
        const servico = { id: crypto.randomUUID(), ...dados };
        db.servicos.push(servico);
        return servico;
      });
    },

    update(id, body) {
      const dados = parseServico(body);
      return store.update((db) => {
        const servico = db.servicos.find((s) => s.id === id);
        if (!servico) throw notFound('Serviço não encontrado.');
        assertNomeDisponivel(db, dados.nome, id);
        return Object.assign(servico, dados);
      });
    },
  };
}
