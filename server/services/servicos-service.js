import { conflict, notFound } from '../http/errors.js';
import { ROLES } from '../domain/roles.js';
import { parse, servicoSchema } from '../schemas.js';

const normalizarNome = (nome) => nome.toLocaleLowerCase('pt-BR');

export function createServicosService({ repos }) {
  /** Verificação amigável; o índice único no banco garante a regra mesmo sob concorrência. */
  async function assertNomeDisponivel(nome, ignorarId) {
    const servicos = await repos.servicos.list();
    if (servicos.some((s) => s.id !== ignorarId && normalizarNome(s.nome) === normalizarNome(nome))) {
      throw conflict('Já existe um serviço com este nome.');
    }
  }

  return {
    /** Administrador vê todos; demais perfis apenas os serviços ativos. */
    async list(actor) {
      const servicos = await repos.servicos.list();
      return actor.perfil === ROLES.ADMIN ? servicos : servicos.filter((s) => s.ativo);
    },

    async create(body) {
      const dados = parse(servicoSchema, body);
      await assertNomeDisponivel(dados.nome);
      return repos.servicos.insert(dados);
    },

    async update(id, body) {
      const dados = parse(servicoSchema, body);
      if (!(await repos.servicos.findById(id))) throw notFound('Serviço não encontrado.');
      await assertNomeDisponivel(dados.nome, id);
      const servico = await repos.servicos.update(id, dados);
      if (!servico) throw notFound('Serviço não encontrado.');
      return servico;
    },
  };
}
