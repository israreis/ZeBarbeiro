export const ROLES = Object.freeze({
  ADMIN: 'administrador',
  BARBEIRO: 'barbeiro',
  CLIENTE: 'cliente',
});

/** Dados do usuário que podem ser expostos pela API (nunca o hash da senha). */
export function toPublicUser(usuario) {
  const { id, nome, email, telefone, dataNascimento, perfil } = usuario;
  return { id, nome, email, telefone, dataNascimento, perfil };
}
