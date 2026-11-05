import { el, modal } from '../core/dom.js';

let dialog = null;

/** Cria (uma única vez) o modal de confirmação reutilizado por toda a aplicação. */
function getDialog() {
  if (dialog) return dialog;

  const title = el('h2', { className: 'modal-title', id: 'confirmacao-titulo' });
  const message = el('p', { className: 'confirm-message', id: 'confirmacao-mensagem' });
  const cancel = el('button', { type: 'button', className: 'btn-ghost', dataset: { bsDismiss: 'modal' } });
  const confirm = el('button', { type: 'button', className: 'btn-app' });

  const element = el('div', {
    className: 'modal fade confirm-dialog',
    tabIndex: -1,
    attrs: {
      role: 'alertdialog',
      'aria-modal': 'true',
      'aria-labelledby': 'confirmacao-titulo',
      'aria-describedby': 'confirmacao-mensagem',
    },
  }, [
    el('div', { className: 'modal-dialog modal-dialog-centered modal-sm-app' }, [
      el('div', { className: 'modal-content' }, [
        el('div', { className: 'modal-body' }, [title, message]),
        el('div', { className: 'modal-footer' }, [cancel, confirm]),
      ]),
    ]),
  ]);
  document.body.append(element);

  dialog = {
    element, title, message, cancel, confirm,
  };
  return dialog;
}

/**
 * Pede confirmação ao usuário com o visual da aplicação (substitui o `window.confirm`).
 * @param {object} options
 * @param {string} options.title pergunta principal, ex.: "Cancelar agendamento?"
 * @param {string} [options.message] detalhe do que vai acontecer
 * @param {string} [options.confirmLabel] texto do botão de confirmação (diga a ação)
 * @param {string} [options.cancelLabel] texto do botão que desiste da ação
 * @param {boolean} [options.danger] ação destrutiva: botão em destaque de alerta e foco em "voltar"
 * @returns {Promise<boolean>} true se o usuário confirmou
 */
export function confirmDialog({
  title, message = '', confirmLabel = 'Confirmar', cancelLabel = 'Voltar', danger = false,
}) {
  const ui = getDialog();
  ui.title.textContent = title;
  ui.message.textContent = message;
  ui.message.hidden = !message;
  ui.cancel.textContent = cancelLabel;
  ui.confirm.textContent = confirmLabel;
  ui.confirm.className = danger ? 'btn-app btn-danger-app' : 'btn-app';

  return new Promise((resolve) => {
    let confirmed = false;
    const onConfirm = () => {
      confirmed = true;
      modal.hide(ui.element);
    };
    // Em ações destrutivas o foco inicial fica no botão de desistir, evitando confirmações acidentais.
    const onShown = () => (danger ? ui.cancel : ui.confirm).focus();
    const onHidden = () => {
      ui.confirm.removeEventListener('click', onConfirm);
      ui.element.removeEventListener('shown.bs.modal', onShown);
      resolve(confirmed);
    };

    ui.confirm.addEventListener('click', onConfirm);
    ui.element.addEventListener('shown.bs.modal', onShown);
    ui.element.addEventListener('hidden.bs.modal', onHidden, { once: true });
    modal.show(ui.element);
  });
}
