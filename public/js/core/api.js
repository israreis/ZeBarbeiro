import {
  clearSession, getSession, redirectToLogin, updateSessionTokens,
} from './session.js';

const API_BASE = '/api';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function buildUrl(path, query) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  return url;
}

async function send(url, init) {
  try {
    return await fetch(url, init);
  } catch {
    throw new ApiError(0, 'Não foi possível conectar ao servidor. Verifique sua conexão.');
  }
}

/** Renovação em andamento, compartilhada por requisições simultâneas que receberam 401. */
let refreshing = null;

/**
 * Tenta renovar a sessão com o refresh token (o access token do Supabase dura ~1h).
 * Devolve true se conseguiu; nesse caso a requisição original pode ser repetida.
 */
function refreshSession() {
  const session = getSession();
  if (!session?.refreshToken) return Promise.resolve(false);
  refreshing ??= (async () => {
    try {
      const response = await fetch(new URL(`${API_BASE}/auth/refresh`, window.location.origin), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      if (!response.ok) return false;
      const data = await response.json();
      updateSessionTokens(data);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/**
 * Executa uma requisição autenticada. Se o token expirou (401), renova a sessão uma vez
 * e repete; se não for possível, encerra a sessão e volta para o login.
 */
async function authorizedFetch(url, init) {
  const withToken = () => {
    const session = getSession();
    const headers = { ...init.headers };
    if (session) headers.Authorization = `Bearer ${session.token}`;
    return send(url, { ...init, headers });
  };

  let response = await withToken();
  // Credenciais erradas no login também respondem 401: não é sessão expirada.
  const isLogin = url.pathname === `${API_BASE}/auth/login`;
  if (response.status === 401 && getSession() && !isLogin) {
    if (await refreshSession()) response = await withToken();
    if (response.status === 401) {
      clearSession();
      redirectToLogin();
    }
  }
  return response;
}

/**
 * Cliente HTTP da API. Envia o token da sessão e converte erros em `ApiError`
 * com a mensagem do servidor.
 */
export async function request(method, path, { body, query, blob } = {}) {
  const headers = { Accept: 'application/json' };
  let payload;
  if (blob) {
    headers['Content-Type'] = blob.type || 'application/octet-stream';
    payload = blob;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const response = await authorizedFetch(buildUrl(path, query), { method, headers, body: payload });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.ok) return data;
  throw new ApiError(response.status, data?.erro ?? 'Não foi possível concluir a operação.');
}

/**
 * Baixa um arquivo gerado pela API (ex.: relatório em PDF) usando o token da sessão.
 * O nome do arquivo vem do cabeçalho Content-Disposition.
 */
export async function download(path, query) {
  const response = await authorizedFetch(buildUrl(path, query), { method: 'GET', headers: {} });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
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
