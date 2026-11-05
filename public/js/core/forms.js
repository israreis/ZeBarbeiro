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

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const MAX_CURRENCY_DIGITS = 8; // até R$ 999.999,99

/** Valor em reais (número) → texto exibido no campo com máscara, ex.: 49.9 → "R$ 49,90". */
export function formatCurrencyInput(amount) {
  return typeof amount === 'number' && Number.isFinite(amount) ? BRL.format(amount) : '';
}

/** Texto do campo com máscara → valor em reais (número), ex.: "R$ 1.234,50" → 1234.5. */
export function parseCurrency(text) {
  const digits = String(text ?? '').replace(/\D/g, '');
  return digits ? Number(digits) / 100 : 0;
}

/**
 * Máscara de moeda (R$) estilo caixa registradora: os dígitos entram pela direita,
 * como centavos. Ex.: digitar 4, 9, 9, 0 resulta em "R$ 49,90".
 */
export function applyCurrencyMask(input) {
  input.setAttribute('inputmode', 'numeric');
  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, MAX_CURRENCY_DIGITS);
    input.value = digits ? formatCurrencyInput(Number(digits) / 100) : '';
    input.setCustomValidity('');
  });
}
