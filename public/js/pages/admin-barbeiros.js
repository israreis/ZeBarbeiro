import { api } from '../core/api.js';
import { initAppShell } from '../components/app-shell.js';
import { initCrudPage } from '../components/crud-page.js';
import { byId, el } from '../core/dom.js';
import {
  applyPhoneMask, checkedValues, isFormValid, rawValue, setMatchValidity, value,
} from '../core/forms.js';
import { WEEKDAY_LABELS, formatCurrency } from '../core/format.js';
import { notifyError } from '../core/notify.js';
import { statusBadge } from '../components/status-badge.js';
import { avatar, personLabel } from '../components/avatar.js';
import { prepareSquarePhoto } from '../core/image.js';
import { attachPasswordStrength } from '../components/password-strength.js';

const DEFAULT_SCHEDULE = { horarioInicial: '08:00', horarioFinal: '18:00' };

/** Campos exibidos apenas no cadastro (confirmações) ficam ocultos e desabilitados na edição. */
function toggleCreateOnlyFields(form, isCreate) {
  form.querySelectorAll('[data-only="create"]').forEach((wrapper) => {
    wrapper.hidden = !isCreate;
    wrapper.querySelectorAll('input').forEach((input) => { input.disabled = !isCreate; });
  });
  const senha = form.elements.senha;
  senha.required = isCreate;
  byId('label-senha').textContent = isCreate ? 'Senha' : 'Nova senha (opcional)';
}

/** Um "chip" com checkbox para cada serviço ativo. */
function renderServiceOptions(container, servicos) {
  container.replaceChildren(...servicos.map((servico) => {
    const id = `servico-${servico.id}`;
    return el('div', { className: 'chip chip-service' }, [
      el('input', { type: 'checkbox', name: 'servicoIds', value: servico.id, id }),
      el('label', { htmlFor: id }, [
        el('span', { text: servico.nome }),
        el('span', { className: 'chip-meta', text: formatCurrency(servico.valor) }),
      ]),
    ]);
  }));
  if (!servicos.length) {
    container.append(el('p', {
      className: 'form-hint mb-0', text: 'Cadastre ou ative um serviço antes de adicionar barbeiros.',
    }));
  }
}

/** Exibe a mensagem do grupo (dias/serviços) quando nenhuma opção foi marcada. */
function validateGroup(form, name, errorId) {
  const ok = checkedValues(form, name).length > 0;
  byId(errorId).hidden = ok;
  return ok;
}

function setChecked(form, name, values) {
  const selected = new Set(values);
  form.querySelectorAll(`input[name="${name}"]`).forEach((input) => { input.checked = selected.has(input.value); });
}

/**
 * Campo de foto do formulário: mantém a imagem escolhida (já recortada) até o
 * barbeiro ser salvo, quando ela é enviada numa requisição própria.
 */
function createPhotoField(form) {
  const preview = form.querySelector('[data-photo-preview]');
  const input = byId('barbeiro-foto');
  const removeButton = form.querySelector('[data-photo-remove]');
  let state = { nome: '', fotoUrl: null, novaFoto: null, remover: false };
  let objectUrl = null;

  function render() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = state.novaFoto ? URL.createObjectURL(state.novaFoto) : null;
    const fotoUrl = objectUrl ?? (state.remover ? null : state.fotoUrl);
    preview.replaceChildren(avatar({ nome: state.nome || '?', fotoUrl }, 'lg'));
    removeButton.hidden = !fotoUrl;
  }

  input.addEventListener('change', async () => {
    const [file] = input.files;
    input.value = '';
    if (!file) return;
    try {
      state = { ...state, novaFoto: await prepareSquarePhoto(file), remover: false };
      render();
    } catch (error) {
      notifyError(error);
    }
  });

  removeButton.addEventListener('click', () => {
    state = { ...state, novaFoto: null, remover: true };
    render();
  });

  form.elements.nome.addEventListener('input', () => {
    state.nome = form.elements.nome.value;
    if (!state.novaFoto && (state.remover || !state.fotoUrl)) render();
  });

  return {
    reset(barbeiro) {
      state = {
        nome: barbeiro?.nome ?? '', fotoUrl: barbeiro?.fotoUrl ?? null, novaFoto: null, remover: false,
      };
      render();
    },
    /** Envia ou remove a foto conforme o que foi escolhido no formulário. */
    async persist(barbeiro) {
      const path = `/barbeiros/${encodeURIComponent(barbeiro.id)}/foto`;
      if (state.novaFoto) await api.upload(path, state.novaFoto);
      else if (state.remover && barbeiro.fotoUrl) await api.delete(path);
      state = { ...state, novaFoto: null, remover: false };
    },
  };
}

