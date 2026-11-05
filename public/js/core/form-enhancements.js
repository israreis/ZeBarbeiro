/**
 * Melhorias aplicadas automaticamente a todos os formulários:
 * - botão de "olho" para mostrar/ocultar senhas;
 * - asterisco nos rótulos de campos obrigatórios (atualizado quando o campo muda).
 */

const EYE_ICON = `
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
    <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
      d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/>
    <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <path class="eye-slash" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M4 4l16 16"/>
  </svg>`;

function addPasswordToggle(input) {
  if (input.dataset.passwordToggle) return;
  input.dataset.passwordToggle = 'true';

  const wrapper = document.createElement('div');
  wrapper.className = 'password-field';
  // Margens do campo passam para o contêiner, para o botão ficar centralizado no campo.
  const spacing = [...input.classList].filter((name) => /^m[tbxy]?-/.test(name));
  input.classList.remove(...spacing);
  wrapper.classList.add(...spacing);
  input.replaceWith(wrapper);
  wrapper.append(input);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'password-toggle';
  button.setAttribute('aria-label', 'Mostrar senha');
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-controls', input.id);
  button.innerHTML = EYE_ICON; // marcação estática, sem dados do usuário
  button.addEventListener('click', () => {
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    button.setAttribute('aria-pressed', String(!visible));
    button.setAttribute('aria-label', visible ? 'Mostrar senha' : 'Ocultar senha');
  });
  wrapper.append(button);

  // Ao limpar o formulário, a senha volta a ficar oculta.
  input.form?.addEventListener('reset', () => {
    input.type = 'password';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', 'Mostrar senha');
  });
}

/** Rótulo do campo: <label for> ou o <label> que envolve o campo. */
function labelOf(control) {
  return control.labels?.[0] ?? null;
}

/**
 * Em rótulos que envolvem o campo (<label>Barbeiro <select>), o texto é colocado num
 * <span> para que o asterisco fique na mesma linha da palavra, e não abaixo dela.
 */
function wrapLabelText(label) {
  const existing = label.querySelector(':scope > .field-label');
  if (existing) return existing;
  const span = document.createElement('span');
  span.className = 'field-label';
  const textNode = [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  if (textNode) {
    span.textContent = textNode.textContent.trim();
    textNode.replaceWith(span);
  } else {
    label.prepend(span);
  }
  return span;
}

function syncRequiredMark(control) {
  const label = labelOf(control);
  if (!label) return;
  const required = control.required && !control.disabled;
  const target = label.contains(control) ? wrapLabelText(label) : label;
  let mark = target.querySelector(':scope > .required-mark');
  if (required && !mark) {
    mark = document.createElement('span');
    mark.className = 'required-mark';
    mark.setAttribute('aria-hidden', 'true'); // o leitor de tela já anuncia "obrigatório"
    mark.textContent = '*';
    target.append(mark);
  } else if (!required && mark) {
    mark.remove();
  }
}

const CONTROLS = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea';

/** Aplica as melhorias em `root` e continua aplicando quando o DOM ou o `required` mudarem. */
export function enhanceForms(root = document) {
  const apply = (scope) => {
    scope.querySelectorAll?.('input[type="password"]').forEach(addPasswordToggle);
    scope.querySelectorAll?.(CONTROLS).forEach(syncRequiredMark);
  };
  apply(root);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        if (mutation.target.matches?.(CONTROLS)) syncRequiredMark(mutation.target);
      } else {
        mutation.addedNodes.forEach((node) => node.nodeType === Node.ELEMENT_NODE && apply(node));
      }
    }
  });
  observer.observe(root === document ? document.body : root, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['required', 'disabled'],
  });
}
