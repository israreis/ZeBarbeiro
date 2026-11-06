import crypto from 'node:crypto';
import {
  conflict, forbidden, notFound, unprocessable,
} from '../http/errors.js';
import { ROLES } from '../domain/roles.js';
import {
  STATUS, findOccupant, generateSlots, slotEnd, worksOn,
} from '../domain/agenda.js';
import { isPast } from '../domain/time.js';
import {
  TIPOS_RESERVA_BARBEIRO, agendaQuerySchema, disponibilidadeQuerySchema, historicoQuerySchema, parse,
  reservaBarbeiroSchema, reservaClienteSchema,
} from '../schemas.js';

const ALTERADO_POR_OUTRO = 'Este agendamento foi alterado por outra pessoa. Atualize a página e tente novamente.';

/**
 * Regras de negócio da agenda: horários livres, reservas, bloqueios,
 * conclusão e cancelamento de atendimentos, além do histórico.
 * Tudo é verificado no servidor; o índice único do banco impede reservas duplicadas
 * mesmo quando duas pessoas confirmam o mesmo horário ao mesmo tempo.
 */
export function createAgendamentosService({
  repos, photos, clock,
}) {
  /** Acrescenta nomes de cliente/barbeiro e o serviço aos agendamentos, com poucas consultas. */
  async function detalharTodos(agendamentos) {
    if (!agendamentos.length) return [];
    const pessoaIds = agendamentos.flatMap((ag) => [ag.barbeiroId, ag.clienteId]).filter(Boolean);
    const [pessoas, servicos] = await Promise.all([
      repos.perfis.findManyByIds(pessoaIds),
      repos.servicos.list(),
    ]);
    const nomes = new Map(pessoas.map((p) => [p.id, p.nome]));
    const servicosPorId = new Map(servicos.map((s) => [s.id, s]));

    return agendamentos.map((ag) => {
      const servico = servicosPorId.get(ag.servicoId);
      return {
        id: ag.id,
        data: ag.data,
        horarioInicio: ag.horarioInicio,
        horarioFim: ag.horarioFim,
        status: ag.status,
        cliente: ag.clienteId ? (nomes.get(ag.clienteId) ?? null) : (ag.clienteNome ?? null),
        barbeiro: nomes.get(ag.barbeiroId) ?? null,
        // O valor exibido é o gravado na reserva, não o preço atual do serviço.
        servico: servico ? { id: servico.id, nome: servico.nome, valor: ag.valor ?? servico.valor } : null,
      };
    });
  }

  const detalhar = async (agendamento) => (await detalharTodos([agendamento]))[0];

  async function findBarbeiro(id, { exigirAtivo }) {
    const barbeiro = await repos.barbeiros.findById(id);
    if (!barbeiro || (exigirAtivo && !barbeiro.ativo)) throw notFound('Barbeiro não encontrado.');
    return barbeiro;
  }

  async function findAgendamento(id, pertenceAoUsuario) {
    const agendamento = await repos.agendamentos.findById(id);
    // Agendamento de outra pessoa responde 404 (não revela que existe).
    if (!agendamento || !pertenceAoUsuario(agendamento)) throw notFound('Agendamento não encontrado.');
    return agendamento;
  }

  /** Serviço ativo que o barbeiro oferece. */
  async function findServicoDoBarbeiro(barbeiro, servicoId) {
    const servico = await repos.servicos.findById(servicoId);
    if (!servico?.ativo || !barbeiro.servicoIds.includes(servicoId)) {
      throw unprocessable('Este serviço não é oferecido pelo barbeiro selecionado.');
    }
    return servico;
  }

  async function validarHorarios(barbeiro, data, horarios) {
    if (!worksOn(barbeiro, data)) throw unprocessable('O barbeiro não atende na data selecionada.');

    const expediente = new Set(generateSlots(barbeiro.horarioInicial, barbeiro.horarioFinal));
    const agora = clock();
    const ocupados = await repos.agendamentos.listOcupados({ barbeiroIds: [barbeiro.id], data });
    for (const horario of horarios) {
      if (!expediente.has(horario)) throw unprocessable(`O horário ${horario} está fora do expediente.`);
      if (isPast(data, horario, agora)) throw unprocessable(`O horário ${horario} já passou.`);
      if (findOccupant(ocupados, { barbeiroId: barbeiro.id, data, horario })) {
        throw conflict(`O horário ${horario} não está mais disponível.`);
      }
    }
  }

  /**
   * Cria um agendamento por horário. O valor do serviço é gravado na reserva para que
   * relatórios de períodos passados não mudem quando o preço for alterado.
   */
  function novosAgendamentos({
    barbeiroId, clienteId = null, clienteNome = null, clienteTelefone = null, servico = null, data, horarios, status,
  }) {
    return horarios.map((horario) => ({
      id: crypto.randomUUID(),
      barbeiroId,
      clienteId,
      clienteNome,
      clienteTelefone,
      servicoId: servico?.id ?? null,
      valor: servico?.valor ?? null,
      data,
      horarioInicio: horario,
      horarioFim: slotEnd(horario),
      status,
    }));
  }

  async function reservar({ barbeiro, data, horarios, ...dados }) {
    await validarHorarios(barbeiro, data, horarios);
    const criados = await repos.agendamentos.insertMany(novosAgendamentos({
      barbeiroId: barbeiro.id, data, horarios, ...dados,
    }));
    return detalharTodos(criados);
  }

  async function mudarStatus(agendamento, { de, para, canceladoEm }) {
    const atualizado = await repos.agendamentos.updateStatus(agendamento.id, { de, para, canceladoEm });
    if (!atualizado) throw conflict(ALTERADO_POR_OUTRO);
    return detalhar(atualizado);
  }

  return {
    /**
     * Agenda completa do dia de um barbeiro (administrador e o próprio barbeiro).
     * Cada horário traz o detalhe da ocupação, se houver.
     */
    async getAgenda(actor, query) {
      const filtros = parse(agendaQuerySchema, query);
      const barbeiroId = actor.perfil === ROLES.BARBEIRO ? actor.id : filtros.barbeiroId;
      if (!barbeiroId) throw unprocessable('O campo "barbeiro" é obrigatório.');
      const barbeiro = await findBarbeiro(barbeiroId, { exigirAtivo: false });
      const { data } = filtros;
      if (!worksOn(barbeiro, data)) return { data, atende: false, horarios: [] };

      const ocupados = await detalharTodos(await repos.agendamentos.listOcupados({ barbeiroIds: [barbeiro.id], data }));
      const porHorario = new Map(ocupados.map((ag) => [ag.horarioInicio, ag]));
      const agora = clock();
      const horarios = generateSlots(barbeiro.horarioInicial, barbeiro.horarioFinal).map((horario) => ({
        horario,
        horarioFim: slotEnd(horario),
        passado: isPast(data, horario, agora),
        agendamento: porHorario.get(horario) ?? null,
      }));
      return { data, atende: true, horarios };
    },

    /**
     * Horários livres e futuros para agendar um serviço, agrupados por barbeiro.
     * Não expõe nenhuma informação sobre quem ocupa os demais horários.
     */
    async disponibilidade(query) {
      const { data, servicoId, barbeiroId } = parse(disponibilidadeQuerySchema, query);
      const servico = await repos.servicos.findById(servicoId);
      if (!servico?.ativo) throw notFound('Serviço não encontrado.');

      const candidatos = (await repos.barbeiros.list())
        .filter((b) => b.ativo && b.servicoIds.includes(servicoId) && (!barbeiroId || b.id === barbeiroId));
      const ocupados = await repos.agendamentos.listOcupados({
        barbeiroIds: candidatos.filter((b) => worksOn(b, data)).map((b) => b.id),
        data,
      });

      const agora = clock();
      const barbeiros = candidatos
        .map((barbeiro) => {
          const atende = worksOn(barbeiro, data);
          const horarios = atende
            ? generateSlots(barbeiro.horarioInicial, barbeiro.horarioFinal).filter((horario) => !isPast(data, horario, agora)
              && !findOccupant(ocupados, { barbeiroId: barbeiro.id, data, horario }))
            : [];
          return {
            barbeiro: { id: barbeiro.id, nome: barbeiro.nome, fotoUrl: photos.publicUrl(barbeiro.fotoPath) },
            atende,
            horarios,
          };
        })
        .sort((a, b) => b.horarios.length - a.horarios.length || a.barbeiro.nome.localeCompare(b.barbeiro.nome, 'pt-BR'));

      const { id, nome, valor, duracaoMinutos } = servico;
      return {
        data, servico: { id, nome, valor, duracaoMinutos }, barbeiros,
      };
    },

    /** Histórico filtrado por período e situação, restrito ao escopo do perfil. */
    async history(actor, query) {
      const {
        inicio, fim, situacao, barbeiroId,
      } = parse(historicoQuerySchema, query);

      const escopo = { inicio, fim };
      if (actor.perfil === ROLES.CLIENTE) escopo.clienteId = actor.id;
      else if (actor.perfil === ROLES.BARBEIRO) escopo.barbeiroId = actor.id;
      else escopo.barbeiroId = barbeiroId;

      const concluidos = situacao === 'concluidos';
      const lista = (await repos.agendamentos.listPeriodo(escopo))
        .filter((ag) => (ag.status === STATUS.CONCLUIDO) === concluidos);
      return detalharTodos(lista);
    },

    /**
     * Cria agendamentos para um ou mais horários de uma vez (tudo ou nada).
     * - Cliente: reserva um serviço com um barbeiro.
     * - Barbeiro: inclui um atendimento manualmente ("Agendado Barbeiro") ou bloqueia horários.
     */
    async create(actor, body) {
      if (actor.perfil === ROLES.CLIENTE) {
        const {
          barbeiroId, servicoId, data, horarios,
        } = parse(reservaClienteSchema, body);
        const barbeiro = await findBarbeiro(barbeiroId, { exigirAtivo: true });
        const servico = await findServicoDoBarbeiro(barbeiro, servicoId);
        return reservar({
          barbeiro, data, horarios, servico, clienteId: actor.id, status: STATUS.AGENDADO,
        });
      }

      if (actor.perfil === ROLES.BARBEIRO) {
        const reserva = parse(reservaBarbeiroSchema, body);
        const barbeiro = await findBarbeiro(actor.id, { exigirAtivo: false });
        if (reserva.tipo === STATUS.BLOQUEADO) {
          return reservar({
            barbeiro, data: reserva.data, horarios: reserva.horarios, status: STATUS.BLOQUEADO,
          });
        }
        // Atendimento incluído pelo barbeiro: cliente só pelo nome (não precisa ter cadastro).
        const servico = await findServicoDoBarbeiro(barbeiro, reserva.servicoId);
        return reservar({
          barbeiro,
          data: reserva.data,
          horarios: reserva.horarios,
          servico,
          clienteNome: reserva.clienteNome,
          clienteTelefone: reserva.clienteTelefone ?? null,
          status: STATUS.AGENDADO_BARBEIRO,
        });
      }

      throw forbidden();
    },

    /** Barbeiro conclui um atendimento seu que não esteja em data futura. */
    async concluir(actor, id) {
      const agendamento = await findAgendamento(id, (ag) => ag.barbeiroId === actor.id);
      const concluiveis = [STATUS.AGENDADO, STATUS.AGENDADO_BARBEIRO];
      if (!concluiveis.includes(agendamento.status)) {
        throw unprocessable(`Atendimentos com status "${agendamento.status}" não podem ser concluídos.`);
      }
      if (agendamento.data > clock().date) {
        throw unprocessable('Não é possível concluir um atendimento de data futura.');
      }
      return mudarStatus(agendamento, { de: concluiveis, para: STATUS.CONCLUIDO });
    },

    /**
     * Cancela mantendo o registro (status "Cancelado"), o que libera o horário.
     * - Cliente: apenas os próprios agendamentos futuros com status "Agendado".
     * - Barbeiro: apenas os próprios bloqueios e atendimentos incluídos por ele.
     */
    async cancelar(actor, id) {
      if (actor.perfil === ROLES.CLIENTE) {
        const agendamento = await findAgendamento(id, (ag) => ag.clienteId === actor.id);
        if (agendamento.status !== STATUS.AGENDADO) {
          throw unprocessable('Somente agendamentos com status "Agendado" podem ser cancelados.');
        }
        if (isPast(agendamento.data, agendamento.horarioInicio, clock())) {
          throw unprocessable('Não é possível cancelar um agendamento que já passou.');
        }
        return mudarStatus(agendamento, {
          de: [STATUS.AGENDADO], para: STATUS.CANCELADO, canceladoEm: new Date().toISOString(),
        });
      }

      if (actor.perfil === ROLES.BARBEIRO) {
        const agendamento = await findAgendamento(id, (ag) => ag.barbeiroId === actor.id);
        if (!TIPOS_RESERVA_BARBEIRO.includes(agendamento.status)) {
          throw unprocessable('Somente bloqueios e atendimentos incluídos pelo barbeiro podem ser cancelados.');
        }
        return mudarStatus(agendamento, {
          de: TIPOS_RESERVA_BARBEIRO, para: STATUS.CANCELADO, canceladoEm: new Date().toISOString(),
        });
      }

      throw forbidden();
    },
  };
}
