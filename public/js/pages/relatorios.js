import { api, download } from '../core/api.js';
import { initAppShell } from '../components/app-shell.js';
import { renderRows, withBusy } from '../core/dom.js';
import { formatCurrency, formatDate } from '../core/format.js';
import { notifyError, notifySuccess } from '../core/notify.js';
import { initReportFilters } from '../components/report-filters.js';
import { renderKpis } from '../components/kpis.js';
import { statusBadge } from '../components/status-badge.js';

const integer = new Intl.NumberFormat('pt-BR');

const usuario = await initAppShell(['administrador', 'barbeiro']);
if (usuario) {
  const isAdmin = usuario.perfil === 'administrador';
  document.querySelector('[data-lead]').textContent = isAdmin
    ? 'Consulte os atendimentos de todos os barbeiros e exporte em PDF ou Excel.'
    : 'Consulte seus atendimentos e exporte em PDF ou Excel.';

  let ultimaConsulta = null;

  const colunasAtendimentos = (mostrarBarbeiro) => [
    { render: (a) => formatDate(a.data) },
    { className: 'col-horario', render: (a) => a.horario },
    ...(mostrarBarbeiro ? [{ render: (a) => a.barbeiro }] : []),
    { render: (a) => a.cliente || '—' },
    { className: 'hide-sm', render: (a) => a.servico || '—' },
    { render: (a) => statusBadge(a.status) },
    { className: 'text-end', render: (a) => (a.servico ? formatCurrency(a.valor) : '—') },
  ];

  const colunasBarbeiros = [
    { render: (b) => b.nome },
    { className: 'text-end', render: (b) => integer.format(b.agendamentos) },
    { className: 'text-end hide-sm', render: (b) => integer.format(b.concluidos) },
    { className: 'text-end hide-sm', render: (b) => integer.format(b.cancelados) },
    { className: 'text-end hide-sm', render: (b) => formatCurrency(b.ticketMedio) },
    { className: 'text-end col-horario', render: (b) => formatCurrency(b.faturamento) },
  ];

  function render(report) {
    const visaoGeral = isAdmin && !report.barbeiro;
    renderKpis(document.getElementById('kpis'), report);
    document.querySelector('[data-periodo-texto]').textContent = `${formatDate(report.periodo.inicio)} a ${formatDate(report.periodo.fim)}`;
    document.querySelector('[data-total]').textContent = `(${integer.format(report.atendimentos.length)})`;
    document.querySelectorAll('[data-somente-admin]').forEach((element) => { element.hidden = !visaoGeral; });

    if (visaoGeral) renderRows(document.getElementById('tabela-barbeiros'), report.porBarbeiro, colunasBarbeiros);
    renderRows(document.getElementById('tabela-atendimentos'), report.atendimentos, colunasAtendimentos(visaoGeral), {
      emptyMessage: 'Nenhum atendimento no período selecionado.',
    });
  }

  const filtros = await initReportFilters(document.getElementById('form-filtros'), {
    usuario,
    onChange: async (query) => {
      try {
        ultimaConsulta = query;
        render(await api.get('/relatorios', query));
      } catch (error) {
        notifyError(error);
      }
    },
  });

  const exportar = (formato, button) => withBusy(button, async () => {
    const textoOriginal = button.textContent;
    button.textContent = 'Gerando...';
    try {
      await download(`/relatorios/${formato}`, ultimaConsulta ?? filtros.query());
      notifySuccess(formato === 'pdf' ? 'PDF gerado.' : 'Planilha gerada.');
    } catch (error) {
      notifyError(error);
    } finally {
      button.textContent = textoOriginal;
    }
  });
  const pdfButton = document.getElementById('btn-pdf');
  const excelButton = document.getElementById('btn-excel');
  pdfButton.addEventListener('click', () => exportar('pdf', pdfButton));
  excelButton.addEventListener('click', () => exportar('xlsx', excelButton));

  filtros.refresh();
}
