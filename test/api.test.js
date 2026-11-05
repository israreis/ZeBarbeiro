import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { JsonStore } from '../server/db/store.js';
import { hashPassword } from '../server/auth/password.js';

const SENHA = 'senha-forte-1';
const HOJE = { date: '2026-11-05', time: '10:00' }; // quinta-feira

const testConfig = {
  publicDir: new URL('../public', import.meta.url).pathname,
  sessionTtlMs: 60_000,
  maxBodyBytes: 64 * 1024,
  timeZone: 'America/Sao_Paulo',
  loginRateLimit: { maxAttempts: 3, windowMs: 60_000 },
};

let senhaHash;
let server;
let baseUrl;
let store;

async function buildFixture() {
  const usuario = (id, perfil, email) => ({
    id, nome: `Usuário ${id}`, email, telefone: '(31)99999-0000', dataNascimento: '', perfil, senhaHash,
  });
  return {
    usuarios: [
      usuario('adm', 'administrador', 'adm@teste.com'),
      usuario('b1', 'barbeiro', 'b1@teste.com'),
      usuario('b2', 'barbeiro', 'b2@teste.com'),
      usuario('c1', 'cliente', 'c1@teste.com'),
      usuario('c2', 'cliente', 'c2@teste.com'),
    ],
    barbeiros: [
      {
        id: 'b1', ativo: true, servicoIds: ['s1'], diasDisponiveis: ['quinta', 'sexta', 'sabado'],
        horarioInicial: '08:00', horarioFinal: '12:00',
      },
      {
        id: 'b2', ativo: false, servicoIds: ['s1'], diasDisponiveis: ['quinta'],
        horarioInicial: '08:00', horarioFinal: '12:00',
      },
    ],
    servicos: [
      { id: 's1', nome: 'Corte', valor: 50, duracaoMinutos: 30, ativo: true },
      { id: 's2', nome: 'Barba', valor: 40, duracaoMinutos: 30, ativo: false },
    ],
    unidades: [],
    agendamentos: [
      {
        id: 'a-c2', barbeiroId: 'b1', clienteId: 'c2', servicoId: 's1', data: '2026-11-06',
        horarioInicio: '09:00', horarioFim: '09:30', status: 'Agendado',
      },
      {
        id: 'a-hoje', barbeiroId: 'b1', clienteId: 'c1', servicoId: 's1', data: '2026-11-05',
        horarioInicio: '08:00', horarioFim: '08:30', status: 'Agendado',
      },
    ],
  };
}

