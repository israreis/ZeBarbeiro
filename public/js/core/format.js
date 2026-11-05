/** Formatação e constantes de apresentação compartilhadas entre as páginas. */

export const WEEKDAY_LABELS = Object.freeze({
  domingo: 'Domingo',
  segunda: 'Segunda-feira',
  terca: 'Terça-feira',
  quarta: 'Quarta-feira',
  quinta: 'Quinta-feira',
  sexta: 'Sexta-feira',
  sabado: 'Sábado',
});

export const STATUS = Object.freeze({
  AGENDADO: 'Agendado',
  AGENDADO_BARBEIRO: 'Agendado Barbeiro',
  BLOQUEADO: 'Bloqueado',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
});

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatCurrency(value) {
  return typeof value === 'number' ? currency.format(value) : '';
}

/** AAAA-MM-DD → DD/MM/AAAA */
export function formatDate(isoDate) {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

const longDate = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC',
});

/** AAAA-MM-DD → "sexta-feira, 06/11" */
export function formatDateLong(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return longDate.format(new Date(Date.UTC(year, month - 1, day)));
}

/** Data de hoje no fuso do navegador, no formato AAAA-MM-DD. */
export function todayIso() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Primeiro e último dia do mês corrente (filtro padrão dos históricos). */
export function currentMonthRange() {
  const today = todayIso();
  const [year, month] = today.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const prefix = today.slice(0, 8);
  return { inicio: `${prefix}01`, fim: `${prefix}${String(lastDay).padStart(2, '0')}` };
}

/** Soma dias a uma data ISO. */
export function addDaysIso(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Horário atual (HH:MM) no fuso do navegador. */
export function nowTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** Idade completa (em anos) de quem nasceu em `birthIso`, na data `todayIso`. */
export function ageOn(birthIso, todayIsoDate) {
  const [by, bm, bd] = birthIso.split('-').map(Number);
  const [ty, tm, td] = todayIsoDate.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}
