/**
 * Utilitários puros de data/hora.
 * Datas trafegam sempre no formato ISO (AAAA-MM-DD) e horários como HH:MM,
 * evitando os problemas de fuso e de comparação de strings DD/MM/AAAA.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const WEEKDAYS = Object.freeze([
  'domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado',
]);

export function isValidIsoDate(value) {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isValidTime(value) {
  return typeof value === 'string' && TIME.test(value);
}

export function timeToMinutes(value) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(totalMinutes) {
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function addMinutes(time, minutes) {
  return minutesToTime(timeToMinutes(time) + minutes);
}

/** Dia da semana de uma data ISO, independente do fuso do servidor. */
export function weekdayOf(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

/** Data (AAAA-MM-DD) e horário (HH:MM) atuais no fuso informado. */
export function nowInTimeZone(timeZone, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map(({ type, value }) => [type, value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Indica se o horário (data + hora) já passou em relação a "agora". */
export function isPast(date, time, now) {
  return date < now.date || (date === now.date && time <= now.time);
}

/** Idade completa (em anos) de quem nasceu em `birthIso`, na data `todayIso`. */
export function ageOn(birthIso, todayIso) {
  const [by, bm, bd] = birthIso.split('-').map(Number);
  const [ty, tm, td] = todayIso.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}
