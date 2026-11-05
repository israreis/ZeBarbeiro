import { el } from '../core/dom.js';

/** Rótulo exibido e variação de cor para cada status. */
const STATUS_STYLES = Object.freeze({
  Agendado: { label: 'Agendado', variant: 'agendado' },
  'Agendado Barbeiro': { label: 'Agendado pelo barbeiro', variant: 'agendado' },
  Bloqueado: { label: 'Bloqueado', variant: 'bloqueado' },
  Concluído: { label: 'Concluído', variant: 'concluido' },
  Cancelado: { label: 'Cancelado', variant: 'cancelado' },
  Livre: { label: 'Livre', variant: 'livre' },
  Encerrado: { label: 'Encerrado', variant: 'encerrado' },
  Ativo: { label: 'Ativo', variant: 'concluido' },
  Inativo: { label: 'Inativo', variant: 'encerrado' },
});

/** Selo colorido com o status (agendamento, horário ou cadastro). */
export function statusBadge(status) {
  const style = STATUS_STYLES[status] ?? { label: status, variant: 'livre' };
  return el('span', { className: `status status-${style.variant}`, text: style.label });
}
