import { notFound, unprocessable } from '../http/errors.js';
import { ROLES } from '../domain/roles.js';
import { STATUS } from '../domain/agenda.js';
import { WEEKDAYS, weekdayOf } from '../domain/time.js';
import { parse, relatorioQuerySchema } from '../schemas.js';

const MAX_DIAS_PERIODO = 366;
const TAXA_CANCELAMENTO_ALTA = 0.15;

/** Ordem de exibição dos dias da semana (segunda a domingo). */
const DIAS_ORDENADOS = [...WEEKDAYS.slice(1), WEEKDAYS[0]];
const DIA_LABEL = Object.freeze({
  segunda: 'Segunda-feira',
  terca: 'Terça-feira',
  quarta: 'Quarta-feira',
  quinta: 'Quinta-feira',
  sexta: 'Sexta-feira',
  sabado: 'Sábado',
  domingo: 'Domingo',
});

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (value) => `${Math.round(value * 100)}%`;
const round2 = (value) => Math.round(value * 100) / 100;

function toUtcDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const toIso = (date) => date.toISOString().slice(0, 10);

function addDays(iso, days) {
  const date = toUtcDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

function daysBetween(inicio, fim) {
  return Math.round((toUtcDate(fim) - toUtcDate(inicio)) / 86_400_000) + 1;
}

/** Indicadores de um conjunto de agendamentos (bloqueios já excluídos). */
function resumir(agendamentos) {
  const concluidos = agendamentos.filter((ag) => ag.status === STATUS.CONCLUIDO);
  const cancelados = agendamentos.filter((ag) => ag.status === STATUS.CANCELADO);
  const faturamento = round2(concluidos.reduce((soma, ag) => soma + ag.valor, 0));
  const clientes = new Set(
    agendamentos.filter((ag) => ag.status !== STATUS.CANCELADO && ag.clienteChave).map((ag) => ag.clienteChave),
  );
  return {
    agendamentos: agendamentos.length,
    concluidos: concluidos.length,
    cancelados: cancelados.length,
    pendentes: agendamentos.length - concluidos.length - cancelados.length,
    faturamento,
    ticketMedio: concluidos.length ? round2(faturamento / concluidos.length) : 0,
    taxaCancelamento: agendamentos.length ? cancelados.length / agendamentos.length : 0,
    clientesUnicos: clientes.size,
  };
}

function variacao(atual, anterior) {
  if (!anterior) return null;
  return (atual - anterior) / anterior;
}

/** Frases curtas com os pontos de atenção do período (também usadas no PDF). */
function gerarInsights({
  resumo, resumoAnterior, porServico, porBarbeiro, porDiaSemana, porHora, filtroBarbeiro,
}) {
  if (!resumo.agendamentos) return ['Nenhum atendimento no período selecionado.'];

  const insights = [];
  const delta = variacao(resumo.faturamento, resumoAnterior.faturamento);
  if (delta === null) {
    insights.push(`Faturamento de ${brl.format(resumo.faturamento)} no período, sem faturamento no período anterior para comparar.`);
  } else if (Math.abs(delta) < 0.01) {
    insights.push(`Faturamento de ${brl.format(resumo.faturamento)}, estável em relação ao período anterior.`);
  } else {
    const direcao = delta > 0 ? 'acima' : 'abaixo';
    insights.push(`Faturamento de ${brl.format(resumo.faturamento)}, ${pct(Math.abs(delta))} ${direcao} do período anterior.`);
  }

  const ativos = porDiaSemana.reduce((soma, dia) => soma + dia.quantidade, 0);
  const diaTop = [...porDiaSemana].sort((a, b) => b.quantidade - a.quantidade)[0];
  if (ativos && diaTop.quantidade) {
    insights.push(`${DIA_LABEL[diaTop.dia]} é o dia mais movimentado, com ${pct(diaTop.quantidade / ativos)} dos atendimentos.`);
  }

  const horaTop = [...porHora].sort((a, b) => b.quantidade - a.quantidade)[0];
  if (horaTop?.quantidade) insights.push(`O horário mais procurado começa às ${horaTop.hora}h.`);

  const servicoTop = porServico.find((s) => s.faturamento > 0);
  if (servicoTop && resumo.faturamento) {
    insights.push(`${servicoTop.nome} responde por ${pct(servicoTop.faturamento / resumo.faturamento)} do faturamento.`);
  }

  if (!filtroBarbeiro && porBarbeiro.length > 1 && porBarbeiro[0].faturamento > 0) {
    insights.push(`${porBarbeiro[0].nome} lidera em faturamento, com ${brl.format(porBarbeiro[0].faturamento)}.`);
  }

  if (resumo.taxaCancelamento >= TAXA_CANCELAMENTO_ALTA) {
    insights.push(`Taxa de cancelamento de ${pct(resumo.taxaCancelamento)}. Confirmar os horários na véspera ajuda a reduzi-la.`);
  } else {
    insights.push(`Taxa de cancelamento de ${pct(resumo.taxaCancelamento)}, dentro do esperado.`);
  }
  return insights;
}

/**
 * Relatórios e indicadores de atendimentos.
 * O administrador vê todos os barbeiros (ou filtra um); o barbeiro vê apenas os próprios dados.
 */
export function createRelatoriosService({ repos, clock }) {
  async function resolverFiltros(actor, query) {
    const { inicio, fim, barbeiroId: filtro } = parse(relatorioQuerySchema, query);
    if (daysBetween(inicio, fim) > MAX_DIAS_PERIODO) {
      throw unprocessable(`Escolha um período de até ${MAX_DIAS_PERIODO} dias.`);
    }

    // O barbeiro sempre vê apenas os próprios dados, qualquer que seja o filtro enviado.
    const barbeiroId = actor.perfil === ROLES.BARBEIRO ? actor.id : filtro;
    const barbeiro = barbeiroId ? await repos.barbeiros.findById(barbeiroId) : null;
    if (barbeiroId && !barbeiro) throw notFound('Barbeiro não encontrado.');
    return {
      inicio, fim, barbeiroId, barbeiro,
    };
  }

  /** Agendamentos do período já enriquecidos com nomes e valor (sem bloqueios). */
  async function carregar({ inicio, fim, barbeiroId }, servicos) {
    const lista = await repos.agendamentos.listPeriodo({
      inicio, fim, barbeiroId, excluirStatus: [STATUS.BLOQUEADO],
    });
    const pessoas = await repos.perfis.findManyByIds(lista.flatMap((ag) => [ag.barbeiroId, ag.clienteId]).filter(Boolean));
    const nomes = new Map(pessoas.map((p) => [p.id, p.nome]));
    const servicosPorId = new Map(servicos.map((sv) => [sv.id, sv]));

    return lista.map((ag) => {
      const servico = servicosPorId.get(ag.servicoId);
      const cliente = ag.clienteId ? nomes.get(ag.clienteId) : ag.clienteNome;
      return {
        data: ag.data,
        horario: ag.horarioInicio,
        barbeiroId: ag.barbeiroId,
        barbeiro: nomes.get(ag.barbeiroId) ?? 'Barbeiro removido',
        cliente: cliente ?? '',
        clienteChave: ag.clienteId ?? (ag.clienteNome ? `avulso:${ag.clienteNome.toLowerCase()}` : null),
        servicoId: ag.servicoId,
        servico: servico?.nome ?? '',
        valor: ag.servicoId ? (ag.valor ?? servico?.valor ?? 0) : 0,
        status: ag.status,
      };
    });
  }

  function agrupar(lista, chave) {
    const grupos = new Map();
    for (const item of lista) {
      const key = chave(item);
      if (!grupos.has(key)) grupos.set(key, []);
      grupos.get(key).push(item);
    }
    return grupos;
  }

  return {
    /** Monta o relatório completo do período (usado pela tela, pelo painel e pelas exportações). */
    async gerar(actor, query) {
      const filtros = await resolverFiltros(actor, query);
      const dias = daysBetween(filtros.inicio, filtros.fim);
      const anterior = { inicio: addDays(filtros.inicio, -dias), fim: addDays(filtros.inicio, -1) };

      const servicos = await repos.servicos.list();
      const [atendimentos, atendimentosAnteriores] = await Promise.all([
        carregar(filtros, servicos),
        carregar({ ...anterior, barbeiroId: filtros.barbeiroId }, servicos),
      ]);
      const resumo = resumir(atendimentos);
      const resumoAnterior = resumir(atendimentosAnteriores);
      const ativos = atendimentos.filter((ag) => ag.status !== STATUS.CANCELADO);

      const porBarbeiro = [...agrupar(atendimentos, (ag) => ag.barbeiroId)]
        .map(([barbeiroId, lista]) => {
          const r = resumir(lista);
          return {
            barbeiroId,
            nome: lista[0].barbeiro,
            agendamentos: r.agendamentos,
            concluidos: r.concluidos,
            cancelados: r.cancelados,
            faturamento: r.faturamento,
            ticketMedio: r.ticketMedio,
          };
        })
        .sort((a, b) => b.faturamento - a.faturamento || b.agendamentos - a.agendamentos);

      const porServico = [...agrupar(ativos.filter((ag) => ag.servicoId), (ag) => ag.servicoId)]
        .map(([servicoId, lista]) => ({
          servicoId,
          nome: lista[0].servico,
          quantidade: lista.length,
          faturamento: round2(lista.filter((ag) => ag.status === STATUS.CONCLUIDO)
            .reduce((soma, ag) => soma + ag.valor, 0)),
        }))
        .sort((a, b) => b.faturamento - a.faturamento || b.quantidade - a.quantidade);

      const porDiaSemana = DIAS_ORDENADOS.map((dia) => ({
        dia,
        quantidade: ativos.filter((ag) => weekdayOf(ag.data) === dia).length,
      }));

      const porHora = [...agrupar(ativos, (ag) => ag.horario.slice(0, 2))]
        .map(([hora, lista]) => ({ hora, quantidade: lista.length }))
        .sort((a, b) => a.hora.localeCompare(b.hora));

      const porDia = [];
      for (let i = 0; i < dias; i += 1) {
        const data = addDays(filtros.inicio, i);
        const doDia = atendimentos.filter((ag) => ag.data === data);
        porDia.push({
          data,
          quantidade: doDia.filter((ag) => ag.status !== STATUS.CANCELADO).length,
          faturamento: round2(doDia.filter((ag) => ag.status === STATUS.CONCLUIDO)
            .reduce((soma, ag) => soma + ag.valor, 0)),
        });
      }

      const barbeiro = filtros.barbeiro ? { id: filtros.barbeiro.id, nome: filtros.barbeiro.nome } : null;

      return {
        periodo: { inicio: filtros.inicio, fim: filtros.fim, anterior },
        barbeiro,
        geradoEm: clock(),
        resumo,
        resumoAnterior,
        porBarbeiro,
        porServico,
        porDiaSemana,
        porHora,
        porDia,
        insights: gerarInsights({
          resumo, resumoAnterior, porServico, porBarbeiro, porDiaSemana, porHora, filtroBarbeiro: barbeiro,
        }),
        atendimentos: atendimentos.map(({ clienteChave, barbeiroId, servicoId, ...linha }) => linha),
      };
    },
  };
}
