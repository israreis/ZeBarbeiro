import { buildXlsx } from './xlsx.js';
import { statusLabel } from '../domain/agenda.js';

/**
 * Planilha do relatório: dados "crus", um registro por linha, com números e datas
 * reais (sem textos como "R$" misturados), prontos para filtros, somas e tabelas dinâmicas.
 */
export function buildReportXlsx(report, { mostrarBarbeiros }) {
  const atendimentos = {
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
  };

  const porServico = {
    name: 'Por serviço',
    columns: [
      { header: 'Serviço', width: 26 },
      { header: 'Quantidade', type: 'integer', width: 12 },
      { header: 'Faturamento', type: 'currency', width: 14 },
    ],
    rows: report.porServico.map((s) => [s.nome, s.quantidade, s.faturamento]),
  };

  const porDia = {
    name: 'Por dia',
    columns: [
      { header: 'Data', type: 'date', width: 12 },
      { header: 'Atendimentos', type: 'integer', width: 14 },
      { header: 'Faturamento', type: 'currency', width: 14 },
    ],
    rows: report.porDia.map((d) => [d.data, d.quantidade, d.faturamento]),
  };

  const sheets = [atendimentos];
  if (mostrarBarbeiros) {
    sheets.push({
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
  sheets.push(porServico, porDia);
  return buildXlsx(sheets);
}
