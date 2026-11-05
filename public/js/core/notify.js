import { el } from './dom.js';

const DURATION_MS = 5000;

function container() {
  let region = document.getElementById('notificacoes');
  if (!region) {
    region = el('div', { id: 'notificacoes', className: 'toast-region', attrs: { 'aria-live': 'polite' } });
    document.body.append(region);
  }
  return region;
}

function dismiss(toast) {
  if (toast.classList.contains('is-leaving')) return;
  toast.classList.add('is-leaving');
  toast.addEventListener('animationend', () => toast.remove(), { once: true });
  setTimeout(() => toast.remove(), 400); // garante a remoção mesmo sem animação
}

/**
 * Exibe uma notificação não bloqueante.
 * @param {string} message
 * @param {'success'|'error'|'info'} [type]
 */
export function notify(message, type = 'info') {
  const toast = el('div', {
    className: 'toast-message',
    dataset: { type },
    attrs: { role: type === 'error' ? 'alert' : 'status' },
  }, [
    el('p', { text: message }),
    el('button', {
      type: 'button',
      className: 'btn-close',
      attrs: { 'aria-label': 'Fechar notificação' },
      on: { click: () => dismiss(toast) },
    }),
  ]);
  container().append(toast);
  setTimeout(() => dismiss(toast), DURATION_MS);
}

export const notifySuccess = (message) => notify(message, 'success');

/** Exibe a mensagem de um erro (da API ou inesperado). */
export function notifyError(error) {
  const isApiError = error?.name === 'ApiError';
  if (!isApiError) console.error(error);
  notify(isApiError ? error.message : 'Ocorreu um erro inesperado. Tente novamente.', 'error');
}

const PENDING_KEY = 'barberapp.notificacao';

/** Guarda uma notificação para ser exibida na próxima página (após um redirecionamento). */
export function notifyAfterRedirect(message, type = 'success') {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ message, type }));
  } catch {
    /* sem armazenamento disponível: a notificação é descartada */
  }
}

/** Exibe a notificação deixada pela página anterior, se houver. */
export function showPendingNotification() {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PENDING_KEY);
    const { message, type } = JSON.parse(raw);
    notify(message, type);
  } catch {
    /* notificação corrompida: ignora */
  }
}
