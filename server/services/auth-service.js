import crypto from 'node:crypto';
import { conflict, tooManyRequests, unauthorized, unprocessable } from '../http/errors.js';
import { dummyVerify, hashPassword, verifyPassword } from '../auth/password.js';
import { ROLES, toPublicUser } from '../domain/roles.js';
import * as v from '../validation.js';
import { IDADE_MINIMA_CLIENTE, MENSAGEM_MENOR_DE_IDADE } from '../domain/clientes.js';

export function createAuthService({
  store, sessions, loginLimiter, clock,
}) {
  /** Nascimento obrigatório; clientes precisam ter a idade mínima. */
  const parseNascimento = (value, perfil) => v.birthDate(value, clock().date, perfil === ROLES.CLIENTE
    ? { minAge: IDADE_MINIMA_CLIENTE, minAgeMessage: MENSAGEM_MENOR_DE_IDADE }
    : {});

  const findByEmail = (email) => store.snapshot.usuarios.find((u) => u.email === email);

  return {
    async login(body, clientIp) {
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      const senha = typeof body?.senha === 'string' ? body.senha : '';
      const limiterKey = `${clientIp}|${email}`;

      if (loginLimiter.isBlocked(limiterKey)) {
        throw tooManyRequests('Muitas tentativas de login. Aguarde alguns minutos e tente novamente.');
      }

      const usuario = findByEmail(email);
      const valid = usuario ? await verifyPassword(senha, usuario.senhaHash) : await dummyVerify(senha);
      if (!valid) {
        loginLimiter.registerFailure(limiterKey);
        throw unauthorized('E-mail ou senha inválidos.');
      }

      loginLimiter.reset(limiterKey);
      return { token: sessions.create(usuario.id), usuario: toPublicUser(usuario) };
    },

    logout(token) {
      sessions.revoke(token);
    },

    async registerCliente(body) {
      const dados = {
        nome: v.requiredString(body?.nome, 'nome'),
        email: v.email(body?.email),
        telefone: v.phone(body?.telefone),
        dataNascimento: parseNascimento(body?.dataNascimento, ROLES.CLIENTE),
      };
      const senha = v.password(body?.senha);
      const senhaHash = await hashPassword(senha);

      const usuario = await store.update((db) => {
        if (db.usuarios.some((u) => u.email === dados.email)) {
          throw conflict('Este e-mail já está cadastrado.');
        }
        const novo = { id: crypto.randomUUID(), ...dados, senhaHash, perfil: ROLES.CLIENTE };
        db.usuarios.push(novo);
        return novo;
      });
      return toPublicUser(usuario);
    },

    /**
     * Atualiza os dados do próprio usuário. Perfil e senha não são alterados aqui.
     * Trocar o e-mail (que é o login) exige confirmar a senha atual e encerra as outras sessões.
     */
    async updateProfile(usuario, body, currentToken) {
      const dados = {
        nome: v.requiredString(body?.nome, 'nome'),
        email: v.email(body?.email),
        telefone: v.phone(body?.telefone),
        dataNascimento: parseNascimento(body?.dataNascimento, usuario.perfil),
      };

      const emailAlterado = dados.email !== usuario.email;
      if (emailAlterado && !(await verifyPassword(String(body?.senhaAtual ?? ''), usuario.senhaHash))) {
        throw unprocessable('Para alterar o e-mail, confirme sua senha atual.');
      }

      const atualizado = await store.update((db) => {
        if (emailAlterado && db.usuarios.some((u) => u.id !== usuario.id && u.email === dados.email)) {
          throw conflict('Este e-mail já está cadastrado.');
        }
        return Object.assign(db.usuarios.find((u) => u.id === usuario.id), dados);
      });
      if (emailAlterado) sessions.revokeUser(usuario.id, currentToken);
      return toPublicUser(atualizado);
    },

    async changePassword(usuario, body, currentToken) {
      const senhaAtual = typeof body?.senhaAtual === 'string' ? body.senhaAtual : '';
      const novaSenha = v.password(body?.novaSenha, 'nova senha');

      if (!(await verifyPassword(senhaAtual, usuario.senhaHash))) {
        throw unprocessable('A senha atual está incorreta.');
      }
      if (senhaAtual === novaSenha) {
        throw unprocessable('A nova senha deve ser diferente da senha atual.');
      }

      const senhaHash = await hashPassword(novaSenha);
      await store.update((db) => {
        db.usuarios.find((u) => u.id === usuario.id).senhaHash = senhaHash;
      });
      sessions.revokeUser(usuario.id, currentToken);
    },
  };
}
