import { api } from '../core/api.js';
import { initAppShell } from '../components/app-shell.js';
import {
  byId, el, renderLoading, renderRows, setOptions, withBusy,
} from '../core/dom.js';
import { isFormValid, value } from '../core/forms.js';
import { STATUS, formatCurrency, todayIso } from '../core/format.js';
import { notify, notifyError, notifySuccess } from '../core/notify.js';
import { statusBadge } from '../components/status-badge.js';
import { bindSlotSelection } from '../components/slot-selection.js';

const canBook = (slot) => !slot.agendamento && !slot.passado;
const canCancel = (slot) => slot.agendamento?.status === STATUS.AGENDADO && !slot.passado;

if (await initAppShell('cliente')) {
  const form = byId('form-agendar');
  const tbody = byId('tabela-agenda');
  const barbeiroSelect = form.elements.barbeiroId;
  const servicoSelect = form.elements.servicoId;
  let barbeiros = [];
  let agenda = null;

  const columns = [
    {
      className: 'col-select',
      render: (h) => el('input', {
        type: 'checkbox',
        className: 'form-check-input slot-checkbox',
        value: h.horario,
        disabled: !canBook(h) && !canCancel(h),
        attrs: { 'aria-label': `Selecionar ${h.horario}` },
      }),
    },
    { className: 'col-horario', render: (h) => h.horario },
    { render: (h) => h.agendamento?.barbeiro ?? '' },
    { className: 'hide-sm', render: (h) => h.agendamento?.servico?.nome ?? '' },
    { className: 'hide-sm', render: (h) => formatCurrency(h.agendamento?.servico?.valor) },
    { render: (h) => statusBadge(h.agendamento?.status ?? (h.passado ? 'Encerrado' : 'Livre')) },
  ];
  const selection = bindSlotSelection(tbody, document.querySelector('[data-selection-count]'));
  const showHint = (message) => {
    renderRows(tbody, [], columns, { emptyMessage: message });
    selection.refresh();
  };

  form.elements.data.min = todayIso();
  form.elements.data.value = todayIso();

  function updateServicos() {
    const barbeiro = barbeiros.find((b) => b.id === barbeiroSelect.value);
    setOptions(servicoSelect, barbeiro?.servicos ?? [], {
      placeholder: 'Escolha o serviço',
      label: (s) => `${s.nome} (${formatCurrency(s.valor)})`,
    });
  }

  async function load() {
    if (!isFormValid(form)) return;
    renderLoading(tbody, columns.length);
    try {
      agenda = await api.get('/agenda', { barbeiroId: value(form, 'barbeiroId'), data: value(form, 'data') });
      renderRows(tbody, agenda.horarios, columns, {
        emptyMessage: agenda.atende ? 'Nenhum horário disponível nesta data.' : 'O barbeiro não atende na data selecionada.',
      });
    } catch (error) {
      agenda = null;
      renderRows(tbody, [], columns, { emptyMessage: 'Não foi possível carregar os horários.' });
      notifyError(error);
    }
    selection.refresh();
  }

  function selectedSlots() {
    if (!agenda) return [];
    const horarios = new Set([...tbody.querySelectorAll('.slot-checkbox:checked')].map((input) => input.value));
    return agenda.horarios.filter((h) => horarios.has(h.horario));
  }

  async function book() {
    const slots = selectedSlots().filter(canBook);
    if (!slots.length) {
      notify('Marque pelo menos um horário livre na tabela.', 'error');
      return;
    }
    if (!value(form, 'servicoId')) {
      notify('Escolha o serviço antes de agendar.', 'error');
      servicoSelect.focus();
      return;
    }
    try {
      await api.post('/agendamentos', {
        barbeiroId: barbeiroSelect.value,
        servicoId: value(form, 'servicoId'),
        data: agenda.data,
        horarios: slots.map((s) => s.horario),
      });
      notifySuccess(slots.length === 1 ? 'Horário agendado.' : `${slots.length} horários agendados.`);
    } catch (error) {
      notifyError(error);
    }
    await load();
  }

  async function cancel() {
    const slots = selectedSlots().filter(canCancel);
    if (!slots.length) {
      notify('Marque pelo menos um agendamento seu para cancelar.', 'error');
      return;
    }
    if (!window.confirm(`Cancelar ${slots.length} agendamento(s)?`)) return;

    const results = await Promise.allSettled(
      slots.map((slot) => api.patch(`/agendamentos/${encodeURIComponent(slot.agendamento.id)}/cancelar`)),
    );
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) notifyError(failure.reason);
    else notifySuccess('Agendamento cancelado.');
    await load();
  }

  try {
    barbeiros = await api.get('/barbeiros');
    setOptions(barbeiroSelect, barbeiros, { placeholder: 'Escolha o barbeiro' });
    updateServicos();
  } catch (error) {
    notifyError(error);
  }
  showHint('Escolha o barbeiro e a data para ver os horários livres.');

  barbeiroSelect.addEventListener('change', () => {
    updateServicos();
    agenda = null;
    showHint('Clique em "Ver horários" para ver a agenda do barbeiro.');
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    withBusy(form.querySelector('[type="submit"]'), load);
  });
  const btnAgendar = byId('btn-agendar');
  const btnCancelar = byId('btn-cancelar');
  btnAgendar.addEventListener('click', () => withBusy(btnAgendar, book));
  btnCancelar.addEventListener('click', () => withBusy(btnCancelar, cancel));
}
