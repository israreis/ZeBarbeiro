import crypto from 'node:crypto';

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

/** Lê o `exp` (segundos) de um JWT já validado, só para não guardar além da validade. */
function jwtExpiryMs(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Cache curto de "token → usuário" já validado no Supabase Auth.
 * Evita duas chamadas de rede (validar token + buscar perfil) em quase toda requisição.
 * O token é guardado apenas como hash. Logout, troca de senha/e-mail e senha redefinida
 * limpam as entradas na hora; sessões encerradas por fora (ex.: painel do Supabase)
 * deixam de valer em no máximo `ttlMs`.
 */
export class SessionCache {
  constructor({ ttlMs = 30_000, maxEntries = 5_000, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    /** @type {Map<string, { usuario: object, expiresAt: number }>} */
    this.entries = new Map();
  }

  get(token) {
    if (!this.ttlMs) return null;
    const key = hash(token);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.usuario;
  }

  set(token, usuario) {
    if (!this.ttlMs) return;
    if (this.entries.size >= this.maxEntries) this.#prune();
    const limite = this.now() + this.ttlMs;
    const expiracaoToken = jwtExpiryMs(token);
    this.entries.set(hash(token), {
      usuario,
      expiresAt: expiracaoToken ? Math.min(limite, expiracaoToken) : limite,
    });
  }

  /** Remove uma sessão (logout). */
  deleteToken(token) {
    if (token) this.entries.delete(hash(token));
  }

  /** Remove as sessões do usuário em cache, exceto (opcionalmente) a atual. */
  deleteUser(userId, { exceto } = {}) {
    const manter = exceto ? hash(exceto) : null;
    for (const [key, entry] of this.entries) {
      if (entry.usuario.id === userId && key !== manter) this.entries.delete(key);
    }
  }

  /** Atualiza os dados do usuário nas sessões em cache (ex.: nome alterado). */
  updateUser(usuario) {
    for (const entry of this.entries.values()) {
      if (entry.usuario.id === usuario.id) entry.usuario = usuario;
    }
  }

  #prune() {
    const agora = this.now();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= agora) this.entries.delete(key);
    // Ainda cheio: descarta as mais antigas (o Map mantém a ordem de inserção).
    for (const key of this.entries.keys()) {
      if (this.entries.size < this.maxEntries) break;
      this.entries.delete(key);
    }
  }
}
