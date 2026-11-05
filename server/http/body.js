import { HttpError, badRequest } from './errors.js';

/** Lê e interpreta o corpo JSON da requisição, com limite de tamanho. */
export async function readJsonBody(req, maxBytes) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'DELETE') return undefined;

  const contentType = req.headers['content-type'] ?? '';
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'O corpo da requisição é grande demais.');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Envie os dados no formato JSON.');
  }

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw badRequest('O corpo da requisição deve ser um objeto JSON.');
    }
    return parsed;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw badRequest('JSON inválido.');
  }
}
