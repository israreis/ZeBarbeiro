import { conflict, notFound } from '../../http/errors.js';

/**
 * Repositórios sobre o Postgres do Supabase (via PostgREST/supabase-js).
 * Convertem snake_case ⇄ camelCase e devolvem objetos de domínio simples,
 * no mesmo formato do repositório em memória usado nos testes.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value) => typeof value === 'string' && UUID.test(value);

/** O PostgREST devolve no máximo 1000 linhas por requisição (padrão do Supabase). */
const PAGE_SIZE = 1000;
/** Limita o tamanho da URL em filtros `in (...)`. */
const IN_CHUNK = 100;

const UNIQUE_VIOLATION = '23505';

export class DatabaseError extends Error {
  constructor(error) {
    super(`Erro no banco de dados: ${error.message}`);
    this.name = 'DatabaseError';
    this.code = error.code;
    this.details = error.details;
  }
}

/** Extrai `data` de uma resposta do supabase-js, convertendo erros. */
function unwrap({ data, error }, { conflictMessage } = {}) {
  if (!error) return data;
  if (error.code === UNIQUE_VIOLATION && conflictMessage) throw conflict(conflictMessage);
  throw new DatabaseError(error);
}

/** Busca todas as páginas de uma consulta (a consulta deve ter ordenação estável). */
async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = unwrap(await buildQuery().range(from, from + PAGE_SIZE - 1));
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function chunk(list, size) {
  const parts = [];
  for (let i = 0; i < list.length; i += size) parts.push(list.slice(i, i + size));
  return parts;
}

/** Postgres devolve `time` como HH:MM:SS; a aplicação usa HH:MM. */
const hhmm = (value) => (value ? value.slice(0, 5) : null);
const money = (value) => (value === null || value === undefined ? null : Number(value));

// ---------------------------------------------------------------------------
// Mapeamentos linha ⇄ domínio
// ---------------------------------------------------------------------------

const PERFIL_COLUMNS = 'id, nome, email, telefone, data_nascimento, perfil';

const toPerfil = (row) => ({
  id: row.id,
  nome: row.nome,
  email: row.email,
  telefone: row.telefone,
  dataNascimento: row.data_nascimento,
  perfil: row.perfil,
});

const toServico = (row) => ({
  id: row.id,
  nome: row.nome,
  valor: money(row.valor),
  duracaoMinutos: row.duracao_minutos,
  ativo: row.ativo,
});

const servicoToRow = (servico) => ({
  nome: servico.nome,
  valor: servico.valor,
  duracao_minutos: servico.duracaoMinutos,
  ativo: servico.ativo,
});

const BARBEIRO_COLUMNS = 'id, ativo, horario_inicial, horario_final, dias_disponiveis, foto_path, '
  + 'perfis!inner(nome, email, telefone, data_nascimento), barbeiro_servicos(servico_id)';

const toBarbeiro = (row) => ({
  id: row.id,
  nome: row.perfis.nome,
  email: row.perfis.email,
  telefone: row.perfis.telefone,
  dataNascimento: row.perfis.data_nascimento,
  ativo: row.ativo,
  horarioInicial: hhmm(row.horario_inicial),
  horarioFinal: hhmm(row.horario_final),
  diasDisponiveis: row.dias_disponiveis,
  servicoIds: row.barbeiro_servicos.map((item) => item.servico_id),
  fotoPath: row.foto_path,
});

const toAgendamento = (row) => ({
  id: row.id,
  barbeiroId: row.barbeiro_id,
  clienteId: row.cliente_id,
  clienteNome: row.cliente_nome,
  clienteTelefone: row.cliente_telefone,
  servicoId: row.servico_id,
  valor: money(row.valor),
  data: row.data,
  horarioInicio: hhmm(row.horario_inicio),
  horarioFim: hhmm(row.horario_fim),
  status: row.status,
  criadoEm: row.criado_em,
  canceladoEm: row.cancelado_em,
});

