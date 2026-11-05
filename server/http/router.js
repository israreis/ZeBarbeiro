/**
 * Roteador mínimo com suporte a parâmetros (`/api/barbeiros/:id`).
 */
export class Router {
  #routes = [];

  /**
   * Registra uma rota. O primeiro item após o padrão pode ser um objeto de opções
   * (ex.: `{ rawBody: true }` para receber o corpo binário em vez de JSON).
   */
  add(method, pattern, ...args) {
    const options = typeof args[0] === 'object' && args[0] !== null ? args.shift() : {};
    const handlers = args;
    const keys = [];
    const source = pattern
      .split('/')
      .map((segment) => {
        if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        keys.push(segment.slice(1));
        return '([^/]+)';
      })
      .join('/');
    this.#routes.push({
      method, regex: new RegExp(`^${source}/?$`), keys, handlers, options,
    });
    return this;
  }

  get(pattern, ...handlers) { return this.add('GET', pattern, ...handlers); }

  post(pattern, ...handlers) { return this.add('POST', pattern, ...handlers); }

  put(pattern, ...handlers) { return this.add('PUT', pattern, ...handlers); }

  patch(pattern, ...handlers) { return this.add('PATCH', pattern, ...handlers); }

  delete(pattern, ...handlers) { return this.add('DELETE', pattern, ...handlers); }

  /**
   * Encontra a rota para o método e caminho.
   * Retorna `{ handlers, params, options }`, `{ methodNotAllowed: true }` ou `null`.
   */
  match(method, pathname) {
    let pathMatched = false;
    for (const route of this.#routes) {
      const result = route.regex.exec(pathname);
      if (!result) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = Object.fromEntries(route.keys.map((key, i) => [key, decodeURIComponent(result[i + 1])]));
      return { handlers: route.handlers, params, options: route.options };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}
