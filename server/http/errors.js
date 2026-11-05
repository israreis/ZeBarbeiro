/**
 * Erro de domínio/HTTP com status e mensagem segura para exibir ao usuário.
 */
export class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, details);
export const unauthorized = (message = 'Sessão inválida ou expirada.') => new HttpError(401, message);
export const forbidden = (message = 'Você não tem permissão para esta ação.') => new HttpError(403, message);
export const notFound = (message = 'Recurso não encontrado.') => new HttpError(404, message);
export const conflict = (message) => new HttpError(409, message);
export const unprocessable = (message, details) => new HttpError(422, message, details);
export const tooManyRequests = (message) => new HttpError(429, message);
