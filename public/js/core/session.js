const SESSION_KEY = 'barberapp.sessao';

/** Página inicial de cada perfil após o login. */
export const HOME_BY_ROLE = Object.freeze({
  administrador: 'admin-barbeiros.html',
  barbeiro: 'barbeiro-agenda.html',
  cliente: 'cliente-agendar.html',
});

function safeStorage(kind) {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Sessão do usuário no navegador.
 * "Lembrar-me" guarda no localStorage; caso contrário, apenas enquanto a aba estiver aberta.
 * Somente o token e dados não sensíveis do usuário são armazenados.
 */
export function saveSession({ token, usuario }, remember) {
  clearSession();
  const storage = safeStorage(remember ? 'local' : 'session');
  storage?.setItem(SESSION_KEY, JSON.stringify({ token, usuario }));
}

export function getSession() {
  for (const kind of ['session', 'local']) {
    const raw = safeStorage(kind)?.getItem(SESSION_KEY);
    if (!raw) continue;
    try {
      const session = JSON.parse(raw);
      if (session?.token && session?.usuario) return session;
    } catch {
      /* sessão corrompida: ignora */
    }
  }
  return null;
}

export function clearSession() {
  safeStorage('session')?.removeItem(SESSION_KEY);
  safeStorage('local')?.removeItem(SESSION_KEY);
}

export function redirectToLogin() {
  window.location.replace('login.html');
}
