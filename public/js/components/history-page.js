import { api } from '../core/api.js';
import {
  byId, renderLoading, renderRows, setOptions, withBusy,
} from '../core/dom.js';
import { isFormValid, value } from '../core/forms.js';
import { currentMonthRange, formatCurrency, formatDate } from '../core/format.js';
import { notifyError } from '../core/notify.js';

const COLUMN_DEFINITIONS = Object.freeze({
  data: { className: 'col-data', render: (ag) => formatDate(ag.data) },
  cliente: { className: 'col-cliente', render: (ag) => ag.cliente ?? '—' },
  barbeiro: { className: 'col-barbeiro', render: (ag) => ag.barbeiro ?? '—' },
  servico: { className: 'col-servico hide-sm', render: (ag) => ag.servico?.nome ?? '—' },
  valor: { className: 'col-valor hide-sm', render: (ag) => formatCurrency(ag.servico?.valor) },
  horario: { className: 'col-horario', render: (ag) => ag.horarioInicio },
  status: { className: 'col-status', render: (ag) => ag.status },
});

/**
 * Página de histórico de atendimentos, compartilhada por administrador, barbeiro e cliente.
 * O escopo dos dados (quais atendimentos o usuário pode ver) é garantido pela API.
 * @param {object} options
 * @param {string[]} options.columns colunas exibidas (chaves de COLUMN_DEFINITIONS)
 * @param {boolean} [options.barberFilter] exibe o filtro de barbeiro (administrador)
 */
export async function initHistoryPage({ columns, barberFilter = false }) {
  const form = byId('form-historico');
  const tbody = byId('tabela-historico');
  const columnDefs = columns.map((key) => COLUMN_DEFINITIONS[key]);

  const { inicio, fim } = currentMonthRange();
  form.elements.inicio.value = inicio;
  form.elements.fim.value = fim;

  if (barberFilter) {
    try {
      const barbeiros = await api.get('/barbeiros');
      setOptions(form.elements.barbeiroId, barbeiros);
      form.elements.barbeiroId.prepend(new Option('Todos os barbeiros', '', true, true));
    } catch (error) {
      notifyError(error);
    }
  }

  async function search() {
    if (!isFormValid(form)) return;
    renderLoading(tbody, columnDefs.length);
    try {
      const agendamentos = await api.get('/agendamentos', {
        inicio: value(form, 'inicio'),
        fim: value(form, 'fim'),
        situacao: form.elements.situacao.value,
        barbeiroId: barberFilter ? value(form, 'barbeiroId') : undefined,
      });
      renderRows(tbody, agendamentos, columnDefs, { emptyMessage: 'Nenhum atendimento encontrado no período.' });
    } catch (error) {
      renderRows(tbody, [], columnDefs, { emptyMessage: 'Não foi possível carregar os atendimentos.' });
      notifyError(error);
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    withBusy(form.querySelector('[type="submit"]'), search);
  });
  form.elements.situacao.forEach((radio) => radio.addEventListener('change', () => search()));

  await search();
}
