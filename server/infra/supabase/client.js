import { createClient } from '@supabase/supabase-js';

/** Clientes "sem estado": o servidor nunca guarda sessão nem renova tokens sozinho. */
const SERVER_AUTH_OPTIONS = Object.freeze({
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
});

/**
 * fetch que registra a duração de cada chamada ao Supabase (nível debug).
 * Ative com LOG_LEVEL=debug para descobrir o que está lento.
 */
function timedFetch(logger) {
  if (!logger) return undefined;
  return async (input, init) => {
    const inicio = performance.now();
    const response = await fetch(input, init);
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    logger.debug({
      supabase: `${init?.method ?? 'GET'} ${url.pathname}`,
      status: response.status,
      ms: Math.round(performance.now() - inicio),
    }, 'chamada ao Supabase');
    return response;
  };
}

/**
 * Cria os clientes do Supabase usados pelo servidor.
 * - `admin`: chave service_role (ignora RLS). Fica SOMENTE no servidor.
 * - `createPublicClient()`: chave anon/publishable, um cliente novo por operação de
 *   login/renovação, para que as sessões de usuários diferentes nunca se misturem.
 */
export function createSupabaseClients({ url, anonKey, serviceRoleKey }, { logger } = {}) {
  const fetchImpl = timedFetch(logger);
  const options = { auth: SERVER_AUTH_OPTIONS, ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}) };
  return {
    admin: createClient(url, serviceRoleKey, options),
    createPublicClient: () => createClient(url, anonKey, options),
  };
}