async function api(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function login(email) {
  const res = await api('POST', '/api/auth/login', { body: { email, senha: SENHA } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

before(async () => {
  senhaHash = await hashPassword(SENHA);
});

beforeEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  store = JsonStore.inMemory(await buildFixture());
  ({ server } = createApp({ store, config: testConfig, clock: () => HOJE, logger: { error() {} } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

describe('autenticação', () => {
  test('login não expõe o hash da senha e aceita e-mail com maiúsculas', async () => {
    const res = await api('POST', '/api/auth/login', { body: { email: 'C1@Teste.com', senha: SENHA } });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.equal(res.body.usuario.perfil, 'cliente');
    assert.equal(res.body.usuario.senhaHash, undefined);
  });

  test('credenciais inválidas retornam 401 e bloqueiam após várias tentativas', async () => {
    for (let i = 0; i < 3; i += 1) {
      const res = await api('POST', '/api/auth/login', { body: { email: 'c1@teste.com', senha: 'errada' } });
      assert.equal(res.status, 401);
    }
    const bloqueado = await api('POST', '/api/auth/login', { body: { email: 'c1@teste.com', senha: SENHA } });
    assert.equal(bloqueado.status, 429);
  });

  test('rotas protegidas exigem token e logout invalida a sessão', async () => {
    assert.equal((await api('GET', '/api/auth/me')).status, 401);
    const token = await login('c1@teste.com');
    assert.equal((await api('GET', '/api/auth/me', { token })).status, 200);
    assert.equal((await api('POST', '/api/auth/logout', { token })).status, 204);
    assert.equal((await api('GET', '/api/auth/me', { token })).status, 401);
  });

  test('cadastro de cliente valida dados e impede e-mail duplicado', async () => {
    const dados = { nome: 'Novo', email: 'novo@teste.com', senha: 'abcdefgh', telefone: '31988887777' };
    const criado = await api('POST', '/api/clientes', { body: dados });
    assert.equal(criado.status, 201);
    assert.equal(criado.body.perfil, 'cliente');
    assert.equal(criado.body.telefone, '(31)98888-7777');

    assert.equal((await api('POST', '/api/clientes', { body: { ...dados, email: 'NOVO@teste.com' } })).status, 409);
    assert.equal((await api('POST', '/api/clientes', { body: { ...dados, email: 'x@teste.com', senha: '123' } })).status, 422);
  });

  test('cadastro público não permite escolher o perfil', async () => {
    const res = await api('POST', '/api/clientes', {
      body: { nome: 'X', email: 'x@teste.com', senha: 'abcdefgh', telefone: '31988887777', perfil: 'administrador' },
    });
    assert.equal(res.body.perfil, 'cliente');
  });

  test('troca de senha exige a senha atual e encerra outras sessões', async () => {
    const outraSessao = await login('c1@teste.com');
    const token = await login('c1@teste.com');
    const errada = await api('PUT', '/api/auth/senha', { token, body: { senhaAtual: 'x', novaSenha: 'nova-senha-1' } });
    assert.equal(errada.status, 422);

    const ok = await api('PUT', '/api/auth/senha', { token, body: { senhaAtual: SENHA, novaSenha: 'nova-senha-1' } });
    assert.equal(ok.status, 204);
    assert.equal((await api('GET', '/api/auth/me', { token })).status, 200);
    assert.equal((await api('GET', '/api/auth/me', { token: outraSessao })).status, 401);
  });
});

describe('autorização por perfil', () => {
  test('cliente não acessa cadastros administrativos', async () => {
    const token = await login('c1@teste.com');
    assert.equal((await api('GET', '/api/unidades', { token })).status, 403);
    assert.equal((await api('GET', '/api/barbeiros/b1', { token })).status, 403);
    assert.equal((await api('POST', '/api/servicos', { token, body: {} })).status, 403);
  });

  test('cliente vê apenas barbeiros e serviços ativos, sem dados pessoais', async () => {
    const token = await login('c1@teste.com');
    const { body } = await api('GET', '/api/barbeiros', { token });
    assert.deepEqual(body.map((b) => b.id), ['b1']);
    assert.equal(body[0].email, undefined);
    const servicos = await api('GET', '/api/servicos', { token });
    assert.deepEqual(servicos.body.map((s) => s.id), ['s1']);
  });

  test('administrador cadastra barbeiro de forma atômica e não recebe a senha', async () => {
    const token = await login('adm@teste.com');
    const novo = {
      nome: 'Barbeiro Novo', email: 'bn@teste.com', senha: 'abcdefgh', telefone: '31977776666',
      servicoIds: ['s1'], diasDisponiveis: ['segunda'], horarioInicial: '09:00', horarioFinal: '18:00',
    };
    const res = await api('POST', '/api/barbeiros', { token, body: novo });
    assert.equal(res.status, 201);
    assert.equal(res.body.senhaHash, undefined);
    assert.equal(res.body.ativo, true);

    const invalido = await api('POST', '/api/barbeiros', { token, body: { ...novo, email: 'b2@teste.com' } });
    assert.equal(invalido.status, 409);
    assert.equal(store.snapshot.usuarios.filter((u) => u.email === 'b2@teste.com').length, 1);

    const servicoInexistente = await api('POST', '/api/barbeiros', {
      token, body: { ...novo, email: 'outro@teste.com', servicoIds: ['nao-existe'] },
    });
    assert.equal(servicoInexistente.status, 422);
  });
});

describe('agenda e agendamentos', () => {
  test('cliente vê horários livres e os próprios, mas não os de outros clientes', async () => {
    const token = await login('c1@teste.com');
    const { body } = await api('GET', '/api/agenda?barbeiroId=b1&data=2026-11-06', { token });
    assert.equal(body.atende, true);
    const horarios = body.horarios.map((h) => h.horario);
    assert.ok(!horarios.includes('09:00'), 'horário de outro cliente não deve aparecer');
    assert.equal(horarios.at(-1), '11:30', 'último horário termina no fim do expediente');
  });

  test('agenda informa quando o barbeiro não atende no dia', async () => {
    const token = await login('c1@teste.com');
    const { body } = await api('GET', '/api/agenda?barbeiroId=b1&data=2026-11-09', { token });
    assert.deepEqual(body, { data: '2026-11-09', atende: false, horarios: [] });
  });

  test('sábado é tratado corretamente', async () => {
    const token = await login('b1@teste.com');
    const { body } = await api('GET', '/api/agenda?data=2026-11-07', { token });
    assert.equal(body.atende, true);
  });

  test('cliente agenda horários livres e não consegue reservar ocupados, passados ou fora do expediente', async () => {
    const token = await login('c1@teste.com');
    const reserva = (horarios, extra = {}) => api('POST', '/api/agendamentos', {
      token, body: { barbeiroId: 'b1', servicoId: 's1', data: '2026-11-06', horarios, ...extra },
    });

    const ok = await reserva(['10:00', '10:30']);
    assert.equal(ok.status, 201);
    assert.equal(ok.body.length, 2);

    assert.equal((await reserva(['09:00'])).status, 409);
    assert.equal((await reserva(['12:00'])).status, 422);
    assert.equal((await reserva(['08:00'], { data: '2026-11-05' })).status, 422);
    assert.equal((await reserva(['08:00'], { data: '2026-11-09' })).status, 422);
    assert.equal((await reserva(['08:00'], { servicoId: 's2' })).status, 422);
    assert.equal((await reserva(['08:00'], { barbeiroId: 'b2' })).status, 404);
  });

  test('reserva de vários horários é atômica', async () => {
    const token = await login('c1@teste.com');
    const res = await api('POST', '/api/agendamentos', {
      token, body: { barbeiroId: 'b1', servicoId: 's1', data: '2026-11-06', horarios: ['08:00', '09:00'] },
    });
    assert.equal(res.status, 409);
    assert.equal(store.snapshot.agendamentos.length, 2);
  });

  test('reservas simultâneas do mesmo horário não geram duplicidade', async () => {
    const [t1, t2] = [await login('c1@teste.com'), await login('c2@teste.com')];
    const body = { barbeiroId: 'b1', servicoId: 's1', data: '2026-11-06', horarios: ['11:00'] };
    const results = await Promise.all([
      api('POST', '/api/agendamentos', { token: t1, body }),
      api('POST', '/api/agendamentos', { token: t2, body }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  });

  test('cliente cancela apenas os próprios agendamentos futuros e o horário é liberado', async () => {
    const token = await login('c2@teste.com');
    assert.equal((await api('PATCH', '/api/agendamentos/a-hoje/cancelar', { token })).status, 404);

    const ok = await api('PATCH', '/api/agendamentos/a-c2/cancelar', { token });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.status, 'Cancelado');

    const agenda = await api('GET', '/api/agenda?barbeiroId=b1&data=2026-11-06', { token });
    assert.ok(agenda.body.horarios.some((h) => h.horario === '09:00' && !h.agendamento));

    const c1 = await login('c1@teste.com');
    assert.equal((await api('PATCH', '/api/agendamentos/a-hoje/cancelar', { token: c1 })).status, 422);
  });

  test('barbeiro bloqueia horários da própria agenda e conclui atendimentos', async () => {
    const token = await login('b1@teste.com');
    const bloqueio = await api('POST', '/api/agendamentos', {
      token, body: { data: '2026-11-06', horarios: ['08:00'], tipo: 'Bloqueado' },
    });
    assert.equal(bloqueio.status, 201);
    assert.equal(bloqueio.body[0].status, 'Bloqueado');

    const tipoInvalido = await api('POST', '/api/agendamentos', {
      token, body: { data: '2026-11-06', horarios: ['08:30'], tipo: 'Concluído' },
    });
    assert.equal(tipoInvalido.status, 422);

    assert.equal((await api('PATCH', '/api/agendamentos/a-hoje/concluir', { token })).status, 200);
    assert.equal((await api('PATCH', '/api/agendamentos/a-c2/concluir', { token })).status, 422, 'data futura');
    assert.equal((await api('PATCH', '/api/agendamentos/a-c2/cancelar', { token })).status, 422, 'agendamento de cliente');
  });

  test('barbeiro não altera agendamentos de outro barbeiro', async () => {
    const token = await login('b2@teste.com');
    assert.equal((await api('PATCH', '/api/agendamentos/a-hoje/concluir', { token })).status, 404);
    const agenda = await api('GET', '/api/agenda?barbeiroId=b1&data=2026-11-05', { token });
    assert.equal(agenda.body.atende, true);
    assert.ok(agenda.body.horarios.every((h) => !h.agendamento), 'barbeiro só enxerga a própria agenda');
  });

  test('histórico filtra por período e situação respeitando o perfil', async () => {
    const barbeiro = await login('b1@teste.com');
    await api('PATCH', '/api/agendamentos/a-hoje/concluir', { token: barbeiro });

    const c1 = await login('c1@teste.com');
    const query = '?inicio=2026-11-01&fim=2026-11-30';
    const concluidos = await api('GET', `/api/agendamentos${query}&situacao=concluidos`, { token: c1 });
    assert.deepEqual(concluidos.body.map((a) => a.id), ['a-hoje']);
    const pendentes = await api('GET', `/api/agendamentos${query}&situacao=pendentes`, { token: c1 });
    assert.deepEqual(pendentes.body, []);

    const periodoInvalido = await api('GET', '/api/agendamentos?inicio=2026-11-30&fim=2026-11-01', { token: c1 });
    assert.equal(periodoInvalido.status, 422);
  });
});

describe('servidor HTTP', () => {
  test('envia cabeçalhos de segurança e serve apenas arquivos públicos', async () => {
    const pagina = await fetch(`${baseUrl}/`);
    assert.equal(pagina.status, 200);
    assert.match(pagina.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(pagina.headers.get('x-content-type-options'), 'nosniff');

    for (const path of ['/../data/seed.json', '/%2e%2e/package.json', '/%2e%2e%2fserver/config.js']) {
      assert.equal((await fetch(`${baseUrl}${path}`)).status, 404, path);
    }
  });

  test('CSS e JS são revalidados a cada acesso (ETag) para não usar versão antiga', async () => {
    const primeira = await fetch(`${baseUrl}/css/base.css`);
    assert.equal(primeira.status, 200);
    assert.equal(primeira.headers.get('cache-control'), 'no-cache');
    const etag = primeira.headers.get('etag');
    assert.ok(etag);

    const revalidacao = await fetch(`${baseUrl}/css/base.css`, { headers: { 'if-none-match': etag } });
    assert.equal(revalidacao.status, 304);
  });

  test('rejeita JSON inválido e rotas inexistentes', async () => {
    const invalido = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    });
    assert.equal(invalido.status, 400);
    assert.equal((await api('GET', '/api/nao-existe')).status, 404);
    assert.equal((await api('DELETE', '/api/servicos')).status, 405);
  });
});
