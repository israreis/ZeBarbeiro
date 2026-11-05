import { el } from '../core/dom.js';

/**
 * Gráficos simples em HTML/CSS (sem bibliotecas): colunas verticais e barras horizontais.
 * Os valores entram via textContent e as alturas/larguras via propriedades CSS,
 * compatível com a Content-Security-Policy do servidor.
 */

/**
 * Gráfico de colunas (ex.: faturamento por dia, atendimentos por dia da semana).
 * @param {object} options
 * @param {Array<{ label: string, value: number, title?: string }>} options.data
 * @param {(value: number) => string} options.format formatação do valor (dica e rótulo)
 * @param {string} options.description resumo para leitores de tela
 * @param {number} [options.labelEvery] exibe o rótulo do eixo a cada N colunas (séries longas)
 * @param {boolean} [options.showValues] mostra o valor acima de cada coluna
 * @param {(value: number) => string} [options.valueFormat] formato curto do valor exibido na coluna
 */
export function columnChart({
  data, format, description, labelEvery = 1, showValues = false, valueFormat = format,
}) {
  const max = Math.max(...data.map((d) => d.value), 0);
  if (!max) return emptyChart('Sem dados no período.');

  const columns = data.map((item, i) => {
    const bar = el('div', { className: 'chart-col-bar' });
    bar.style.setProperty('--size', `${(item.value / max) * 100}%`);
    const valueLabel = showValues && item.value
      ? el('span', { className: 'chart-col-value', text: valueFormat(item.value) })
      : null;
    return el('div', {
      className: 'chart-col',
      title: item.title ?? `${item.label}: ${format(item.value)}`,
    }, [
      el('div', { className: 'chart-col-track' }, [valueLabel, bar].filter(Boolean)),
      el('span', { className: 'chart-col-label', text: i % labelEvery === 0 ? item.label : '' }),
    ]);
  });

  const chart = el('div', { className: 'chart-columns', attrs: { role: 'img', 'aria-label': description } }, columns);
  chart.style.setProperty('--count', String(data.length));
  return chart;
}

/**
 * Barras horizontais com rótulo e valor (ex.: serviços, barbeiros).
 * @param {object} options
 * @param {Array<{ label: string, value: number, detail?: string }>} options.data
 * @param {(value: number) => string} options.format
 * @param {string} options.description
 */
export function barList({ data, format, description }) {
  const max = Math.max(...data.map((d) => d.value), 0);
  if (!max) return emptyChart('Sem dados no período.');

  return el('ul', { className: 'chart-bars', attrs: { 'aria-label': description } }, data.map((item) => {
    const fill = el('span', { className: 'chart-bar-fill' });
    fill.style.setProperty('--size', `${(item.value / max) * 100}%`);
    return el('li', { className: 'chart-bar' }, [
      el('span', { className: 'chart-bar-label', text: item.label }),
      el('span', { className: 'chart-bar-track' }, [fill]),
      el('span', { className: 'chart-bar-value' }, [
        el('strong', { text: format(item.value) }),
        item.detail ? el('small', { text: item.detail }) : null,
      ].filter(Boolean)),
    ]);
  }));
}

function emptyChart(message) {
  return el('p', { className: 'chart-empty', text: message });
}
