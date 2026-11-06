import { conflict, notFound } from '../http/errors.js';
import { ROLES } from '../domain/roles.js';
import { barbeiroSchema, parse } from '../schemas.js';

/**
 * Cadastro de barbeiros (administrador), listagem para clientes e fotos.
 * O login do barbeiro é criado no Supabase Auth; perfil, expediente e serviços
 * são gravados juntos pela função SQL `salvar_barbeiro`.
 */
export function createBarbeirosService({
  repos, identity, photos, clock,
}) {
  const fotoUrl = (barbeiro) => photos.publicUrl(barbeiro.fotoPath);

  const toAdminView = (barbeiro, servicos) => {
    const { fotoPath, ...dados } = barbeiro;
    return {
      ...dados,
      perfil: ROLES.BARBEIRO,
      fotoUrl: fotoUrl(barbeiro),
      servicos: barbeiro.servicoIds
        .map((id) => servicos.find((s) => s.id === id))
        .filter(Boolean)
        .map(({ id, nome }) => ({ id, nome })),
    };
  };

  /** Visão reduzida para clientes: sem dados pessoais, só serviços ativos. */
  const toClienteView = (barbeiro, servicos) => ({
    id: barbeiro.id,
    nome: barbeiro.nome,
    fotoUrl: fotoUrl(barbeiro),
    servicos: barbeiro.servicoIds
      .map((id) => servicos.find((s) => s.id === id && s.ativo))
      .filter(Boolean),
  });

  async function findOrFail(id) {
    const barbeiro = await repos.barbeiros.findById(id);
    if (!barbeiro) throw notFound('Barbeiro não encontrado.');
    return barbeiro;
  }

  async function get(id) {
    const [barbeiro, servicos] = await Promise.all([findOrFail(id), repos.servicos.list()]);
    return toAdminView(barbeiro, servicos);
  }

  async function parseBarbeiro(body, { criacao }) {
    const servicos = await repos.servicos.list();
    const dados = parse(barbeiroSchema(clock().date, servicos.map((s) => s.id), { criacao }), body);
    return { dados, servicos };
  }

  return {
    async list(actor) {
      const [barbeiros, servicos] = await Promise.all([repos.barbeiros.list(), repos.servicos.list()]);
      if (actor.perfil === ROLES.ADMIN) return barbeiros.map((b) => toAdminView(b, servicos));
      return barbeiros.filter((b) => b.ativo).map((b) => toClienteView(b, servicos));
    },

    get,

    async create(body) {
      const { dados: { senha, ...dados }, servicos } = await parseBarbeiro(body, { criacao: true });
      if (await repos.perfis.emailEmUso(dados.email)) throw conflict('Este e-mail já está cadastrado.');

      const id = await identity.createUser({ email: dados.email, senha });
      try {
        return toAdminView(await repos.barbeiros.save({ id, ...dados }), servicos);
      } catch (error) {
        // Compensação: remove o login criado se o cadastro não pôde ser salvo.
        await identity.deleteUser(id).catch(() => {});
        throw error;
      }
    },

    async update(id, body) {
      const atual = await findOrFail(id);
      const { dados: { novaSenha, ...dados }, servicos } = await parseBarbeiro(body, { criacao: false });

      if (dados.email !== atual.email) {
        if (await repos.perfis.emailEmUso(dados.email, id)) throw conflict('Este e-mail já está cadastrado.');
        await identity.updateUser(id, { email: dados.email });
      }
      if (novaSenha) {
        await identity.updateUser(id, { senha: novaSenha });
        // Senha redefinida pelo administrador encerra as sessões abertas do barbeiro.
        await identity.revokeAllSessions(id);
      }
      return toAdminView(await repos.barbeiros.save({ id, ...dados }), servicos);
    },

    /** Salva (ou substitui) a foto. O arquivo anterior é apagado depois da troca. */
    async setFoto(id, buffer) {
      await findOrFail(id);
      const novoPath = await photos.save(buffer);
      let anterior;
      try {
        anterior = await repos.barbeiros.setFotoPath(id, novoPath);
      } catch (error) {
        await photos.remove(novoPath);
        throw error;
      }
      await photos.remove(anterior);
      return get(id);
    },

    async removeFoto(id) {
      const anterior = await repos.barbeiros.setFotoPath(id, null);
      await photos.remove(anterior);
    },

    /** URL da foto do barbeiro (ou null), usada nos dados da própria conta. */
    async fotoUrlOf(id) {
      const barbeiro = await repos.barbeiros.findById(id);
      return barbeiro ? fotoUrl(barbeiro) : null;
    },
  };
}
