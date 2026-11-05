import { clearSession, getSession, redirectToLogin } from './session.js';

const API_BASE = '/api';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Cliente HTTP da API. Envia o token da sessão, converte erros em `ApiError`
 * com a mensagem do servidor e redireciona para o login quando a sessão expira.
 */
export async function request(method, path, { body, query, blob } = {}) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }

  const headers = { Accept: 'application/json' };
  const session = getSession();
  if (session) headers.Authorization = `Bearer ${session.token}`;
  let payload;
  if (blob) {
    headers['Content-Type'] = blob.type || 'application/octet-stream';
    payload = blob;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'Não foi possível conectar ao servidor. Verifique sua conexão.');
  }

  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.ok) return data;

  if (response.status === 401 && session) {
    clearSession();
    redirectToLogin();
  }
  throw new ApiError(response.status, data?.erro ?? 'Não foi possível concluir a operação.');
}

/**
 * Baixa um arquivo gerado pela API (ex.: relatório em PDF) usando o token da sessão.
 * O nome do arquivo vem do cabeçalho Content-Disposition.
 */
export async function download(path, query) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  const session = getSession();
  let response;
  try {
    response = await fetch(url, { headers: session ? { Authorization: `Bearer ${session.token}` } : {} });
  } catch {
    throw new ApiError(0, 'Não foi possível conectar ao servidor. Verifique sua conexão.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    if (response.status === 401 && session) {
      clearSession();
      redirectToLogin();
    }
    throw new ApiError(response.status, data?.erro ?? 'Não foi possível gerar o arquivo.');
  }

  const fileName = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'arquivo';
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export const api = {
  get: (path, query) => request('GET', path, { query }),
  post: (path, body) => request('POST', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  patch: (path, body) => request('PATCH', path, { body }),
  delete: (path) => request('DELETE', path),
  /** Envia um arquivo binário (ex.: foto) no corpo da requisição. */
  upload: (path, blob) => request('PUT', path, { blob }),
};
