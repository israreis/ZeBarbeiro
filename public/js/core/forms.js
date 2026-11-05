/**
 * Helpers de formulário: leitura de campos, máscara de telefone e validação nativa.
 */

/** Aplica a máscara (99)99999-9999 / (99)9999-9999 enquanto o usuário digita. */
export function applyPhoneMask(input) {
  input.setAttribute('inputmode', 'tel');
  input.setAttribute('maxlength', '14');
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').slice(0, 11);
    const split = digits.length > 10 ? 7 : 6;
    let masked = digits;
    if (digits.length > 2) masked = `(${digits.slice(0, 2)})${digits.slice(2, split)}`;
    if (digits.length > split) masked += `-${digits.slice(split)}`;
    input.value = masked;
  });
}

/** Usa a validação nativa do HTML (required, type="email" etc.) e mostra as mensagens. */
export function isFormValid(form) {
  if (form.checkValidity()) return true;
  form.reportValidity();
  return false;
}

export function rawValue(form, name) {
  return form.elements.namedItem(name)?.value ?? '';
}

export function value(form, name) {
  return rawValue(form, name).trim();
}

export function checkedValues(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

/**
 * Marca o campo de confirmação como inválido quando difere do original
 * (ex.: confirmação de e-mail/senha). Chame antes de `isFormValid`.
 */
export function setMatchValidity(form, name, confirmName, message) {
  const confirm = form.elements.namedItem(confirmName);
  if (!confirm) return;
  confirm.setCustomValidity(rawValue(form, name) === rawValue(form, confirmName) ? '' : message);
}
