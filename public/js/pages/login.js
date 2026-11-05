import { api } from '../core/api.js';
import { byId, withBusy } from '../core/dom.js';
import { isFormValid, rawValue, value } from '../core/forms.js';
import { HOME_BY_ROLE, getSession, saveSession } from '../core/session.js';
import { bindPasswordToggles, errorMessage, setFormError } from '../components/auth-form.js';

const session = getSession();
if (session) {
  // Já autenticado: vai direto para a área do usuário.
  window.location.replace(HOME_BY_ROLE[session.usuario.perfil]);
} else {
  const form = byId('form-login');
  const submit = form.querySelector('[type="submit"]');
  bindPasswordToggles(form);

  // E-mail informado na URL (ex.: vindo do cadastro) já vem preenchido.
  const emailFromUrl = new URLSearchParams(window.location.search).get('email');
  if (emailFromUrl) {
    form.elements.email.value = emailFromUrl;
    form.elements.senha.focus();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    setFormError(form, null);
    if (!isFormValid(form)) return;

    withBusy(submit, async () => {
      submit.textContent = 'Entrando...';
      try {
        const novaSessao = await api.post('/auth/login', {
          email: value(form, 'email'),
          senha: rawValue(form, 'senha'),
        });
        saveSession(novaSessao, form.elements.lembrar.checked);
        window.location.assign(HOME_BY_ROLE[novaSessao.usuario.perfil]);
      } catch (error) {
        setFormError(form, errorMessage(error));
        form.elements.senha.select();
        submit.textContent = 'Entrar';
      }
    });
  });
}
