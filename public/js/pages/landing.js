import { api } from '../core/api.js';
import { byId, modal, withBusy } from '../core/dom.js';
import {
  applyPhoneMask, isFormValid, rawValue, setMatchValidity, value,
} from '../core/forms.js';
import { notifyError, notifySuccess } from '../core/notify.js';
import { HOME_BY_ROLE, getSession, saveSession } from '../core/session.js';

function initLogin() {
  const form = byId('form-login');
  const submit = form.querySelector('[type="submit"]');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!isFormValid(form)) return;

    withBusy(submit, async () => {
      try {
        const session = await api.post('/auth/login', {
          email: value(form, 'email'),
          senha: rawValue(form, 'senha'),
        });
        saveSession(session, form.elements.lembrar.checked);
        window.location.assign(HOME_BY_ROLE[session.usuario.perfil]);
      } catch (error) {
        notifyError(error);
      }
    });
  });

  // Usuário já autenticado: o botão de acesso leva direto à sua área.
  const session = getSession();
  if (session) {
    const acesso = byId('btn-acesso');
    acesso.removeAttribute('data-bs-toggle');
    acesso.addEventListener('click', () => window.location.assign(HOME_BY_ROLE[session.usuario.perfil]));
  }
}

function initCadastro() {
  const form = byId('form-cadastro');
  const submit = form.querySelector('[type="submit"]');
  applyPhoneMask(form.elements.telefone);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    setMatchValidity(form, 'email', 'confirmarEmail', 'Os e-mails não coincidem.');
    setMatchValidity(form, 'senha', 'confirmarSenha', 'As senhas não coincidem.');
    if (!isFormValid(form)) return;

    withBusy(submit, async () => {
      try {
        const usuario = await api.post('/clientes', {
          nome: value(form, 'nome'),
          email: value(form, 'email'),
          senha: rawValue(form, 'senha'),
          telefone: value(form, 'telefone'),
          dataNascimento: value(form, 'dataNascimento'),
        });
        form.reset();
        byId('login-email').value = usuario.email;
        const cadastro = byId('modal-cadastro');
        cadastro.addEventListener('hidden.bs.modal', () => modal.show(byId('modal-login')), { once: true });
        modal.hide(cadastro);
        notifySuccess('Cadastro realizado com sucesso! Faça login para agendar.');
      } catch (error) {
        notifyError(error);
      }
    });
  });
}

initLogin();
initCadastro();
