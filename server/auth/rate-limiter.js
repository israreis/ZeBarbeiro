/**
 * Limitador de tentativas por chave (ex.: IP + e-mail) em janela fixa.
 * Protege o login contra força bruta.
 */
export class RateLimiter {
  #attempts = new Map();
  #maxAttempts;
  #windowMs;
  #now;

  constructor({ maxAttempts, windowMs, now = () => Date.now() }) {
    this.#maxAttempts = maxAttempts;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  isBlocked(key) {
    const entry = this.#current(key);
    return Boolean(entry && entry.count >= this.#maxAttempts);
  }

  registerFailure(key) {
    const entry = this.#current(key) ?? { count: 0, resetAt: this.#now() + this.#windowMs };
    entry.count += 1;
    this.#attempts.set(key, entry);
  }

  reset(key) {
    this.#attempts.delete(key);
  }

  #current(key) {
    const entry = this.#attempts.get(key);
    if (entry && entry.resetAt <= this.#now()) {
      this.#attempts.delete(key);
      return undefined;
    }
    return entry;
  }
}
