import { el } from '../core/dom.js';
import { formatCurrency } from '../core/format.js';

const integer = new Intl.NumberFormat('pt-BR');
const percent = (value) => `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

/** Variação em relação ao período anterior; `invert` quando cair é bom (ex.: cancelamentos). */
function delta(atual, anterior, invert = false) {
  if (!anterior) return { text: 'Sem dados no período anterior', tone: 'neutral' };
  const value = (atual - anterior) / anterior;
  if (Math.abs(value) < 0.005) return { text: 'Estável vs. período anterior', tone: 'neutral' };
  const good = invert ? value < 0 : value > 0;
  return {
    text: `${value > 0 ? '+' : '-'}${percent(Math.abs(value))} vs. período anterior`,
    tone: good ? 'up' : 'down',
  };
}

/** Cartões com os indicadores principais do relatório. */
export function renderKpis(container, { resumo, resumoAnterior }) {
  const cards = [
    {
      label: 'Faturamento',
      value: formatCurrency(resumo.faturamento),
      ...delta(resumo.faturamento, resumoAnterior.faturamento),
    },
    {
      label: 'Atendimentos concluídos',
      value: integer.format(resumo.concluidos),
      ...delta(resumo.concluidos, resumoAnterior.concluidos),
    },
    {
      label: 'Ticket médio',
      value: formatCurrency(resumo.ticketMedio),
      ...delta(resumo.ticketMedio, resumoAnterior.ticketMedio),
    },
    {
      label: 'Taxa de cancelamento',
      value: percent(resumo.taxaCancelamento),
      ...delta(resumo.taxaCancelamento, resumoAnterior.taxaCancelamento, true),
    },
  ];
  container.replaceChildren(...cards.map((card) => el('article', { className: 'kpi' }, [
    el('p', { className: 'kpi-label', text: card.label }),
    el('p', { className: 'kpi-value', text: card.value }),
    el('p', { className: `kpi-delta kpi-delta-${card.tone}`, text: card.text }),
  ])));
}