const agendamentoToRow = (ag) => ({
  id: ag.id,
  barbeiro_id: ag.barbeiroId,
  cliente_id: ag.clienteId ?? null,
  cliente_nome: ag.clienteNome ?? null,
  cliente_telefone: ag.clienteTelefone ?? null,
  servico_id: ag.servicoId ?? null,
  valor: ag.valor ?? null,
  data: ag.data,
  horario_inicio: ag.horarioInicio,
  horario_fim: ag.horarioFim,
  status: ag.status,
});

const EMAIL_DUPLICADO = 'Este e-mail já está cadastrado.';
const SERVICO_DUPLICADO = 'Já existe um serviço com este nome.';
const HORARIO_OCUPADO = 'Um dos horários selecionados não está mais disponível. Atualize a agenda e tente novamente.';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} db cliente com a chave service_role
 */
export function createSupabaseRepositories(db) {
  const perfis = {
    async findById(id) {
      if (!isUuid(id)) return null;
      const row = unwrap(await db.from('perfis').select(PERFIL_COLUMNS).eq('id', id).maybeSingle());
      return row ? toPerfil(row) : null;
    },

    async findManyByIds(ids) {
      const validos = [...new Set(ids)].filter(isUuid);
      const partes = await Promise.all(chunk(validos, IN_CHUNK)
        .map(async (parte) => unwrap(await db.from('perfis').select(PERFIL_COLUMNS).in('id', parte))));
      return partes.flat().map(toPerfil);
    },

    async emailEmUso(email, ignorarId = null) {
      const rows = unwrap(await db.from('perfis').select('id').eq('email', email));
      return rows.some((row) => row.id !== ignorarId);
    },

    async insert(perfil) {
      const row = unwrap(await db.from('perfis').insert({
        id: perfil.id,
        nome: perfil.nome,
        email: perfil.email,
        telefone: perfil.telefone,
        data_nascimento: perfil.dataNascimento,
        perfil: perfil.perfil,
      }).select(PERFIL_COLUMNS).single(), { conflictMessage: EMAIL_DUPLICADO });
      return toPerfil(row);
    },

    /** Atualiza dados pessoais (nunca o perfil/papel). */
    async update(id, dados) {
      const row = unwrap(await db.from('perfis').update({
        nome: dados.nome,
        email: dados.email,
        telefone: dados.telefone,
        data_nascimento: dados.dataNascimento,
      }).eq('id', id).select(PERFIL_COLUMNS).maybeSingle(), { conflictMessage: EMAIL_DUPLICADO });
      if (!row) throw notFound('Usuário não encontrado.');
      return toPerfil(row);
    },
  };

  const servicos = {
    async list() {
      return unwrap(await db.from('servicos').select('*').order('nome')).map(toServico);
    },

    async findById(id) {
      if (!isUuid(id)) return null;
      const row = unwrap(await db.from('servicos').select('*').eq('id', id).maybeSingle());
      return row ? toServico(row) : null;
    },

    async insert(servico) {
      const row = unwrap(
        await db.from('servicos').insert(servicoToRow(servico)).select('*').single(),
        { conflictMessage: SERVICO_DUPLICADO },
      );
      return toServico(row);
    },

    async update(id, servico) {
      if (!isUuid(id)) return null;
      const row = unwrap(
        await db.from('servicos').update(servicoToRow(servico)).eq('id', id).select('*').maybeSingle(),
        { conflictMessage: SERVICO_DUPLICADO },
      );
      return row ? toServico(row) : null;
    },
  };

  const barbeiros = {
    async list() {
      const rows = unwrap(await db.from('barbeiros').select(BARBEIRO_COLUMNS));
      return rows.map(toBarbeiro).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    },

    async findById(id) {
      if (!isUuid(id)) return null;
      const row = unwrap(await db.from('barbeiros').select(BARBEIRO_COLUMNS).eq('id', id).maybeSingle());
      return row ? toBarbeiro(row) : null;
    },

    /** Cria ou atualiza perfil + expediente + serviços numa única transação (função SQL). */
    async save(barbeiro) {
      unwrap(await db.rpc('salvar_barbeiro', {
        p_id: barbeiro.id,
        p_nome: barbeiro.nome,
        p_email: barbeiro.email,
        p_telefone: barbeiro.telefone,
        p_data_nascimento: barbeiro.dataNascimento,
        p_ativo: barbeiro.ativo,
        p_horario_inicial: barbeiro.horarioInicial,
        p_horario_final: barbeiro.horarioFinal,
        p_dias: barbeiro.diasDisponiveis,
        p_servicos: barbeiro.servicoIds,
      }), { conflictMessage: EMAIL_DUPLICADO });
      return barbeiros.findById(barbeiro.id);
    },

    /** Troca o caminho da foto e devolve o anterior (para apagar o arquivo antigo). */
    async setFotoPath(id, fotoPath) {
      const atual = await barbeiros.findById(id);
      if (!atual) throw notFound('Barbeiro não encontrado.');
      unwrap(await db.from('barbeiros').update({ foto_path: fotoPath }).eq('id', id));
      return atual.fotoPath;
    },
  };

  const agendamentos = {
    async findById(id) {
      if (!isUuid(id)) return null;
      const row = unwrap(await db.from('agendamentos').select('*').eq('id', id).maybeSingle());
      return row ? toAgendamento(row) : null;
    },

    /** Agendamentos que ocupam horário (não cancelados) dos barbeiros na data. */
    async listOcupados({ barbeiroIds, data }) {
      const ids = barbeiroIds.filter(isUuid);
      if (!ids.length) return [];
      const rows = unwrap(await db.from('agendamentos').select('*')
        .in('barbeiro_id', ids)
        .eq('data', data)
        .neq('status', 'Cancelado'));
      return rows.map(toAgendamento);
    },

    /**
     * Agendamentos de um período, ordenados por data e horário.
     * @param {{ inicio: string, fim: string, barbeiroId?: string|null, clienteId?: string|null,
     *           excluirStatus?: string[] }} filtros
     */
    async listPeriodo({
      inicio, fim, barbeiroId = null, clienteId = null, excluirStatus = [],
    }) {
      if ((barbeiroId && !isUuid(barbeiroId)) || (clienteId && !isUuid(clienteId))) return [];
      const rows = await fetchAll(() => {
        let query = db.from('agendamentos').select('*').gte('data', inicio).lte('data', fim);
        if (barbeiroId) query = query.eq('barbeiro_id', barbeiroId);
        if (clienteId) query = query.eq('cliente_id', clienteId);
        for (const status of excluirStatus) query = query.neq('status', status);
        return query.order('data').order('horario_inicio').order('id');
      });
      return rows.map(toAgendamento);
    },

    /** Insere vários horários num único comando (tudo ou nada). */
    async insertMany(lista) {
      const rows = unwrap(
        await db.from('agendamentos').insert(lista.map(agendamentoToRow)).select('*'),
        { conflictMessage: HORARIO_OCUPADO },
      );
      return rows.map(toAgendamento).sort((a, b) => a.horarioInicio.localeCompare(b.horarioInicio));
    },

    /**
     * Muda o status apenas se o atual estiver em `de` (controle otimista de concorrência).
     * Devolve null quando outro usuário alterou o agendamento antes.
     */
    async updateStatus(id, { de, para, canceladoEm = null }) {
      if (!isUuid(id)) return null;
      const row = unwrap(await db.from('agendamentos')
        .update({ status: para, ...(canceladoEm ? { cancelado_em: canceladoEm } : {}) })
        .eq('id', id)
        .in('status', de)
        .select('*')
        .maybeSingle());
      return row ? toAgendamento(row) : null;
    },
  };

  return {
    perfis, servicos, barbeiros, agendamentos,
  };
}
