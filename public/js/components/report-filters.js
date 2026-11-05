import { api } from '../core/api.js';
import { el, setOptions } from '../core/dom.js';
import { addDaysIso, todayIso } from '../core/format.js';
import { notifyError } from '../core/notify.js';

/** Períodos rápidos oferecidos nos filtros do painel e dos relatórios. */
const PRESETS = Object.freeze([
  { value: 'ultimos-7', label: 'Últimos 7 dias' },
  { value: 'ultimos-30', label: 'Últimos 30 dias' },
  { value: 'este-mes', label: 'Este mês' },
  { value: 'mes-anterior', label: 'Mês anterior' },
  { value: 'ultimos-90', label: 'Últimos 90 dias' },
  { value: 'personalizado', label: 'Personalizado' },
]);

function presetRange(preset) {
  const hoje = todayIso();
  const [ano, mes] = hoje.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const ultimoDia = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  switch (preset) {
    case 'ultimos-7': return { inicio: addDaysIso(hoje, -6), fim: hoje };
    case 'ultimos-90': return { inicio: addDaysIso(hoje, -89), fim: hoje };
    case 'este-mes': return { inicio: `${ano}-${pad(mes)}-01`, fim: `${ano}-${pad(mes)}-${pad(ultimoDia(ano, mes))}` };
    case 'mes-anterior': {
      const y = mes === 1 ? ano - 1 : ano;
      const m = mes === 1 ? 12 : mes - 1;
      return { inicio: `${y}-${pad(m)}-01`, fim: `${y}-${pad(m)}-${pad(ultimoDia(y, m))}` };
    }
    default: return { inicio: addDaysIso(hoje, -29), fim: hoje };
  }
}

/**
 * Filtros de período (e de barbeiro, para o administrador) compartilhados pelo
 * painel e pelos relatórios. Chama `onChange(query)` sempre que algo muda.
 * @param {HTMLFormElement} form deve conter os campos periodo, inicio, fim e (opcional) barbeiroId
 * @param {{ usuario: object, onChange: (query: object) => void }} options
 */
export async function initReportFilters(form, { usuario, onChange }) {
  const { periodo, inicio, fim } = form.elements;
  const barbeiroField = form.querySelector('[data-filtro-barbeiro]');
  const customFields = form.querySelectorAll('[data-periodo-personalizado]');
  const isAdmin = usuario.perfil === 'administrador';

  periodo.replaceChildren(...PRESETS.map((p) => el('option', { value: p.value, text: p.label })));
  periodo.value = 'ultimos-30';

  if (isAdmin && barbeiroField) {
    try {
      const barbeiros = await api.get('/barbeiros');
      setOptions(form.elements.barbeiroId, barbeiros);
      form.elements.barbeiroId.prepend(new Option('Todos os barbeiros', '', true, true));
    } catch (error) {
      notifyError(error);
    }
  } else if (barbeiroField) {
    barbeiroField.remove();
  }

  const syncDates = () => {
    const personalizado = periodo.value === 'personalizado';
    customFields.forEach((field) => { field.hidden = !personalizado; });
    inicio.required = personalizado;
    fim.required = personalizado;
    if (!personalizado) {
      const range = presetRange(periodo.value);
      inicio.value = range.inicio;
      fim.value = range.fim;
    }
  };

  const query = () => ({
    inicio: inicio.value,
    fim: fim.value,
    barbeiroId: isAdmin ? form.elements.barbeiroId?.value : undefined,
  });

  const emit = () => {
    if (!inicio.value || !fim.value) return;
    if (inicio.value > fim.value) {
      fim.setCustomValidity('A data final deve ser igual ou posterior à inicial.');
      fim.reportValidity();
      return;
    }
    fim.setCustomValidity('');
    onChange(query());
  };

  periodo.addEventListener('change', () => {
    syncDates();
    if (periodo.value !== 'personalizado') emit();
  });
  inicio.addEventListener('change', emit);
  fim.addEventListener('change', emit);
  form.elements.barbeiroId?.addEventListener('change', emit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    emit();
  });

  syncDates();
  return { query, refresh: emit };
}
