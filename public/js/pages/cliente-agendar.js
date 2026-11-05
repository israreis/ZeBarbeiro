import { api } from '../core/api.js';
import { initAppShell } from '../components/app-shell.js';
import {
  byId, el, setOptions, withBusy,
} from '../core/dom.js';
import { isFormValid, value } from '../core/forms.js';
import { formatCurrency, formatDateLong, todayIso } from '../core/format.js';
import { notifyAfterRedirect, notifyError } from '../core/notify.js';
import { avatar } from '../components/avatar.js';

const QUALQUER_BARBEIRO = '';

/** Cartão de um barbeiro com os horários livres como opções selecionáveis. */
function barberCard({ barbeiro, atende, horarios }) {
  let resumo = `${horarios.length} ${horarios.length === 1 ? 'horário livre' : 'horários livres'}`;
  if (!atende) resumo = 'Não atende nesta data';
  else if (!horarios.length) resumo = 'Agenda cheia nesta data';

  const slots = horarios.map((horario) => {
    const id = `slot-${barbeiro.id}-${horario.replace(':', '')}`;
    return el('div', { className: 'chip chip-slot' }, [
      el('input', {
        type: 'radio', name: 'horario', id, value: horario, dataset: { barbeiroId: barbeiro.id },
      }),
      el('label', { htmlFor: id, text: horario }),
    ]);
  });

  return el('article', { className: `panel barber-card${horarios.length ? '' : ' is-unavailable'}` }, [
    el('header', { className: 'barber-card-head' }, [
      avatar(barbeiro, 'lg'),
      el('div', {}, [
        el('h2', { className: 'barber-card-name', text: barbeiro.nome }),
        el('p', { className: 'barber-card-meta', text: resumo }),
      ]),
    ]),
    horarios.length
      ? el('fieldset', { className: 'slot-grid' }, [
        el('legend', { className: 'visually-hidden', text: `Horários livres com ${barbeiro.nome}` }),
        ...slots,
      ])
      : null,
  ].filter(Boolean));
}

function emptyState(message) {
  return el('div', { className: 'panel empty-state' }, [el('p', { className: 'mb-0', text: message })]);
}

const usuario = await initAppShell('cliente');
if (usuario) {
  const form = byId('form-busca');
  const results = byId('disponibilidade');
  const bar = byId('barra-confirmacao');
  const confirmButton = byId('btn-confirmar');
  let barbeiros = [];
  let disponibilidade = null;

  form.elements.data.min = todayIso();
  form.elements.data.value = todayIso();

  /** Mostra no seletor de barbeiro apenas quem realiza o serviço escolhido. */
  function updateBarbeiroOptions() {
    const servicoId = form.elements.servicoId.value;
    const select = form.elements.barbeiroId;
    const atual = select.value;
    const opcoes = barbeiros.filter((b) => !servicoId || b.servicos.some((s) => s.id === servicoId));
    select.replaceChildren(
      el('option', { value: QUALQUER_BARBEIRO, text: 'Qualquer barbeiro' }),
      ...opcoes.map((b) => el('option', { value: b.id, text: b.nome })),
    );
    select.value = opcoes.some((b) => b.id === atual) ? atual : QUALQUER_BARBEIRO;
  }

  function selectedSlot() {
    const input = results.querySelector('input[name="horario"]:checked');
    if (!input || !disponibilidade) return null;
    const item = disponibilidade.barbeiros.find((b) => b.barbeiro.id === input.dataset.barbeiroId);
    return { barbeiro: item.barbeiro, horario: input.value };
  }

  function updateBar() {
    const slot = selectedSlot();
    bar.hidden = !slot;
    if (!slot) return;
    const { servico, data } = disponibilidade;
    bar.querySelector('[data-resumo]').replaceChildren(
      el('strong', { text: `${servico.nome} com ${slot.barbeiro.nome}` }),
      el('span', { text: `${formatDateLong(data)} às ${slot.horario}, ${formatCurrency(servico.valor)}` }),
    );
  }

  async function search() {
    bar.hidden = true;
    if (!form.elements.servicoId.value) {
      results.replaceChildren(emptyState('Escolha um serviço para ver os barbeiros e horários livres.'));
      return;
    }
    if (!isFormValid(form)) return;

    results.setAttribute('aria-busy', 'true');
    try {
      disponibilidade = await api.get('/disponibilidade', {
        servicoId: value(form, 'servicoId'),
        barbeiroId: value(form, 'barbeiroId'),
        data: value(form, 'data'),
      });
      const cards = disponibilidade.barbeiros.map(barberCard);
      results.replaceChildren(...(cards.length
        ? cards
        : [emptyState('Nenhum barbeiro realiza este serviço no momento.')]));
      if (cards.length && disponibilidade.barbeiros.every((b) => !b.horarios.length)) {
        results.prepend(emptyState('Não há horários livres nesta data. Experimente outro dia.'));
      }
    } catch (error) {
      disponibilidade = null;
      results.replaceChildren(emptyState('Não foi possível carregar os horários. Tente novamente.'));
      notifyError(error);
    } finally {
      results.removeAttribute('aria-busy');
    }
  }

  /** Confirma o agendamento e leva o cliente para "Meus agendamentos". */
  async function confirm() {
    const slot = selectedSlot();
    if (!slot) return;
    try {
      await api.post('/agendamentos', {
        barbeiroId: slot.barbeiro.id,
        servicoId: disponibilidade.servico.id,
        data: disponibilidade.data,
        horarios: [slot.horario],
      });
    } catch (error) {
      notifyError(error);
      await search(); // o horário pode ter sido ocupado por outra pessoa
      return;
    }
    notifyAfterRedirect(`Agendado: ${formatDateLong(disponibilidade.data)} às ${slot.horario} com ${slot.barbeiro.nome}.`);
    window.location.assign('cliente-agendamentos.html');
  }

  results.addEventListener('change', updateBar);
  confirmButton.addEventListener('click', () => withBusy(confirmButton, confirm));
  form.elements.servicoId.addEventListener('change', () => {
    updateBarbeiroOptions();
    search();
  });
  form.elements.barbeiroId.addEventListener('change', search);
  form.elements.data.addEventListener('change', search);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    withBusy(form.querySelector('[type="submit"]'), search);
  });

  try {
    const [servicos, lista] = await Promise.all([api.get('/servicos'), api.get('/barbeiros')]);
    barbeiros = lista;
    const oferecidos = servicos.filter((s) => barbeiros.some((b) => b.servicos.some((bs) => bs.id === s.id)));
    setOptions(form.elements.servicoId, oferecidos, {
      placeholder: 'Escolha o serviço',
      label: (s) => `${s.nome} (${formatCurrency(s.valor)})`,
    });
    updateBarbeiroOptions();
  } catch (error) {
    notifyError(error);
  }
  await search();
}