function describeSchedule(barbeiro) {
  const dias = barbeiro.diasDisponiveis.map((dia) => WEEKDAY_LABELS[dia].slice(0, 3)).join(', ');
  return `${dias}, das ${barbeiro.horarioInicial} às ${barbeiro.horarioFinal}`;
}

if (await initAppShell('administrador')) {
  // Na edição a nova senha é opcional: vazia, o campo é aceito.
  attachPasswordStrength(byId('barbeiro-senha'));
  const form = byId('form-registro');
  const photo = createPhotoField(form);
  // Serviços inativos não aparecem no formulário, mas os vínculos já existentes são preservados
  // ao salvar (assim, se o serviço for reativado, o barbeiro continua oferecendo-o).
  let servicosInativos = new Set();
  applyPhoneMask(form.elements.telefone);

  // Some a mensagem de erro do grupo assim que o usuário marca uma opção.
  form.addEventListener('change', (event) => {
    if (event.target.name === 'diasDisponiveis') validateGroup(form, 'diasDisponiveis', 'erro-dias');
    if (event.target.name === 'servicoIds') validateGroup(form, 'servicoIds', 'erro-servicos');
  });

  await initCrudPage({
    resource: '/barbeiros',
    titles: { create: 'Novo barbeiro', edit: 'Editar barbeiro' },
    messages: { created: 'Barbeiro cadastrado.', updated: 'Barbeiro atualizado.' },
    columns: [
      { render: (b) => personLabel(b) },
      { className: 'hide-sm table-muted', render: (b) => b.servicos.map((s) => s.nome).join(', ') },
      { className: 'hide-sm table-muted', render: describeSchedule },
      { render: (b) => statusBadge(b.ativo ? 'Ativo' : 'Inativo') },
    ],

    async beforeLoad() {
      try {
        const servicos = await api.get('/servicos');
        servicosInativos = new Set(servicos.filter((s) => !s.ativo).map((s) => s.id));
        renderServiceOptions(byId('barbeiro-servicos'), servicos.filter((s) => s.ativo));
      } catch (error) {
        notifyError(error);
      }
    },

    fillForm(target, barbeiro) {
      toggleCreateOnlyFields(target, !barbeiro);
      photo.reset(barbeiro);
      for (const field of ['nome', 'email', 'telefone', 'dataNascimento']) {
        target.elements[field].value = barbeiro?.[field] ?? '';
      }
      target.elements.ativo.value = String(barbeiro?.ativo ?? true);
      target.elements.horarioInicial.value = barbeiro?.horarioInicial ?? DEFAULT_SCHEDULE.horarioInicial;
      target.elements.horarioFinal.value = barbeiro?.horarioFinal ?? DEFAULT_SCHEDULE.horarioFinal;

      setChecked(target, 'servicoIds', barbeiro?.servicoIds ?? []);
      setChecked(target, 'diasDisponiveis', barbeiro?.diasDisponiveis ?? []);
      byId('erro-dias').hidden = true;
      byId('erro-servicos').hidden = true;
    },

    afterSave: (barbeiro) => photo.persist(barbeiro),

    readForm(target, barbeiro) {
      const isCreate = !barbeiro;
      if (isCreate) {
        setMatchValidity(target, 'email', 'confirmarEmail', 'Os e-mails não coincidem.');
        setMatchValidity(target, 'senha', 'confirmarSenha', 'As senhas não coincidem.');
      }

      const fim = target.elements.horarioFinal;
      fim.setCustomValidity(value(target, 'horarioFinal') > value(target, 'horarioInicial')
        ? '' : 'O horário final deve ser posterior ao inicial.');

      if (!isFormValid(target)) return null;
      const diasOk = validateGroup(target, 'diasDisponiveis', 'erro-dias');
      const servicosOk = validateGroup(target, 'servicoIds', 'erro-servicos');
      if (!diasOk || !servicosOk) return null;

      const payload = {
        nome: value(target, 'nome'),
        email: value(target, 'email'),
        telefone: value(target, 'telefone'),
        dataNascimento: value(target, 'dataNascimento'),
        ativo: target.elements.ativo.value === 'true',
        servicoIds: [
          ...checkedValues(target, 'servicoIds'),
          ...(barbeiro?.servicoIds ?? []).filter((id) => servicosInativos.has(id)),
        ],
        diasDisponiveis: checkedValues(target, 'diasDisponiveis'),
        horarioInicial: value(target, 'horarioInicial'),
        horarioFinal: value(target, 'horarioFinal'),
      };
      const senha = rawValue(target, 'senha');
      if (isCreate) payload.senha = senha;
      else if (senha) payload.novaSenha = senha;
      return payload;
    },
  });
}
