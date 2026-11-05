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

/** Um "chip" com checkbox para cada serviço cadastrado. */
function renderServiceOptions(container, servicos) {
  container.replaceChildren(...servicos.map((servico) => {
    const id = `servico-${servico.id}`;
    return el('div', { className: 'chip chip-service' }, [
      el('input', { type: 'checkbox', name: 'servicoIds', value: servico.id, id }),
      el('label', { htmlFor: id }, [
        el('span', { text: servico.ativo ? servico.nome : `${servico.nome} (inativo)` }),
        el('span', { className: 'chip-meta', text: formatCurrency(servico.valor) }),
      ]),
    ]);
  }));
  if (!servicos.length) {
    container.append(el('p', { className: 'form-hint mb-0', text: 'Cadastre um serviço antes de adicionar barbeiros.' }));
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

function describeSchedule(barbeiro) {
  const dias = barbeiro.diasDisponiveis.map((dia) => WEEKDAY_LABELS[dia].slice(0, 3)).join(', ');
  return `${dias}, das ${barbeiro.horarioInicial} às ${barbeiro.horarioFinal}`;
}

if (await initAppShell('administrador')) {
  const form = byId('form-registro');
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
      { render: (b) => b.nome },
      { className: 'hide-sm table-muted', render: (b) => b.servicos.map((s) => s.nome).join(', ') },
      { className: 'hide-sm table-muted', render: describeSchedule },
      { render: (b) => statusBadge(b.ativo ? 'Ativo' : 'Inativo') },
    ],

    async beforeLoad() {
      try {
        renderServiceOptions(byId('barbeiro-servicos'), await api.get('/servicos'));
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

      setChecked(target, 'servicoIds', barbeiro?.servicoIds ?? []);
      setChecked(target, 'diasDisponiveis', barbeiro?.diasDisponiveis ?? []);
      byId('erro-dias').hidden = true;
      byId('erro-servicos').hidden = true;
    },

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
        servicoIds: checkedValues(target, 'servicoIds'),
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
