import { conflict, tooManyRequests, unauthorized, unprocessable } from '../http/errors.js';
import { ROLES, toPublicUser } from '../domain/roles.js';
import {
  cadastroClienteSchema, loginSchema, parse, perfilSchema, refreshSchema, trocaSenhaSchema,
} from '../schemas.js';

/**
 * Login, cadastro de clientes e manutenção da própria conta.
 * Senhas e sessões ficam no Supabase Auth (`identity`); os dados exibidos, na tabela `perfis`.
 */
export function createAuthService({
  repos, identity, loginLimiter, clock,
}) {
  /** Monta a resposta de sessão (tokens + usuário) a partir de uma sessão do Auth. */
  async function sessionResponse(session) {
    const perfil = await repos.perfis.findById(session.userId);
    if (!perfil) {
      // Usuário existe no Auth mas não na aplicação (ex.: criado manualmente no painel).
      await identity.signOut(session.accessToken);
      throw unauthorized('Conta sem cadastro na aplicação. Fale com a barbearia.');
    }
    return {
      token: session.accessToken,
      refreshToken: session.refreshToken,
      expiraEm: session.expiresAt,
      usuario: toPublicUser(perfil),
    };
  }

  async function exigirSenhaCorreta(usuario, senha, mensagem) {
    if (!senha || !(await identity.verifyPassword(usuario.email, senha))) throw unprocessable(mensagem);
  }

  return {
    /** Usuário dono do token, ou null se o token for inválido/expirado. */
    async authenticate(token) {
      const userId = await identity.verifyToken(token);
      return userId ? repos.perfis.findById(userId) : null;
    },

    async login(body, clientIp) {
      const { email, senha } = parse(loginSchema, body);
      const limiterKey = `${clientIp}|${email}`;
      if (loginLimiter.isBlocked(limiterKey)) {
        throw tooManyRequests('Muitas tentativas de login. Aguarde alguns minutos e tente novamente.');
      }

      const session = email && senha ? await identity.signIn(email, senha) : null;
      if (!session) {
        loginLimiter.registerFailure(limiterKey);
        throw unauthorized('E-mail ou senha inválidos.');
      }
      loginLimiter.reset(limiterKey);
      return sessionResponse(session);
    },

    async refresh(body) {
      const { refreshToken } = parse(refreshSchema, body);
      return sessionResponse(await identity.refresh(refreshToken));
    },

    logout(token) {
      return identity.signOut(token, 'local');
    },

    /** Cadastro público: sempre cria um cliente (o perfil nunca vem do corpo da requisição). */
    async registerCliente(body) {
      const { senha, ...dados } = parse(cadastroClienteSchema(clock().date), body);
      if (await repos.perfis.emailEmUso(dados.email)) throw conflict('Este e-mail já está cadastrado.');

      const id = await identity.createUser({ email: dados.email, senha });
      try {
        return toPublicUser(await repos.perfis.insert({ id, ...dados, perfil: ROLES.CLIENTE }));
      } catch (error) {
        // Compensação: não deixa um login "órfão" no Auth se o perfil não foi salvo.
        await identity.deleteUser(id).catch(() => {});
        throw error;
      }
    },

    /**
     * Atualiza os dados do próprio usuário. Perfil (papel) e senha não mudam aqui.
     * Trocar o e-mail (que é o login) exige a senha atual e encerra as outras sessões.
     */
    async updateProfile(usuario, body, currentToken) {
      const { senhaAtual, ...dados } = parse(perfilSchema(clock().date, usuario.perfil), body);
      const emailAlterado = dados.email !== usuario.email;

      if (emailAlterado) {
        await exigirSenhaCorreta(usuario, senhaAtual, 'Para alterar o e-mail, confirme sua senha atual.');
        if (await repos.perfis.emailEmUso(dados.email, usuario.id)) throw conflict('Este e-mail já está cadastrado.');
        await identity.updateUser(usuario.id, { email: dados.email });
      }

      const atualizado = await repos.perfis.update(usuario.id, dados);
      if (emailAlterado) await identity.signOut(currentToken, 'others');
      return toPublicUser(atualizado);
    },

    async changePassword(usuario, body, currentToken) {
      const { senhaAtual, novaSenha } = parse(trocaSenhaSchema, body);
      await exigirSenhaCorreta(usuario, senhaAtual, 'A senha atual está incorreta.');
      if (senhaAtual === novaSenha) throw unprocessable('A nova senha deve ser diferente da senha atual.');

      await identity.updateUser(usuario.id, { senha: novaSenha });
      await identity.signOut(currentToken, 'others');
    },
  };
}
