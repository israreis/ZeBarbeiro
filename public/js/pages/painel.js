import { api } from '../core/api.js';
import { initAppShell } from '../components/app-shell.js';
import { el } from '../core/dom.js';
import { formatCurrency, formatDate } from '../core/format.js';
import { notifyError } from '../core/notify.js';
import { initReportFilters } from '../components/report-filters.js';
import { renderKpis } from '../components/kpis.js';
import { barList, columnChart } from '../components/charts.js';

const DIA_CURTO = Object.freeze({
  segunda: 'Seg', terca: 'Ter', quarta: 'Qua', quinta: 'Qui', sexta: 'Sex', sabado: 'Sáb', domingo: 'Dom',
});
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function chartSlot(name) {
  return document.querySelector(`[data-chart="${name}"]`);
}

function render(report, { isAdmin }) {
  renderKpis(document.getElementById('kpis'), report);

  document.querySelector('[data-periodo-texto]').textContent = `${formatDate(report.periodo.inicio)} a ${formatDate(report.periodo.fim)}`;

  // Séries longas mostram rótulo a cada ~7 dias para não poluir o eixo.
  const labelEvery = Math.max(1, Math.ceil(report.porDia.length / 7));
  chartSlot('porDia').replaceChildren(columnChart({
    data: report.porDia.map((d) => ({
      label: formatDate(d.data).slice(0, 5),
      value: d.faturamento,
      title: `${formatDate(d.data)}: ${formatCurrency(d.faturamento)} (${plural(d.quantidade, 'atendimento', 'atendimentos')})`,
    })),
    format: formatCurrency,
    labelEvery,
    description: 'Faturamento de atendimentos concluídos em cada dia do período.',
  }));

  document.querySelector('[data-insights]').replaceChildren(
    ...report.insights.map((texto) => el('li', { text: texto })),
  );

  chartSlot('porServico').replaceChildren(barList({
    data: report.porServico.map((s) => ({
      label: s.nome, value: s.faturamento, detail: plural(s.quantidade, 'atendimento', 'atendimentos'),
    })),
    format: formatCurrency,
    description: 'Faturamento por serviço no período.',
  }));

  chartSlot('porDiaSemana').replaceChildren(columnChart({
    data: report.porDiaSemana.map((d) => ({ label: DIA_CURTO[d.dia], value: d.quantidade })),
    format: (n) => plural(n, 'atendimento', 'atendimentos'),
    valueFormat: (n) => String(n),
    showValues: true,
    description: 'Quantidade de atendimentos por dia da semana.',
  }));

  chartSlot('porHora').replaceChildren(columnChart({
    data: report.porHora.map((h) => ({ label: `${h.hora}h`, value: h.quantidade })),
    format: (n) => plural(n, 'atendimento', 'atendimentos'),
    valueFormat: (n) => String(n),
    showValues: true,
    description: 'Quantidade de atendimentos por horário de início.',
  }));

  if (isAdmin && !report.barbeiro) {
    chartSlot('porBarbeiro').replaceChildren(barList({
      data: report.porBarbeiro.map((b) => ({
        label: b.nome, value: b.faturamento, detail: plural(b.concluidos, 'concluído', 'concluídos'),
      })),
      format: formatCurrency,
      description: 'Faturamento por barbeiro no período.',
    }));
  }
  document.querySelectorAll('[data-somente-admin]').forEach((section) => {
    section.hidden = !(isAdmin && !report.barbeiro);
  });
}

const usuario = await initAppShell(['administrador', 'barbeiro']);
if (usuario) {
  const isAdmin = usuario.perfil === 'administrador';
  document.querySelector('[data-lead]').textContent = isAdmin
    ? 'Visão geral da barbearia: faturamento, movimento e desempenho da equipe.'
    : 'Seus números no período: faturamento, movimento e serviços mais pedidos.';
  const painel = document.getElementById('painel');

  const filtros = await initReportFilters(document.getElementById('form-filtros'), {
    usuario,
    onChange: async (query) => {
      painel.setAttribute('aria-busy', 'true');
      try {
        render(await api.get('/relatorios', query), { isAdmin });
      } catch (error) {
        notifyError(error);
      } finally {
        painel.removeAttribute('aria-busy');
      }
    },
  });
  filtros.refresh();
}
