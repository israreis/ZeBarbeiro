import {
  conflict, tooManyRequests, unauthorized, unprocessable,
} from '../../http/errors.js';

/**
 * Identidade (login, senhas e sessões) sobre o Supabase Auth.
 * A API continua sendo a única porta de entrada: o navegador recebe o access token
 * e o refresh token emitidos pelo Supabase e os envia para o nosso servidor.
 */

const toSession = (session) => ({
  accessToken: session.access_token,
  refreshToken: session.refresh_token,
  expiresAt: session.expires_at,
  userId: session.user.id,
});

function translateAdminError(error) {
  if (error.code === 'email_exists' || /already (been )?registered/i.test(error.message)) {
    return conflict('Este e-mail já está cadastrado.');
  }
  if (error.code === 'weak_password') {
    return unprocessable('A senha não atende à política de segurança. Combine letras, números e símbolos.');
  }
  if (error.status === 429) return tooManyRequests('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
  return error;
}

/**
 * @param {{ admin: import('@supabase/supabase-js').SupabaseClient, createPublicClient: () => any }} clients
 */
export function createSupabaseIdentity({ admin, createPublicClient }) {
  async function signIn(email, senha) {
    const { data, error } = await createPublicClient().auth.signInWithPassword({ email, password: senha });
    if (error) {
      if (error.status === 429) throw tooManyRequests('Muitas tentativas de login. Aguarde alguns minutos e tente novamente.');
      // 400: credenciais inválidas (ou e-mail não confirmado). Mensagem genérica de propósito.
      if (error.status === 400) return null;
      throw error;
    }
    return toSession(data.session);
  }

  async function signOut(accessToken, scope = 'local') {
    if (!accessToken) return;
    // Falhas aqui não devem impedir o logout no navegador (ex.: token já expirado).
    await admin.auth.admin.signOut(accessToken, scope).catch(() => {});
  }

  return {
    /** Autentica com e-mail e senha. Devolve a sessão ou null se as credenciais forem inválidas. */
    signIn,

    /** Troca um refresh token válido por uma nova sessão. */
    async refresh(refreshToken) {
      const { data, error } = await createPublicClient().auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data.session) throw unauthorized();
      return toSession(data.session);
    },

    /**
     * Valida o access token no Supabase Auth e devolve o id do usuário (ou null).
     * `getUser` consulta o servidor de Auth, então tokens de sessões encerradas são recusados.
     */
    async verifyToken(accessToken) {
      if (!accessToken) return null;
      const { data, error } = await admin.auth.getUser(accessToken);
      return error ? null : (data.user?.id ?? null);
    },

    /** Confere a senha sem manter a sessão criada para a verificação. */
    async verifyPassword(email, senha) {
      const session = await signIn(email, senha);
      if (!session) return false;
      await signOut(session.accessToken, 'local');
      return true;
    },

    /** scope: 'local' (só esta sessão), 'others' (as demais) ou 'global' (todas). */
    signOut,

    async createUser({ email, senha }) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: senha,
        // Contas são criadas pela API (cadastro já validado), sem e-mail de confirmação.
        email_confirm: true,
      });
      if (error) throw translateAdminError(error);
      return data.user.id;
    },

    async updateUser(id, { email, senha }) {
      const attributes = {};
      if (email) Object.assign(attributes, { email, email_confirm: true });
      if (senha) attributes.password = senha;
      if (!Object.keys(attributes).length) return;
      const { error } = await admin.auth.admin.updateUserById(id, attributes);
      if (error) throw translateAdminError(error);
    },

    async deleteUser(id) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw error;
    },

    /** Encerra todas as sessões do usuário (ex.: senha redefinida pelo administrador). */
    async revokeAllSessions(id) {
      const { error } = await admin.rpc('revogar_sessoes', { p_usuario: id });
      if (error) throw error;
    },
  };
}
