import { api } from '../core/api.js';
import { byId, withBusy } from '../core/dom.js';
import {
  applyPhoneMask, isFormValid, rawValue, setMatchValidity, value,
} from '../core/forms.js';
import { todayIso } from '../core/format.js';
import { notifyError, notifySuccess } from '../core/notify.js';
import { ROLE_LABELS, initAppShell, refreshCurrentUser } from '../components/app-shell.js';
import { avatar } from '../components/avatar.js';
import { confirmDialog } from '../components/confirm-dialog.js';
import { prepareSquarePhoto } from '../core/image.js';
import { attachPasswordStrength } from '../components/password-strength.js';

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

/** Foto do barbeiro: enviada assim que escolhida, sem precisar salvar o formulário. */
function initFoto(usuarioInicial) {
  const container = document.querySelector('[data-foto-barbeiro]');
  const preview = container.querySelector('[data-photo-preview]');
  const input = byId('perfil-foto');
  const removeButton = container.querySelector('[data-photo-remove]');
  const chooseLabel = container.querySelector('label[for="perfil-foto"]');
  let usuario = usuarioInicial;

  const render = () => {
    preview.replaceChildren(avatar(usuario, 'lg'));
    removeButton.hidden = !usuario.fotoUrl;
    chooseLabel.textContent = usuario.fotoUrl ? 'Trocar foto' : 'Adicionar foto';
  };

  const apply = (atualizado) => {
    usuario = atualizado;
    refreshCurrentUser(usuario);
    render();
  };

  input.addEventListener('change', async () => {
    const [file] = input.files;
    input.value = '';
    if (!file) return;
    container.setAttribute('aria-busy', 'true');
    try {
      apply(await api.upload('/auth/me/foto', await prepareSquarePhoto(file)));
      notifySuccess('Foto atualizada.');
    } catch (error) {
      notifyError(error);
    } finally {
      container.removeAttribute('aria-busy');
    }
  });

  removeButton.addEventListener('click', () => withBusy(removeButton, async () => {
    const confirmado = await confirmDialog({
      title: 'Remover sua foto?',
      message: 'Os clientes passarão a ver suas iniciais no lugar da foto.',
      confirmLabel: 'Remover foto',
      cancelLabel: 'Manter foto',
      danger: true,
    });
    if (!confirmado) return;
    try {
      await api.delete('/auth/me/foto');
      apply({ ...usuario, fotoUrl: null });
      notifySuccess('Foto removida.');
    } catch (error) {
      notifyError(error);
    }
  }));

  container.hidden = false;
  render();
}

function initSenha() {
  const form = byId('form-senha');
  const submit = form.querySelector('[type="submit"]');
  attachPasswordStrength(form.elements.novaSenha);

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
  if (usuario.perfil === 'barbeiro') initFoto(usuario);
  initSenha();
}
