import ExcelJS from 'exceljs';
import { statusLabel } from '../domain/agenda.js';

/** Formatos numéricos por tipo de coluna (o Excel exibe conforme o idioma do usuário). */
const NUM_FMT = Object.freeze({
  date: 'dd/mm/yyyy',
  currency: '#,##0.00',
  integer: '0',
  percent: '0.00%',
});

/** AAAA-MM-DD → Date em UTC (o ExcelJS converte para número de série de data). */
function toExcelDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Textos vindos de usuários (ex.: nome do cliente) que começam com =, +, - ou @ poderiam
 * ser interpretados como fórmula se a célula for editada; o apóstrofo força texto.
 */
function safeText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function cellValue(value, type) {
  if (value === null || value === undefined || value === '') return null;
  if (type === 'date') return toExcelDate(value);
  if (type) return Number(value);
  return safeText(value);
}

/**
 * Adiciona uma aba "limpa": cabeçalho em negrito, primeira linha congelada,
 * filtro automático e valores reais (números e datas), prontos para cálculos.
 */
function addSheet(workbook, { name, columns, rows }) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((column, i) => ({
    header: column.header,
    key: `c${i}`,
    width: column.width,
    style: column.type ? { numFmt: NUM_FMT[column.type] } : {},
  }));
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow(Object.fromEntries(row.map((value, i) => [`c${i}`, cellValue(value, columns[i].type)])));
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
}

/**
 * Planilha do relatório: dados "crus", um registro por linha, com números e datas
 * reais (sem textos como "R$" misturados), prontos para filtros, somas e tabelas dinâmicas.
 * @returns {Promise<Buffer>}
 */
export async function buildReportXlsx(report, { mostrarBarbeiros }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Zé Barbeiro';
  workbook.created = new Date();

  addSheet(workbook, {
    name: 'Atendimentos',
    columns: [
      { header: 'Data', type: 'date', width: 12 },
      { header: 'Horário', width: 9 },
      { header: 'Barbeiro', width: 24 },
      { header: 'Cliente', width: 26 },
      { header: 'Serviço', width: 22 },
      { header: 'Status', width: 22 },
      { header: 'Valor', type: 'currency', width: 12 },
    ],
    rows: report.atendimentos.map((a) => [
      a.data, a.horario, a.barbeiro, a.cliente, a.servico, statusLabel(a.status), a.servico ? a.valor : null,
    ]),
  });

  if (mostrarBarbeiros) {
    addSheet(workbook, {
      name: 'Por barbeiro',
      columns: [
        { header: 'Barbeiro', width: 26 },
        { header: 'Agendamentos', type: 'integer', width: 14 },
        { header: 'Concluídos', type: 'integer', width: 12 },
        { header: 'Cancelados', type: 'integer', width: 12 },
        { header: 'Ticket médio', type: 'currency', width: 14 },
        { header: 'Faturamento', type: 'currency', width: 14 },
      ],
      rows: report.porBarbeiro.map((b) => [
        b.nome, b.agendamentos, b.concluidos, b.cancelados, b.ticketMedio, b.faturamento,
      ]),
    });
  }

  addSheet(workbook, {
    name: 'Por serviço',
    columns: [
      { header: 'Serviço', width: 26 },
      { header: 'Quantidade', type: 'integer', width: 12 },
      { header: 'Faturamento', type: 'currency', width: 14 },
    ],
    rows: report.porServico.map((s) => [s.nome, s.quantidade, s.faturamento]),
  });

  addSheet(workbook, {
    name: 'Por dia',
    columns: [
      { header: 'Data', type: 'date', width: 12 },
      { header: 'Atendimentos', type: 'integer', width: 14 },
      { header: 'Faturamento', type: 'currency', width: 14 },
    ],
    rows: report.porDia.map((d) => [d.data, d.quantidade, d.faturamento]),
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
