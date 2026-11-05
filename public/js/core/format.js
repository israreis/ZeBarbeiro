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
