import { addMinutes, minutesToTime, timeToMinutes, weekdayOf } from './time.js';

export const SLOT_MINUTES = 30;

export const STATUS = Object.freeze({
  AGENDADO: 'Agendado',
  AGENDADO_BARBEIRO: 'Agendado Barbeiro',
  BLOQUEADO: 'Bloqueado',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
});

/** Rótulo do status para exibição (relatórios e exportações). */
export function statusLabel(status) {
  return status === STATUS.AGENDADO_BARBEIRO ? 'Agendado pelo barbeiro' : status;
}

/** Status que ocupam o horário na agenda (cancelados liberam o horário). */
const OCCUPYING = new Set([STATUS.AGENDADO, STATUS.AGENDADO_BARBEIRO, STATUS.BLOQUEADO, STATUS.CONCLUIDO]);

function occupiesSlot(agendamento) {
  return OCCUPYING.has(agendamento.status);
}

/**
 * Gera os horários de início dos atendimentos dentro do expediente.
 * O último horário é aquele que TERMINA até o fim do expediente
 * (ex.: 16:00–19:00 gera 16:00 ... 18:30).
 */
export function generateSlots(horarioInicial, horarioFinal, slotMinutes = SLOT_MINUTES) {
  const start = timeToMinutes(horarioInicial);
  const end = timeToMinutes(horarioFinal);
  const slots = [];
  for (let minute = start; minute + slotMinutes <= end; minute += slotMinutes) {
    slots.push(minutesToTime(minute));
  }
  return slots;
}

export function slotEnd(horarioInicio) {
  return addMinutes(horarioInicio, SLOT_MINUTES);
}

export function worksOn(barbeiro, isoDate) {
  return barbeiro.diasDisponiveis.includes(weekdayOf(isoDate));
}

/** Agendamento que ocupa o horário informado, se houver. */
export function findOccupant(agendamentos, { barbeiroId, data, horario }) {
  return agendamentos.find((ag) => ag.barbeiroId === barbeiroId
    && ag.data === data
    && ag.horarioInicio === horario
    && occupiesSlot(ag));
}
