import { api } from '../core/api.js';
import { initAppShell } from '../components/app-shell.js';
import { initCrudPage } from '../components/crud-page.js';
import { byId, setOptions } from '../core/dom.js';
import {
  applyPhoneMask, checkedValues, rawValue, selectedValues, setMatchValidity, value,
} from '../core/forms.js';
import { WEEKDAY_LABELS } from '../core/format.js';
import { notifyError } from '../core/notify.js';
import { statusBadge } from '../components/status-badge.js';

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

function describeSchedule(barbeiro) {
  const dias = barbeiro.diasDisponiveis.map((dia) => WEEKDAY_LABELS[dia].slice(0, 3)).join(', ');
  return `${dias}, das ${barbeiro.horarioInicial} às ${barbeiro.horarioFinal}`;
}

if (await initAppShell('administrador')) {
  const form = byId('form-registro');
  applyPhoneMask(form.elements.telefone);

  await initCrudPage({
    resource: '/barbeiros',
    titles: { create: 'Novo barbeiro', edit: 'Editar barbeiro' },
    messages: { created: 'Barbeiro cadastrado.', updated: 'Barbeiro atualizado.' },
    columns: [
      { render: (b) => b.nome },
      { className: 'hide-sm table-muted', render: (b) => b.servicos.map((s) => s.nome).join(', ') },
      { className: 'hide-sm table-muted', render: describeSchedule },
      { render: (b) => statusBadge(b.ativo ? 'Ativo' : 'Inativo') },
    ],

    async beforeLoad() {
      try {
        setOptions(form.elements.servicoIds, await api.get('/servicos'), {
          label: (s) => (s.ativo ? s.nome : `${s.nome} (inativo)`),
        });
      } catch (error) {
        notifyError(error);
      }
    },

    fillForm(target, barbeiro) {
      toggleCreateOnlyFields(target, !barbeiro);
      for (const field of ['nome', 'email', 'telefone', 'dataNascimento']) {
        target.elements[field].value = barbeiro?.[field] ?? '';
      }
      target.elements.ativo.value = String(barbeiro?.ativo ?? true);
      target.elements.horarioInicial.value = barbeiro?.horarioInicial ?? DEFAULT_SCHEDULE.horarioInicial;
      target.elements.horarioFinal.value = barbeiro?.horarioFinal ?? DEFAULT_SCHEDULE.horarioFinal;

      const servicoIds = new Set(barbeiro?.servicoIds ?? []);
      [...target.elements.servicoIds.options].forEach((option) => { option.selected = servicoIds.has(option.value); });
      const dias = new Set(barbeiro?.diasDisponiveis ?? []);
      target.querySelectorAll('input[name="diasDisponiveis"]').forEach((input) => { input.checked = dias.has(input.value); });
    },

    readForm(target, barbeiro) {
      const isCreate = !barbeiro;
      if (isCreate) {
        setMatchValidity(target, 'email', 'confirmarEmail', 'Os e-mails não coincidem.');
        setMatchValidity(target, 'senha', 'confirmarSenha', 'As senhas não coincidem.');
      }

      const servicos = target.elements.servicoIds;
      servicos.setCustomValidity(selectedValues(servicos).length ? '' : 'Selecione pelo menos um serviço.');
      const primeiroDia = target.querySelector('input[name="diasDisponiveis"]');
      primeiroDia.setCustomValidity(
        checkedValues(target, 'diasDisponiveis').length ? '' : 'Selecione pelo menos um dia de atendimento.',
      );
      const fim = target.elements.horarioFinal;
      fim.setCustomValidity(value(target, 'horarioFinal') > value(target, 'horarioInicial')
        ? '' : 'O horário final deve ser posterior ao inicial.');

      const payload = {
        nome: value(target, 'nome'),
        email: value(target, 'email'),
        telefone: value(target, 'telefone'),
        dataNascimento: value(target, 'dataNascimento'),
        ativo: target.elements.ativo.value === 'true',
        servicoIds: selectedValues(servicos),
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
