import { api } from '../core/api.js';
import { byId, withBusy } from '../core/dom.js';
import {
  applyPhoneMask, isFormValid, rawValue, setMatchValidity, value,
} from '../core/forms.js';
import { todayIso } from '../core/format.js';
import { notifyError, notifySuccess } from '../core/notify.js';
import { ROLE_LABELS, initAppShell, refreshCurrentUser } from '../components/app-shell.js';

const PROFILE_FIELDS = ['nome', 'email', 'telefone', 'dataNascimento'];

function initPerfil(usuarioInicial) {
  const form = byId('form-perfil');
  const confirmarSenha = form.querySelector('[data-confirmar-senha]');
  const submit = form.querySelector('[type="submit"]');
  let usuario = usuarioInicial;

  applyPhoneMask(form.elements.telefone);
  form.elements.dataNascimento.max = todayIso();

  // A senha atual só é pedida quando o e-mail (login) muda.
  const emailMudou = () => value(form, 'email').toLowerCase() !== usuario.email;
  const syncConfirmacao = () => {
    const mudou = emailMudou();
    confirmarSenha.hidden = !mudou;
    form.elements.senhaAtual.required = mudou;
    if (!mudou) form.elements.senhaAtual.value = '';
  };

  const fill = () => {
    for (const field of PROFILE_FIELDS) form.elements[field].value = usuario[field] ?? '';
    syncConfirmacao();
  };

  form.elements.email.addEventListener('input', syncConfirmacao);
  form.addEventListener('reset', (event) => {
    event.preventDefault();
    fill();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!isFormValid(form)) return;

    withBusy(submit, async () => {
      try {
        const payload = Object.fromEntries(PROFILE_FIELDS.map((field) => [field, value(form, field)]));
        if (emailMudou()) payload.senhaAtual = rawValue(form, 'senhaAtual');
        usuario = await api.put('/auth/me', payload);
        refreshCurrentUser(usuario);
        fill();
        notifySuccess('Dados atualizados.');
      } catch (error) {
        notifyError(error);
      }
    });
  });

  fill();
}

function initSenha() {
  const form = byId('form-senha');
  const submit = form.querySelector('[type="submit"]');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    setMatchValidity(form, 'novaSenha', 'confirmarNovaSenha', 'A confirmação deve ser igual à nova senha.');
    if (!isFormValid(form)) return;

    withBusy(submit, async () => {
      try {
        await api.put('/auth/senha', {
          senhaAtual: rawValue(form, 'senhaAtual'),
          novaSenha: rawValue(form, 'novaSenha'),
        });
        form.reset();
        notifySuccess('Senha alterada. Outros dispositivos conectados foram desconectados.');
      } catch (error) {
        notifyError(error);
      }
    });
  });
}

const usuario = await initAppShell(null);
if (usuario) {
  document.querySelector('[data-perfil-descricao]').textContent = `Você acessa o sistema como ${ROLE_LABELS[usuario.perfil].toLowerCase()}.`;
  initPerfil(usuario);
  initSenha();
}
