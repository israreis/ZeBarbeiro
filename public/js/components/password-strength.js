import { el } from '../core/dom.js';

/**
 * Requisitos de senha forte. São os mesmos do servidor (server/schemas.js),
 * que é quem garante a regra; aqui servem para orientar enquanto a pessoa digita.
 */
export const PASSWORD_RULES = Object.freeze([
  { label: 'Pelo menos 8 caracteres', test: (s) => s.length >= 8 },
  { label: 'Uma letra maiúscula', test: (s) => /\p{Lu}/u.test(s) },
  { label: 'Uma letra minúscula', test: (s) => /\p{Ll}/u.test(s) },
  { label: 'Um número', test: (s) => /\d/.test(s) },
  { label: 'Um caractere especial (ex.: ! @ # $ %)', test: (s) => /[^\p{L}\d\s]/u.test(s) },
]);

/** Nível do medidor (0 a 3) conforme os requisitos atendidos. */
function strengthLevel(password) {
  if (!password) return 0;
  const met = PASSWORD_RULES.filter((rule) => rule.test(password)).length;
  if (met === PASSWORD_RULES.length) return 3;
  return met >= 3 ? 2 : 1;
}

const LEVEL_LABELS = ['', 'Senha fraca', 'Senha média', 'Senha forte'];

/**
 * Adiciona, logo abaixo do campo, o medidor de força e a lista de requisitos,
 * atualizados a cada tecla. Enquanto algum requisito não for atendido, o campo fica
 * inválido (o formulário não envia). Campo vazio e opcional é aceito.
 * @param {HTMLInputElement} input
 */
export function attachPasswordStrength(input) {
  if (input.dataset.passwordStrength) return;
  input.dataset.passwordStrength = 'true';

  const meter = el('div', { className: 'strength', attrs: { 'aria-hidden': 'true' } }, [
    el('span'), el('span'), el('span'),
  ]);
  const meterLabel = el('span', { className: 'strength-label', attrs: { 'aria-live': 'polite' } });
  const items = PASSWORD_RULES.map((rule) => {
    const status = el('span', { className: 'visually-hidden', text: 'pendente: ' });
    const item = el('li', { attrs: { 'data-ok': 'false' } }, [status, el('span', { text: rule.label })]);
    return { rule, item, status };
  });
  const listId = `${input.id || input.name}-requisitos`;
  const list = el('ul', { className: 'password-rules', id: listId }, items.map((i) => i.item));
  const container = el('div', { className: 'password-strength' }, [
    el('div', { className: 'strength-row' }, [meter, meterLabel]),
    list,
  ]);

  (input.closest('.password-field') ?? input).after(container);
  const describedBy = new Set((input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean));
  describedBy.add(listId);
  input.setAttribute('aria-describedby', [...describedBy].join(' '));

  const update = () => {
    const password = input.value;
    let allMet = true;
    for (const { rule, item, status } of items) {
      const ok = rule.test(password);
      allMet &&= ok;
      item.dataset.ok = String(ok);
      status.textContent = ok ? 'atendido: ' : 'pendente: ';
    }
    const level = strengthLevel(password);
    meter.dataset.level = String(level);
    meterLabel.textContent = LEVEL_LABELS[level];
    meterLabel.dataset.level = String(level);
    input.setCustomValidity(password && !allMet ? 'A senha não atende a todos os requisitos.' : '');
  };

  input.addEventListener('input', update);
  // Depois de limpar o formulário, o medidor volta ao estado inicial.
  input.form?.addEventListener('reset', () => setTimeout(update));
  update();
}
