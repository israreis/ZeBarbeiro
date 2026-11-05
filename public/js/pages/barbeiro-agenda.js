import { api } from '../core/api.js';
import { initAppShell } from '../components/app-shell.js';
import {
  byId, el, renderLoading, renderRows, withBusy,
} from '../core/dom.js';
import { isFormValid, value } from '../core/forms.js';
import {
  STATUS, formatCurrency, formatDate, todayIso,
} from '../core/format.js';
import { notify, notifyError, notifySuccess } from '../core/notify.js';

const CONCLUIVEIS = [STATUS.AGENDADO, STATUS.AGENDADO_BARBEIRO];
const CANCELAVEIS = [STATUS.BLOQUEADO, STATUS.AGENDADO_BARBEIRO];

/** Um horário pode ser selecionado se houver alguma ação possível sobre ele. */
function isSelectable(slot) {
  const status = slot.agendamento?.status;
  if (!status) return !slot.passado;
  return CONCLUIVEIS.includes(status) || CANCELAVEIS.includes(status);
}

if (await initAppShell('barbeiro')) {
  const form = byId('form-agenda');
  const tbody = byId('tabela-agenda');
  let agenda = null;

  const columns = [
    { render: () => formatDate(agenda.data) },
    { render: (h) => h.agendamento?.cliente ?? '' },
    { className: 'hide-sm', render: (h) => h.agendamento?.servico?.nome ?? '' },
    { className: 'hide-sm', render: (h) => formatCurrency(h.agendamento?.servico?.valor) },
    { render: (h) => h.horario },
    { render: (h) => h.agendamento?.status ?? (h.passado ? '—' : 'Livre') },
    {
      className: 'col-acoes',
      render: (h) => el('input', {
        type: 'checkbox',
        className: 'form-check-input slot-checkbox',
        value: h.horario,
        disabled: !isSelectable(h),
        attrs: { 'aria-label': `Selecionar ${h.horario}` },
      }),
    },
  ];

  form.elements.data.value = todayIso();

  async function load() {
    if (!isFormValid(form)) return;
    renderLoading(tbody, columns.length);
    try {
      agenda = await api.get('/agenda', { data: value(form, 'data') });
      renderRows(tbody, agenda.horarios, columns, {
        emptyMessage: agenda.atende ? 'Nenhum horário nesta data.' : 'Você não atende na data selecionada.',
      });
    } catch (error) {
      agenda = null;
      renderRows(tbody, [], columns, { emptyMessage: 'Não foi possível carregar a agenda.' });
      notifyError(error);
    }
  }

  function selectedSlots() {
    if (!agenda) return [];
    const horarios = new Set([...tbody.querySelectorAll('.slot-checkbox:checked')].map((input) => input.value));
    return agenda.horarios.filter((h) => horarios.has(h.horario));
  }

  /**
   * Executa uma ação sobre os horários selecionados, informando quais foram ignorados
   * por não se aplicarem à ação, e recarrega a agenda ao final.
   */
  async function runAction({ accepts, execute, success, invalidMessage }) {
    const selecionados = selectedSlots();
    if (!selecionados.length) {
      notify('Selecione pelo menos um horário.', 'error');
      return;
    }
    const validos = selecionados.filter(accepts);
    const ignorados = selecionados.filter((slot) => !accepts(slot)).map((slot) => slot.horario);
    if (!validos.length) {
      notify(invalidMessage, 'error');
      return;
    }

    try {
      await execute(validos);
      notifySuccess(success);
      if (ignorados.length) notify(`Horários ignorados: ${ignorados.join(', ')}. ${invalidMessage}`, 'info');
    } catch (error) {
      notifyError(error);
    }
    await load();
  }

  const reserve = (tipo, success) => runAction({
    accepts: (slot) => !slot.agendamento && !slot.passado,
    execute: (slots) => api.post('/agendamentos', { data: agenda.data, horarios: slots.map((s) => s.horario), tipo }),
    success,
    invalidMessage: 'Apenas horários livres e futuros podem ser reservados.',
  });

  /** Atualiza cada agendamento individualmente; continua mesmo se algum falhar. */
  async function patchEach(slots, action) {
    const results = await Promise.allSettled(
      slots.map((slot) => api.patch(`/agendamentos/${encodeURIComponent(slot.agendamento.id)}/${action}`)),
    );
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
  }

  const actions = {
    'btn-incluir': () => reserve(STATUS.AGENDADO_BARBEIRO, 'Atendimento(s) incluído(s) com sucesso!'),
    'btn-bloquear': () => reserve(STATUS.BLOQUEADO, 'Horário(s) bloqueado(s) com sucesso!'),
    'btn-concluir': () => runAction({
      accepts: (slot) => CONCLUIVEIS.includes(slot.agendamento?.status),
      execute: (slots) => patchEach(slots, 'concluir'),
      success: 'Atendimento(s) concluído(s) com sucesso!',
      invalidMessage: 'Apenas atendimentos agendados podem ser concluídos.',
    }),
    'btn-cancelar': () => runAction({
      accepts: (slot) => CANCELAVEIS.includes(slot.agendamento?.status),
      execute: (slots) => patchEach(slots, 'cancelar'),
      success: 'Cancelamento(s) realizado(s) com sucesso!',
      invalidMessage: 'Apenas bloqueios e atendimentos incluídos por você podem ser cancelados.',
    }),
  };
  for (const [id, action] of Object.entries(actions)) {
    const button = byId(id);
    button.addEventListener('click', () => withBusy(button, action));
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    withBusy(form.querySelector('[type="submit"]'), load);
  });

  await load();
}
