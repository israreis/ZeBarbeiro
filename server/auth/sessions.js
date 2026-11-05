import crypto from 'node:crypto';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/**
 * Sessões em memória baseadas em token opaco (Bearer).
 * Apenas o hash do token é guardado, então um dump de memória/log não expõe tokens válidos.
 */
export class SessionStore {
  #sessions = new Map();
  #ttlMs;
  #now;

  constructor({ ttlMs, now = () => Date.now() }) {
    this.#ttlMs = ttlMs;
    this.#now = now;
  }

  create(userId) {
    this.#purgeExpired();
    const token = crypto.randomBytes(32).toString('base64url');
    this.#sessions.set(sha256(token), { userId, expiresAt: this.#now() + this.#ttlMs });
    return token;
  }

  /** Retorna o id do usuário dono do token, ou null se inválido/expirado. */
  resolve(token) {
    if (!token) return null;
    const key = sha256(token);
    const session = this.#sessions.get(key);
    if (!session) return null;
    if (session.expiresAt <= this.#now()) {
      this.#sessions.delete(key);
      return null;
    }
    return session.userId;
  }

  revoke(token) {
    if (token) this.#sessions.delete(sha256(token));
  }

  /** Encerra todas as sessões de um usuário (ex.: após troca de senha). */
  revokeUser(userId, exceptToken) {
    const keep = exceptToken ? sha256(exceptToken) : null;
    for (const [key, session] of this.#sessions) {
      if (session.userId === userId && key !== keep) this.#sessions.delete(key);
    }
  }

  #purgeExpired() {
    const now = this.#now();
    for (const [key, session] of this.#sessions) {
      if (session.expiresAt <= now) this.#sessions.delete(key);
    }
  }
}
