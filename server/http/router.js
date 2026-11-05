/**
 * Roteador mínimo com suporte a parâmetros (`/api/barbeiros/:id`).
 */
export class Router {
  #routes = [];

  add(method, pattern, ...handlers) {
    const keys = [];
    const source = pattern
      .split('/')
      .map((segment) => {
        if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        keys.push(segment.slice(1));
        return '([^/]+)';
      })
      .join('/');
    this.#routes.push({ method, regex: new RegExp(`^${source}/?$`), keys, handlers });
    return this;
  }

  get(pattern, ...handlers) { return this.add('GET', pattern, ...handlers); }

  post(pattern, ...handlers) { return this.add('POST', pattern, ...handlers); }

  put(pattern, ...handlers) { return this.add('PUT', pattern, ...handlers); }

  patch(pattern, ...handlers) { return this.add('PATCH', pattern, ...handlers); }

  /**
   * Encontra a rota para o método e caminho.
   * Retorna `{ handlers, params }`, `{ methodNotAllowed: true }` ou `null`.
   */
  match(method, pathname) {
    let pathMatched = false;
    for (const route of this.#routes) {
      const result = route.regex.exec(pathname);
      if (!result) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = Object.fromEntries(route.keys.map((key, i) => [key, decodeURIComponent(result[i + 1])]));
      return { handlers: route.handlers, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}
