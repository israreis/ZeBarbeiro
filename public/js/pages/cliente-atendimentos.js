import { api } from '../core/api.js';
import { initAppShell } from '../components/app-shell.js';
import { initHistoryPage } from '../components/history-page.js';
import { el, withBusy } from '../core/dom.js';
import {
  STATUS, addDaysIso, formatDateLong, nowTime, todayIso,
} from '../core/format.js';
import { notifyError, notifySuccess } from '../core/notify.js';

/** Só agendamentos futuros feitos pelo próprio cliente podem ser cancelados (regra repetida no servidor). */
function isCancelavel(agendamento) {
  if (agendamento.status !== STATUS.AGENDADO) return false;
  const hoje = todayIso();
  return agendamento.data > hoje || (agendamento.data === hoje && agendamento.horarioInicio > nowTime());
}

function cancelButton(agendamento, reload) {
  if (!isCancelavel(agendamento)) return null;
  const button = el('button', { type: 'button', className: 'btn-table', text: 'Cancelar' });
  button.addEventListener('click', () => withBusy(button, async () => {
    const quando = `${formatDateLong(agendamento.data)} às ${agendamento.horarioInicio}`;
    if (!window.confirm(`Cancelar o agendamento de ${quando}?`)) return;
    try {
      await api.patch(`/agendamentos/${encodeURIComponent(agendamento.id)}/cancelar`);
      notifySuccess('Agendamento cancelado.');
      await reload();
    } catch (error) {
      notifyError(error);
    }
  }));
  return button;
}

if (await initAppShell('cliente')) {
  const hoje = todayIso();
  await initHistoryPage({
    columns: ['data', 'horario', 'barbeiro', 'servico', 'valor', 'status'],
    rowAction: cancelButton,
    range: { inicio: addDaysIso(hoje, -30), fim: addDaysIso(hoje, 60) },
  });
}
