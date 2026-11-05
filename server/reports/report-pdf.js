import fs from 'node:fs';
import { PdfDocument } from './pdf-document.js';
import { statusLabel } from '../domain/agenda.js';

/** Identidade visual do site aplicada ao PDF (cores de public/css/base.css). */
const COLOR = Object.freeze({
  espresso: '#1b130e',
  walnut: '#251a13',
  brass: '#c9a063',
  brassDeep: '#9c7944',
  ivory: '#f3e9dc',
  sand: '#bfae9a',
  ink: '#2a1d15',
  muted: '#7a6a5a',
  paper: '#faf6f1',
  line: '#e6dccf',
  sage: '#4f7a4a',
  brick: '#a8503f',
});

const MARGIN = 40;
const FOOTER_SPACE = 48;
const LOGO = fs.readFileSync(new URL('./assets/logo.jpg', import.meta.url));

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const intFmt = new Intl.NumberFormat('pt-BR');
const pct = (value) => `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const dateBr = (iso) => iso.split('-').reverse().join('/');

function deltaText(atual, anterior, { invert = false } = {}) {
  if (!anterior) return { text: 'sem dados no período anterior', color: COLOR.muted };
  const delta = (atual - anterior) / anterior;
  if (Math.abs(delta) < 0.005) return { text: 'estável vs. período anterior', color: COLOR.muted };
  const good = invert ? delta < 0 : delta > 0;
  return {
    text: `${delta > 0 ? '+' : '-'}${pct(Math.abs(delta))} vs. período anterior`,
    color: good ? COLOR.sage : COLOR.brick,
  };
}

/**
 * Gera o PDF do relatório de atendimentos.
 * @param {object} report resultado de relatoriosService.gerar
 * @param {{ mostrarBarbeiros: boolean }} options exibe colunas/tabelas por barbeiro (visão geral do administrador)
 */
export function buildReportPdf(report, { mostrarBarbeiros }) {
  const doc = new PdfDocument();
  const contentWidth = doc.width - MARGIN * 2;
  let y = 0;

  const subtitulo = report.barbeiro ? report.barbeiro.nome : 'Todos os barbeiros';
  const periodo = `${dateBr(report.periodo.inicio)} a ${dateBr(report.periodo.fim)}`;

  function firstPageHeader() {
    doc.rect(0, 0, doc.width, 96, { fill: COLOR.espresso });
    doc.rect(0, 96, doc.width, 3, { fill: COLOR.brass });
    doc.image(LOGO, MARGIN, 18, 38, 59);
    doc.text('Zé Barbeiro', MARGIN + 52, 26, { font: 'Times-Bold', size: 22, color: COLOR.ivory });
    doc.text('Relatório de atendimentos', MARGIN + 53, 54, { size: 10, color: COLOR.brass });
    doc.text(periodo, MARGIN, 30, {
      font: 'Helvetica-Bold', size: 11, color: COLOR.ivory, align: 'right', width: contentWidth,
    });
    doc.text(subtitulo, MARGIN, 48, { size: 9.5, color: COLOR.sand, align: 'right', width: contentWidth });
    y = 122;
  }

  function continuationHeader() {
    doc.rect(0, 0, doc.width, 40, { fill: COLOR.espresso });
    doc.rect(0, 40, doc.width, 2, { fill: COLOR.brass });
    doc.text('Zé Barbeiro', MARGIN, 13, { font: 'Times-Bold', size: 13, color: COLOR.ivory });
    doc.text(`Relatório de atendimentos  |  ${periodo}`, MARGIN, 15, {
      size: 9, color: COLOR.sand, align: 'right', width: contentWidth,
    });
    y = 62;
  }

  function newPage() {
    doc.addPage();
    if (doc.pageCount === 1) firstPageHeader();
    else continuationHeader();
  }

  /** Garante espaço vertical; se não houver, abre nova página. Retorna true se quebrou. */
  function ensureSpace(height) {
    if (y + height <= doc.height - FOOTER_SPACE) return false;
    newPage();
    return true;
  }

  /** Título de seção; reserva espaço para o início do conteúdo, evitando título órfão no fim da página. */
  function sectionTitle(title) {
    ensureSpace(32 + 20 + 18 * 3);
    doc.text(title, MARGIN, y, { font: 'Times-Bold', size: 14, color: COLOR.ink });
    doc.rect(MARGIN, y + 20, 28, 2, { fill: COLOR.brass });
    y += 32;
  }

  function kpis() {
    const { resumo, resumoAnterior } = report;
    const cards = [
      {
        label: 'Faturamento', value: brl.format(resumo.faturamento), ...deltaText(resumo.faturamento, resumoAnterior.faturamento),
      },
      {
        label: 'Atendimentos concluídos',
        value: intFmt.format(resumo.concluidos),
        ...deltaText(resumo.concluidos, resumoAnterior.concluidos),
      },
      {
        label: 'Ticket médio', value: brl.format(resumo.ticketMedio), ...deltaText(resumo.ticketMedio, resumoAnterior.ticketMedio),
      },
      {
        label: 'Taxa de cancelamento',
        value: pct(resumo.taxaCancelamento),
        ...deltaText(resumo.taxaCancelamento, resumoAnterior.taxaCancelamento, { invert: true }),
      },
    ];
    const gap = 10;
    const width = (contentWidth - gap * (cards.length - 1)) / cards.length;
    cards.forEach((card, i) => {
      const x = MARGIN + i * (width + gap);
      doc.rect(x, y, width, 66, { fill: COLOR.paper, stroke: COLOR.line });
      doc.rect(x, y, 3, 66, { fill: COLOR.brass });
      doc.text(card.label, x + 12, y + 10, { size: 8, color: COLOR.muted });
      doc.text(doc.fit(card.value, 'Times-Bold', 17, width - 20), x + 12, y + 24, {
        font: 'Times-Bold', size: 17, color: COLOR.ink,
      });
      doc.text(doc.fit(card.text, 'Helvetica', 7, width - 20), x + 12, y + 49, { size: 7, color: card.color });
    });
    y += 82;

    const extra = `${intFmt.format(resumo.agendamentos)} agendamentos no período, ${intFmt.format(resumo.cancelados)} cancelados, `
      + `${intFmt.format(resumo.pendentes)} em aberto e ${intFmt.format(resumo.clientesUnicos)} clientes atendidos ou agendados.`;
    doc.wrap(extra, 'Helvetica', 9, contentWidth).forEach((line) => {
      doc.text(line, MARGIN, y, { size: 9, color: COLOR.muted });
      y += 13;
    });
    y += 10;
  }

  function insights() {
    sectionTitle('Destaques do período');
    for (const insight of report.insights) {
      const lines = doc.wrap(insight, 'Helvetica', 9.5, contentWidth - 16);
      ensureSpace(lines.length * 14 + 4);
      doc.rect(MARGIN, y + 4, 4, 4, { fill: COLOR.brass });
      lines.forEach((line) => {
        doc.text(line, MARGIN + 14, y, { size: 9.5, color: COLOR.ink });
        y += 14;
      });
      y += 3;
    }
    y += 12;
  }

  /**
   * Tabela com cabeçalho repetido a cada página e linhas zebradas.
   * columns: { header, width (fração), align, value(row) }
   */
  function table(columns, rows, { totals, emptyText = 'Sem registros no período.' } = {}) {
    const rowHeight = 18;
    const widths = columns.map((c) => c.width * contentWidth);
    const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((a, b) => a + b, 0));

    const header = () => {
      doc.rect(MARGIN, y, contentWidth, 20, { fill: COLOR.walnut });
      columns.forEach((column, i) => doc.text(column.header, xs[i] + 6, y + 6, {
        font: 'Helvetica-Bold', size: 8, color: COLOR.ivory, align: column.align ?? 'left', width: widths[i] - 12,
      }));
      y += 20;
    };

    ensureSpace(20 + rowHeight * Math.min(rows.length || 1, 3));
    header();

    if (!rows.length) {
      doc.text(emptyText, MARGIN + 6, y + 6, { size: 8.5, color: COLOR.muted });
      y += rowHeight + 14;
      return;
    }

    rows.forEach((row, r) => {
      if (ensureSpace(rowHeight)) header();
      if (r % 2 === 1) doc.rect(MARGIN, y, contentWidth, rowHeight, { fill: COLOR.paper });
      columns.forEach((column, i) => {
        const value = doc.fit(column.value(row), 'Helvetica', 8.5, widths[i] - 12);
        doc.text(value, xs[i] + 6, y + 5.5, {
          size: 8.5, color: column.color?.(row) ?? COLOR.ink, align: column.align ?? 'left', width: widths[i] - 12,
        });
      });
      y += rowHeight;
    });
    doc.line(MARGIN, y, MARGIN + contentWidth, y, { color: COLOR.line });

    if (totals) {
      ensureSpace(rowHeight + 4);
      columns.forEach((column, i) => {
        const value = totals[i];
        if (value) {
          doc.text(value, xs[i] + 6, y + 6, {
            font: 'Helvetica-Bold', size: 8.5, color: COLOR.ink, align: column.align ?? 'left', width: widths[i] - 12,
          });
        }
      });
      y += rowHeight + 2;
    }
    y += 16;
  }

  const statusColor = (row) => {
    if (row.status === 'Concluído') return COLOR.sage;
    if (row.status === 'Cancelado') return COLOR.brick;
    return COLOR.ink;
  };

  // ---- Conteúdo ----
  newPage();
  kpis();
  insights();

  if (mostrarBarbeiros) {
    sectionTitle('Desempenho por barbeiro');
    table([
      { header: 'Barbeiro', width: 0.3, value: (r) => r.nome },
      { header: 'Agendamentos', width: 0.14, align: 'right', value: (r) => intFmt.format(r.agendamentos) },
      { header: 'Concluídos', width: 0.13, align: 'right', value: (r) => intFmt.format(r.concluidos) },
      { header: 'Cancelados', width: 0.13, align: 'right', value: (r) => intFmt.format(r.cancelados) },
      { header: 'Ticket médio', width: 0.14, align: 'right', value: (r) => brl.format(r.ticketMedio) },
      { header: 'Faturamento', width: 0.16, align: 'right', value: (r) => brl.format(r.faturamento) },
    ], report.porBarbeiro);
  }

  sectionTitle('Serviços');
  table([
    { header: 'Serviço', width: 0.55, value: (r) => r.nome },
    { header: 'Quantidade', width: 0.2, align: 'right', value: (r) => intFmt.format(r.quantidade) },
    { header: 'Faturamento', width: 0.25, align: 'right', value: (r) => brl.format(r.faturamento) },
  ], report.porServico);

  sectionTitle('Atendimentos');
  const detalhe = [
    { header: 'Data', width: 0.11, value: (r) => dateBr(r.data) },
    { header: 'Horário', width: 0.075, value: (r) => r.horario },
    ...(mostrarBarbeiros ? [{ header: 'Barbeiro', width: 0.145, value: (r) => r.barbeiro }] : []),
    { header: 'Cliente', width: mostrarBarbeiros ? 0.145 : 0.225, value: (r) => r.cliente || '—' },
    { header: 'Serviço', width: mostrarBarbeiros ? 0.155 : 0.22, value: (r) => r.servico || '—' },
    { header: 'Status', width: 0.235, color: statusColor, value: (r) => statusLabel(r.status) },
    { header: 'Valor', width: 0.135, align: 'right', value: (r) => (r.servico ? brl.format(r.valor) : '—') },
  ];
  const totals = detalhe.map(() => '');
  totals[0] = 'Faturamento (concluídos)';
  totals[detalhe.length - 1] = brl.format(report.resumo.faturamento);
  table(detalhe, report.atendimentos, { totals });

  // ---- Rodapé em todas as páginas ----
  const { date, time } = report.geradoEm;
  for (let i = 0; i < doc.pageCount; i += 1) {
    doc.usePage(i);
    const footerY = doc.height - 32;
    doc.line(MARGIN, footerY, MARGIN + contentWidth, footerY, { color: COLOR.line });
    doc.text(`Gerado em ${dateBr(date)} às ${time}`, MARGIN, footerY + 8, { size: 7.5, color: COLOR.muted });
    doc.text(`Página ${i + 1} de ${doc.pageCount}`, MARGIN, footerY + 8, {
      size: 7.5, color: COLOR.muted, align: 'right', width: contentWidth,
    });
  }

  return doc.toBuffer({ title: `Relatório de atendimentos ${periodo}`, author: 'Zé Barbeiro' });
}
