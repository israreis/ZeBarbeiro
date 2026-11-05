import { api } from '../core/api.js';
import { initAppShell } from '../components/app-shell.js';
import {
  byId, el, modal, renderLoading, renderRows, setOptions, withBusy,
} from '../core/dom.js';
import { applyPhoneMask, isFormValid, value } from '../core/forms.js';
import { STATUS, formatCurrency, formatDate, todayIso } from '../core/format.js';
import { notify, notifyError, notifySuccess } from '../core/notify.js';
import { statusBadge } from '../components/status-badge.js';
import { bindSlotSelection } from '../components/slot-selection.js';
import { confirmDialog } from '../components/confirm-dialog.js';

const STATUS_INCLUSAO = STATUS.AGENDADO_BARBEIRO;

/**
 * Ações sobre os horários marcados na tabela. Cada uma informa quais horários aceita;
 * o botão só fica habilitado quando há pelo menos um horário compatível selecionado.
 */
const SELECTION_ACTIONS = {
  bloquear: {
    accepts: (slot) => !slot.agendamento && !slot.passado,
    success: (n) => (n === 1 ? 'Horário bloqueado.' : `${n} horários bloqueados.`),
    skipped: 'Só horários livres e futuros podem ser bloqueados.',
  },
  cancelar: {
    accepts: (slot) => [STATUS.BLOQUEADO, STATUS.AGENDADO_BARBEIRO].includes(slot.agendamento?.status),
    confirm: (slots) => ({
      title: slots.length === 1 ? 'Desfazer este horário?' : `Desfazer ${slots.length} horários?`,
      message: `Horários: ${slots.map((s) => s.horario).join(', ')}. Bloqueios e atendimentos incluídos por você serão cancelados e o horário ficará livre.`,
      confirmLabel: 'Desfazer',
      danger: true,
    }),
    success: () => 'Bloqueio ou atendimento desfeito.',
    skipped: 'Só é possível desfazer bloqueios e atendimentos incluídos por você.',
  },
  concluir: {
    accepts: (slot) => [STATUS.AGENDADO, STATUS.AGENDADO_BARBEIRO].includes(slot.agendamento?.status),
    success: (n) => (n === 1 ? 'Atendimento concluído.' : `${n} atendimentos concluídos.`),
    skipped: 'Só atendimentos agendados podem ser concluídos.',
  },
};

const isSelectable = (slot) => Object.values(SELECTION_ACTIONS).some((action) => action.accepts(slot));

/**
 * Modal de inclusão manual de atendimento: marca na agenda do barbeiro logado um horário
 * para um cliente identificado apenas pelo nome (não precisa ter cadastro).
 */
function createNovoAtendimento({ usuario, onCreated }) {
  const modalElement = byId('modal-atendimento');
  const form = byId('form-atendimento');
  const submit = form.querySelector('[type="submit"]');
  let servicos = [];

  applyPhoneMask(form.elements.clienteTelefone);
  form.elements.data.min = todayIso();
  form.querySelector('[data-resumo-status]').textContent = 'Agendado pelo barbeiro';

  /** Serviços ativos que o barbeiro logado oferece. */
  async function loadServicos() {
    const barbeiros = await api.get('/barbeiros');
    servicos = barbeiros.find((b) => b.id === usuario.id)?.servicos ?? [];
    setOptions(form.elements.servicoId, servicos, {
      placeholder: servicos.length ? 'Escolha o serviço' : 'Nenhum serviço ativo vinculado a você',
    });
  }

  /** Lista apenas os horários livres e futuros da data escolhida. */
  async function loadHorarios() {
    const select = form.elements.horario;
    const data = form.elements.data.value;
    if (!data) {
      setOptions(select, [], { placeholder: 'Escolha a data' });
      return;
    }
    setOptions(select, [], { placeholder: 'Carregando...' });
    try {
      const agenda = await api.get('/agenda', { data });
      const livres = agenda.horarios.filter((h) => !h.agendamento && !h.passado);
      let placeholder = 'Escolha o horário';
      if (!agenda.atende) placeholder = 'Você não atende nesta data';
      else if (!livres.length) placeholder = 'Nenhum horário livre nesta data';
      setOptions(select, livres, { placeholder, value: (h) => h.horario, label: (h) => h.horario });
    } catch (error) {
      setOptions(select, [], { placeholder: 'Não foi possível carregar os horários' });
      notifyError(error);
    }
  }

  function syncResumo() {
    const servico = servicos.find((s) => s.id === form.elements.servicoId.value);
    form.querySelector('[data-resumo-valor]').textContent = servico ? formatCurrency(servico.valor) : '—';
  }

  form.elements.data.addEventListener('change', loadHorarios);
  form.elements.servicoId.addEventListener('change', syncResumo);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!isFormValid(form)) return;

    const payload = {
      tipo: STATUS_INCLUSAO,
      data: form.elements.data.value,
      horarios: [form.elements.horario.value],
      servicoId: form.elements.servicoId.value,
      clienteNome: value(form, 'clienteNome'),
      clienteTelefone: value(form, 'clienteTelefone') || undefined,
    };

    withBusy(submit, async () => {
      try {
        await api.post('/agendamentos', payload);
        modal.hide(modalElement);
        notifySuccess(`Atendimento incluído em ${formatDate(payload.data)} às ${payload.horarios[0]}.`);
        await onCreated(payload.data);
      } catch (error) {
        notifyError(error);
        await loadHorarios(); // o horário pode ter sido ocupado por outra pessoa
      }
    });
  });

  let servicosCarregados = false;
  return {
    async open(data) {
      form.reset();
      syncResumo();
      form.elements.data.value = data && data >= todayIso() ? data : todayIso();
      modal.show(modalElement);
      try {
        if (!servicosCarregados) {
          await loadServicos();
          servicosCarregados = true;
        } else {
          form.elements.servicoId.selectedIndex = 0;
        }
      } catch (error) {
        notifyError(error);
      }
      await loadHorarios();
    },
  };
}

