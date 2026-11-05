import { el } from './dom.js';

const DURATION_MS = 5000;
const STYLES = { success: 'alert-success', error: 'alert-danger', info: 'alert-info' };

function container() {
  let region = document.getElementById('notificacoes');
  if (!region) {
    region = el('div', { id: 'notificacoes', className: 'toast-region', attrs: { 'aria-live': 'polite' } });
    document.body.append(region);
  }
  return region;
}

/**
 * Exibe uma notificação não bloqueante (substitui os `alert()` espalhados pelo código antigo).
 * @param {string} message
 * @param {'success'|'error'|'info'} [type]
 */
export function notify(message, type = 'info') {
  const toast = el('div', {
    className: `alert ${STYLES[type] ?? STYLES.info} toast-message shadow`,
    attrs: { role: type === 'error' ? 'alert' : 'status' },
    text: message,
  });
  const close = el('button', {
    type: 'button',
    className: 'btn-close',
    attrs: { 'aria-label': 'Fechar' },
    on: { click: () => toast.remove() },
  });
  toast.append(close);
  container().append(toast);
  setTimeout(() => toast.remove(), DURATION_MS);
}

export const notifySuccess = (message) => notify(message, 'success');

/** Exibe a mensagem de um erro (da API ou inesperado). */
export function notifyError(error) {
  if (!(error?.name === 'ApiError')) console.error(error);
  notify(error?.name === 'ApiError' ? error.message : 'Ocorreu um erro inesperado. Tente novamente.', 'error');
}
