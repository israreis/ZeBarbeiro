import crypto from 'node:crypto';
import { conflict, forbidden, notFound, unprocessable } from '../http/errors.js';
import { ROLES } from '../domain/roles.js';
import {
  STATUS, findOccupant, generateSlots, slotEnd, worksOn,
} from '../domain/agenda.js';
import { isPast } from '../domain/time.js';
import { fotoUrl } from '../domain/barbeiro.js';
import * as v from '../validation.js';

const TIPOS_RESERVA_BARBEIRO = [STATUS.AGENDADO_BARBEIRO, STATUS.BLOQUEADO];
const SITUACOES = { concluidos: 'concluidos', pendentes: 'pendentes' };
const MAX_HORARIOS_POR_RESERVA = 12;

/**
 * Regras de negócio da agenda: consulta de horários, reservas, bloqueios,
 * conclusão e cancelamento de atendimentos, além do histórico.
 * Todas as verificações são feitas no servidor — a interface apenas reflete o resultado.
 */
export function createAgendamentosService({ store, clock }) {
  const nomeUsuario = (db, id) => db.usuarios.find((u) => u.id === id)?.nome ?? null;
  const servicoResumo = (db, id) => {
    const servico = db.servicos.find((s) => s.id === id);
    return servico ? { id: servico.id, nome: servico.nome, valor: servico.valor } : null;
  };

  const detalhar = (db, ag) => ({
    id: ag.id,
    data: ag.data,
    horarioInicio: ag.horarioInicio,
    horarioFim: ag.horarioFim,
    status: ag.status,
    cliente: ag.clienteId ? nomeUsuario(db, ag.clienteId) : (ag.clienteNome ?? null),
    barbeiro: nomeUsuario(db, ag.barbeiroId),
    servico: servicoResumo(db, ag.servicoId),
  });

  /** Barbeiros só acessam a própria agenda; demais perfis informam o barbeiro. */
  function resolveBarbeiroId(actor, barbeiroId) {
    if (actor.perfil === ROLES.BARBEIRO) return actor.id;
    return v.requiredString(barbeiroId, 'barbeiro');
  }

  function findBarbeiro(db, id, { exigirAtivo }) {
    const barbeiro = db.barbeiros.find((b) => b.id === id);
    if (!barbeiro || (exigirAtivo && !barbeiro.ativo)) throw notFound('Barbeiro não encontrado.');
    return barbeiro;
  }

  function findAgendamento(db, id) {
    const agendamento = db.agendamentos.find((ag) => ag.id === id);
    if (!agendamento) throw notFound('Agendamento não encontrado.');
    return agendamento;
  }

  function validarHorarios(db, barbeiro, data, horarios) {
    if (!worksOn(barbeiro, data)) throw unprocessable('O barbeiro não atende na data selecionada.');

    const expediente = new Set(generateSlots(barbeiro.horarioInicial, barbeiro.horarioFinal));
    const agora = clock();
    for (const horario of horarios) {
      if (!expediente.has(horario)) throw unprocessable(`O horário ${horario} está fora do expediente.`);
      if (isPast(data, horario, agora)) throw unprocessable(`O horário ${horario} já passou.`);
      if (findOccupant(db.agendamentos, { barbeiroId: barbeiro.id, data, horario })) {
        throw conflict(`O horário ${horario} não está mais disponível.`);
      }
    }
  }

  function novoAgendamento({
    barbeiroId, clienteId = null, clienteNome, clienteTelefone, servicoId = null, data, horario, status,
  }) {
    return {
      id: crypto.randomUUID(),
      barbeiroId,
      clienteId,
      ...(clienteNome ? { clienteNome } : {}),
      ...(clienteTelefone ? { clienteTelefone } : {}),
      servicoId,
      data,
      horarioInicio: horario,
      horarioFim: slotEnd(horario),
      status,
      criadoEm: new Date().toISOString(),
    };
  }

  /** Serviço ativo que o barbeiro oferece. */
  function findServicoDoBarbeiro(db, barbeiro, servicoId) {
    const servico = db.servicos.find((s) => s.id === servicoId && s.ativo);
    if (!servico || !barbeiro.servicoIds.includes(servicoId)) {
      throw unprocessable('Este serviço não é oferecido pelo barbeiro selecionado.');
    }
    return servico;
  }

  /**
   * Cliente de um atendimento incluído pelo barbeiro: apenas nome (e celular opcional).
   * Não precisa ter cadastro — o objetivo é marcar o horário na agenda.
   */
  function parseClienteManual(body) {
    return {
      clienteNome: v.requiredString(body?.clienteNome, 'nome do cliente'),
      clienteTelefone: body?.clienteTelefone ? v.phone(body.clienteTelefone, 'celular do cliente') : undefined,
    };
  }

  function parseHorarios(value) {
    const horarios = v.stringArray(value, 'horários', { minItems: 1 });
    if (horarios.length > MAX_HORARIOS_POR_RESERVA) {
      throw unprocessable(`Selecione no máximo ${MAX_HORARIOS_POR_RESERVA} horários por vez.`);
    }
    return horarios.map((h) => v.time(h)).sort();
  }

  return {
    /**
     * Agenda completa do dia de um barbeiro (uso interno: administrador e barbeiro).
     * Cada horário traz o detalhe da ocupação, se houver.
     */
    getAgenda(actor, query) {
      const db = store.snapshot;
      const data = v.isoDate(query.data);
      const barbeiro = findBarbeiro(db, resolveBarbeiroId(actor, query.barbeiroId), { exigirAtivo: false });
      if (!worksOn(barbeiro, data)) return { data, atende: false, horarios: [] };

      const agora = clock();
      const horarios = generateSlots(barbeiro.horarioInicial, barbeiro.horarioFinal).map((horario) => {
        const ocupante = findOccupant(db.agendamentos, { barbeiroId: barbeiro.id, data, horario });
        return {
          horario,
          horarioFim: slotEnd(horario),
          passado: isPast(data, horario, agora),
          agendamento: ocupante ? detalhar(db, ocupante) : null,
        };
      });
      return { data, atende: true, horarios };
    },

    /**
     * Horários livres e futuros para agendar um serviço, agrupados por barbeiro.
     * Não expõe nenhuma informação sobre quem ocupa os demais horários.
     * @param {{ data: string, servicoId: string, barbeiroId?: string }} query
     */
    disponibilidade(query) {
      const db = store.snapshot;
      const data = v.isoDate(query.data);
      const servicoId = v.requiredString(query.servicoId, 'serviço');
      const servico = db.servicos.find((s) => s.id === servicoId && s.ativo);
      if (!servico) throw notFound('Serviço não encontrado.');
      const barbeiroId = query.barbeiroId ? String(query.barbeiroId) : null;

      const agora = clock();
      const barbeiros = db.barbeiros
        .filter((b) => b.ativo && b.servicoIds.includes(servicoId) && (!barbeiroId || b.id === barbeiroId))
        .map((barbeiro) => {
          const nome = nomeUsuario(db, barbeiro.id);
          const atende = worksOn(barbeiro, data);
          const horarios = atende
            ? generateSlots(barbeiro.horarioInicial, barbeiro.horarioFinal).filter((horario) => !isPast(data, horario, agora)
              && !findOccupant(db.agendamentos, { barbeiroId: barbeiro.id, data, horario }))
            : [];
          return {
            barbeiro: { id: barbeiro.id, nome, fotoUrl: fotoUrl(barbeiro) }, atende, horarios,
          };
        })
        .filter((item) => item.barbeiro.nome)
        .sort((a, b) => b.horarios.length - a.horarios.length || a.barbeiro.nome.localeCompare(b.barbeiro.nome, 'pt-BR'));

      const { id, nome, valor, duracaoMinutos } = servico;
      return {
        data, servico: { id, nome, valor, duracaoMinutos }, barbeiros,
      };
    },

    /** Histórico filtrado por período e situação, restrito ao escopo do perfil. */
    history(actor, query) {
      const db = store.snapshot;
      const inicio = v.isoDate(query.inicio, 'data inicial');
      const fim = v.isoDate(query.fim, 'data final');
      if (inicio > fim) throw unprocessable('A data inicial deve ser anterior ou igual à data final.');
      const situacao = v.oneOf(query.situacao ?? SITUACOES.pendentes, 'situação', Object.values(SITUACOES));

      let scope;
      if (actor.perfil === ROLES.CLIENTE) scope = (ag) => ag.clienteId === actor.id;
      else if (actor.perfil === ROLES.BARBEIRO) scope = (ag) => ag.barbeiroId === actor.id;
      else {
        const barbeiroId = query.barbeiroId ? String(query.barbeiroId) : null;
        scope = (ag) => !barbeiroId || ag.barbeiroId === barbeiroId;
      }

      const situacaoOk = situacao === SITUACOES.concluidos
        ? (ag) => ag.status === STATUS.CONCLUIDO
        : (ag) => ag.status !== STATUS.CONCLUIDO;

      return db.agendamentos
        .filter((ag) => scope(ag) && ag.data >= inicio && ag.data <= fim && situacaoOk(ag))
        .sort((a, b) => a.data.localeCompare(b.data) || a.horarioInicio.localeCompare(b.horarioInicio))
        .map((ag) => detalhar(db, ag));
    },

    /**
     * Cria agendamentos para um ou mais horários de forma atômica (tudo ou nada).
     * - Cliente: reserva um serviço com um barbeiro.
     * - Barbeiro: inclui um atendimento manualmente ("Agendado Barbeiro", com cliente e serviço)
     *   ou bloqueia horários.
     */
    create(actor, body) {
      const data = v.isoDate(body?.data);
      const horarios = parseHorarios(body?.horarios);

      if (actor.perfil === ROLES.CLIENTE) {
        const barbeiroId = v.requiredString(body?.barbeiroId, 'barbeiro');
        const servicoId = v.requiredString(body?.servicoId, 'serviço');
        return store.update((db) => {
          const barbeiro = findBarbeiro(db, barbeiroId, { exigirAtivo: true });
          findServicoDoBarbeiro(db, barbeiro, servicoId);
          validarHorarios(db, barbeiro, data, horarios);
          const criados = horarios.map((horario) => novoAgendamento({
            barbeiroId, clienteId: actor.id, servicoId, data, horario, status: STATUS.AGENDADO,
          }));
          db.agendamentos.push(...criados);
          return criados.map((ag) => detalhar(db, ag));
        });
      }

      if (actor.perfil === ROLES.BARBEIRO) {
        const status = v.oneOf(body?.tipo, 'tipo', TIPOS_RESERVA_BARBEIRO);
        const isAtendimento = status === STATUS.AGENDADO_BARBEIRO;
        const servicoId = isAtendimento ? v.requiredString(body?.servicoId, 'serviço') : null;
        // Atendimento incluído pelo barbeiro exige cliente e serviço; bloqueio não tem nenhum dos dois.
        const cliente = isAtendimento ? parseClienteManual(body) : {};
        return store.update((db) => {
          const barbeiro = findBarbeiro(db, actor.id, { exigirAtivo: false });
          if (isAtendimento) findServicoDoBarbeiro(db, barbeiro, servicoId);
          validarHorarios(db, barbeiro, data, horarios);
          const criados = horarios.map((horario) => novoAgendamento({
            barbeiroId: barbeiro.id, ...cliente, servicoId, data, horario, status,
          }));
          db.agendamentos.push(...criados);
          return criados.map((ag) => detalhar(db, ag));
        });
      }

      throw forbidden();
    },

    /** Barbeiro conclui um atendimento seu que não esteja em data futura. */
    concluir(actor, id) {
      return store.update((db) => {
        const agendamento = findAgendamento(db, id);
        if (agendamento.barbeiroId !== actor.id) throw notFound('Agendamento não encontrado.');
        if (![STATUS.AGENDADO, STATUS.AGENDADO_BARBEIRO].includes(agendamento.status)) {
          throw unprocessable(`Atendimentos com status "${agendamento.status}" não podem ser concluídos.`);
        }
        if (agendamento.data > clock().date) {
          throw unprocessable('Não é possível concluir um atendimento de data futura.');
        }
        agendamento.status = STATUS.CONCLUIDO;
        return detalhar(db, agendamento);
      });
    },

    /**
     * Cancela um agendamento mantendo o registro (status "Cancelado"), o que libera o horário.
     * - Cliente: apenas os próprios agendamentos futuros com status "Agendado".
     * - Barbeiro: apenas os próprios bloqueios e atendimentos avulsos.
     */
    cancelar(actor, id) {
      return store.update((db) => {
        const agendamento = findAgendamento(db, id);

        if (actor.perfil === ROLES.CLIENTE) {
          if (agendamento.clienteId !== actor.id) throw notFound('Agendamento não encontrado.');
          if (agendamento.status !== STATUS.AGENDADO) {
            throw unprocessable('Somente agendamentos com status "Agendado" podem ser cancelados.');
          }
          if (isPast(agendamento.data, agendamento.horarioInicio, clock())) {
            throw unprocessable('Não é possível cancelar um agendamento que já passou.');
          }
        } else if (actor.perfil === ROLES.BARBEIRO) {
          if (agendamento.barbeiroId !== actor.id) throw notFound('Agendamento não encontrado.');
          if (!TIPOS_RESERVA_BARBEIRO.includes(agendamento.status)) {
            throw unprocessable('Somente bloqueios e atendimentos incluídos pelo barbeiro podem ser cancelados.');
          }
        } else {
          throw forbidden();
        }

        agendamento.status = STATUS.CANCELADO;
        agendamento.canceladoEm = new Date().toISOString();
        return detalhar(db, agendamento);
      });
    },
  };
}
