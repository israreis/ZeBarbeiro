import { createClient } from '@supabase/supabase-js';

/** Clientes "sem estado": o servidor nunca guarda sessão nem renova tokens sozinho. */
const SERVER_AUTH_OPTIONS = Object.freeze({
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
});

/**
 * Cria os clientes do Supabase usados pelo servidor.
 * - `admin`: chave service_role (ignora RLS). Fica SOMENTE no servidor.
 * - `createPublicClient()`: chave anon/publishable, um cliente novo por operação de
 *   login/renovação, para que as sessões de usuários diferentes nunca se misturem.
 */
export function createSupabaseClients({ url, anonKey, serviceRoleKey }) {
  return {
    admin: createClient(url, serviceRoleKey, { auth: SERVER_AUTH_OPTIONS }),
    createPublicClient: () => createClient(url, anonKey, { auth: SERVER_AUTH_OPTIONS }),
  };
}
