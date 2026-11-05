/**
 * Comportamentos compartilhados pelas páginas de login e cadastro.
 */

/** Mostra (ou esconde, com `null`) a mensagem de erro no topo do formulário. */
export function setFormError(form, message) {
  const alert = form.querySelector('[data-form-alert]');
  alert.textContent = message ?? '';
  alert.hidden = !message;
}

/** Mensagem amigável para erros da API ou de rede. */
export function errorMessage(error) {
  if (error?.name === 'ApiError') return error.message;
  console.error(error);
  return 'Ocorreu um erro inesperado. Tente novamente.';
}
