import { api } from '../core/api.js';
import { initAppShell } from '../components/app-shell.js';
import {
  byId, renderLoading, renderRows, setOptions, withBusy,
} from '../core/dom.js';
import { isFormValid, value } from '../core/forms.js';
import { formatCurrency, todayIso } from '../core/format.js';
import { notifyError } from '../core/notify.js';
import { statusBadge } from '../components/status-badge.js';

const COLUMNS = [
  { className: 'col-horario', render: (h) => h.horario },
  { render: (h) => h.agendamento?.cliente ?? '' },
  { className: 'hide-sm', render: (h) => h.agendamento?.servico?.nome ?? '' },
  { className: 'hide-sm', render: (h) => formatCurrency(h.agendamento?.servico?.valor) },
  { render: (h) => statusBadge(h.agendamento?.status ?? (h.passado ? 'Encerrado' : 'Livre')) },
];

if (await initAppShell('administrador')) {
  const form = byId('form-agenda');
  const tbody = byId('tabela-agenda');
  form.elements.data.value = todayIso();

  try {
    setOptions(form.elements.barbeiroId, await api.get('/barbeiros'), { placeholder: 'Escolha o barbeiro' });
  } catch (error) {
    notifyError(error);
  }

  renderRows(tbody, [], COLUMNS, { emptyMessage: 'Escolha o barbeiro e a data para ver a agenda.' });

  async function search() {
    if (!isFormValid(form)) return;
    renderLoading(tbody, COLUMNS.length);
    try {
      const agenda = await api.get('/agenda', { barbeiroId: value(form, 'barbeiroId'), data: value(form, 'data') });
      const emptyMessage = agenda.atende
        ? 'Nenhum horário disponível nesta data.'
        : 'O barbeiro não atende na data selecionada.';
      renderRows(tbody, agenda.horarios, COLUMNS, { emptyMessage });
    } catch (error) {
      renderRows(tbody, [], COLUMNS, { emptyMessage: 'Não foi possível carregar a agenda.' });
      notifyError(error);
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    withBusy(form.querySelector('[type="submit"]'), search);
  });
}