const usuario = await initAppShell('barbeiro');
if (usuario) {
  const form = byId('form-agenda');
  const tbody = byId('tabela-agenda');
  const actionButtons = {
    bloquear: byId('btn-bloquear'),
    cancelar: byId('btn-cancelar'),
    concluir: byId('btn-concluir'),
  };
  let agenda = null;

  const columns = [
    {
      className: 'col-select',
      render: (h) => el('input', {
        type: 'checkbox',
        className: 'form-check-input slot-checkbox',
        value: h.horario,
        disabled: !isSelectable(h),
        attrs: { 'aria-label': `Selecionar ${h.horario}` },
      }),
    },
    { className: 'col-horario', render: (h) => h.horario },
    { render: (h) => h.agendamento?.cliente ?? '' },
    { className: 'hide-sm', render: (h) => h.agendamento?.servico?.nome ?? '' },
    { className: 'hide-sm', render: (h) => formatCurrency(h.agendamento?.servico?.valor) },
    { render: (h) => statusBadge(h.agendamento?.status ?? (h.passado ? 'Encerrado' : 'Livre')) },
  ];

  function selectedSlots() {
    if (!agenda) return [];
    const horarios = new Set([...tbody.querySelectorAll('.slot-checkbox:checked')].map((input) => input.value));
    return agenda.horarios.filter((h) => horarios.has(h.horario));
  }

  function updateActionButtons() {
    const selecionados = selectedSlots();
    for (const [name, button] of Object.entries(actionButtons)) {
      button.disabled = !selecionados.some(SELECTION_ACTIONS[name].accepts);
    }
  }

  const selection = bindSlotSelection(tbody, document.querySelector('[data-selection-count]'));
  tbody.addEventListener('change', updateActionButtons);
  tbody.addEventListener('click', updateActionButtons);

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
    selection.refresh();
    updateActionButtons();
  }

  /** Executa uma ação sobre os horários compatíveis e informa os que foram ignorados. */
  async function runAction(name, execute) {
    const action = SELECTION_ACTIONS[name];
    const selecionados = selectedSlots();
    const validos = selecionados.filter(action.accepts);
    const ignorados = selecionados.filter((slot) => !action.accepts(slot)).map((slot) => slot.horario);
    if (!validos.length) {
      notify(action.skipped, 'error');
      return;
    }
    if (action.confirm && !(await confirmDialog(action.confirm(validos)))) return;
    try {
      await execute(validos);
      notifySuccess(action.success(validos.length));
      if (ignorados.length) notify(`Ignorados: ${ignorados.join(', ')}. ${action.skipped}`, 'info');
    } catch (error) {
      notifyError(error);
    }
    await load();
  }

  /** Atualiza cada agendamento; continua mesmo se algum falhar e informa o primeiro erro. */
  async function patchEach(slots, operation) {
    const results = await Promise.allSettled(
      slots.map((slot) => api.patch(`/agendamentos/${encodeURIComponent(slot.agendamento.id)}/${operation}`)),
    );
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
  }

  const executors = {
    bloquear: (slots) => api.post('/agendamentos', {
      data: agenda.data, horarios: slots.map((s) => s.horario), tipo: STATUS.BLOQUEADO,
    }),
    cancelar: (slots) => patchEach(slots, 'cancelar'),
    concluir: (slots) => patchEach(slots, 'concluir'),
  };
  for (const [name, button] of Object.entries(actionButtons)) {
    // Reavalia os botões só depois que withBusy reabilitar o botão clicado.
    button.addEventListener('click', () => withBusy(button, () => runAction(name, executors[name]))
      .then(updateActionButtons));
  }

  const novoAtendimento = createNovoAtendimento({
    usuario,
    onCreated: async (data) => {
      form.elements.data.value = data;
      await load();
    },
  });
  byId('btn-novo-atendimento').addEventListener('click', () => novoAtendimento.open(form.elements.data.value));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    withBusy(form.querySelector('[type="submit"]'), load);
  });

  form.elements.data.value = todayIso();
  await load();
}
