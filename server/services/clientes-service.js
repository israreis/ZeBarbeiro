import { ROLES } from '../domain/roles.js';

export function createClientesService({ store }) {
  return {
    /** Clientes cadastrados com dados mínimos, para o barbeiro registrar atendimentos no balcão. */
    list() {
      return store.snapshot.usuarios
        .filter((u) => u.perfil === ROLES.CLIENTE)
        .map(({ id, nome, telefone }) => ({ id, nome, telefone }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    },
  };
}
