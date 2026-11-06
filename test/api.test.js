import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';
import { baseConfig } from '../server/config.js';
import {
  createMemoryIdentity, createMemoryPhotoStorage, createMemoryRepositories,
} from './support/memory-adapters.js';

const SENHA = 'senha-forte-1';
const HOJE = { date: '2026-11-05', time: '10:00' }; // quinta-feira

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const testConfig = {
  ...baseConfig,
  maxUploadBytes: 1024 * 1024,
  timeZone: 'America/Sao_Paulo',
  loginRateLimit: { maxAttempts: 3, windowMs: 60_000 },
  apiRateLimitPerMinute: 10_000,
  supabase: { url: 'https://projeto.supabase.co' },
};

let app;
let repos;
let identity;
let photos;

function buildFixture() {
  const perfil = (id, tipo, email) => ({
    id, nome: `Usuário ${id}`, email, telefone: '(31)99999-0000', dataNascimento: '1990-01-01', perfil: tipo,
  });
  return {
    perfis: [
      perfil('adm', 'administrador', 'adm@teste.com'),
      perfil('b1', 'barbeiro', 'b1@teste.com'),
      perfil('b2', 'barbeiro', 'b2@teste.com'),
      perfil('c1', 'cliente', 'c1@teste.com'),
      perfil('c2', 'cliente', 'c2@teste.com'),
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
    agendamentos: [
      {
        id: 'a-c2', barbeiroId: 'b1', clienteId: 'c2', servicoId: 's1', valor: 50, data: '2026-11-06',
        horarioInicio: '09:00', horarioFim: '09:30', status: 'Agendado',
      },
      {
        id: 'a-hoje', barbeiroId: 'b1', clienteId: 'c1', servicoId: 's1', valor: 50, data: '2026-11-05',
        horarioInicio: '08:00', horarioFim: '08:30', status: 'Agendado',
      },
    ],
  };
}

/** Faz uma requisição à API sem abrir porta (Fastify inject). */
async function api(method, url, { token, body, headers = {}, raw } = {}) {
  const res = await app.inject({
    method,
    url,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    payload: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const isJson = (res.headers['content-type'] ?? '').startsWith('application/json');
  return {
    status: res.statusCode, body: isJson && res.body ? res.json() : null, headers: res.headers, raw: res.rawPayload,
  };
}

async function login(email, senha = SENHA) {
  const res = await api('POST', '/api/auth/login', { body: { email, senha } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

beforeEach(async () => {
  if (app) await app.close();
  const fixture = buildFixture();
  repos = createMemoryRepositories(fixture);
  identity = createMemoryIdentity(fixture.perfis.map((p) => ({ id: p.id, email: p.email, senha: SENHA })));
  photos = createMemoryPhotoStorage();
  app = await buildApp({
    repos, identity, photos, config: testConfig, clock: () => HOJE,
  });
});

describe('autenticação', () => {
  test('login não expõe o hash da senha e aceita e-mail com maiúsculas', async () => {
    const res = await api('POST', '/api/auth/login', { body: { email: 'C1@Teste.com', senha: SENHA } });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.ok(res.body.refreshToken);
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

  test('refresh token renova a sessão e o token antigo deixa de valer', async () => {
    const { body: sessao } = await api('POST', '/api/auth/login', { body: { email: 'c1@teste.com', senha: SENHA } });
    const renovada = await api('POST', '/api/auth/refresh', { body: { refreshToken: sessao.refreshToken } });
    assert.equal(renovada.status, 200);
    assert.notEqual(renovada.body.token, sessao.token);
    assert.equal((await api('GET', '/api/auth/me', { token: renovada.body.token })).status, 200);
    assert.equal((await api('GET', '/api/auth/me', { token: sessao.token })).status, 401);
    assert.equal((await api('POST', '/api/auth/refresh', { body: { refreshToken: 'invalido' } })).status, 401);
  });

  test('cadastro de cliente valida dados e impede e-mail duplicado', async () => {
    const dados = {
      nome: 'Novo', email: 'novo@teste.com', senha: 'abcdefgh', telefone: '31988887777', dataNascimento: '2000-05-10',
    };
    const criado = await api('POST', '/api/clientes', { body: dados });
    assert.equal(criado.status, 201);
    assert.equal(criado.body.perfil, 'cliente');
    assert.equal(criado.body.telefone, '(31)98888-7777');
    assert.equal((await api('POST', '/api/auth/login', { body: { email: 'novo@teste.com', senha: 'abcdefgh' } })).status, 200);

    assert.equal((await api('POST', '/api/clientes', { body: { ...dados, email: 'NOVO@teste.com' } })).status, 409);
    assert.equal((await api('POST', '/api/clientes', { body: { ...dados, email: 'x@teste.com', senha: '123' } })).status, 422);
  });

  test('cadastro exige data de nascimento e bloqueia menores de 16 anos', async () => {
    const base = { nome: 'Jovem', email: 'jovem@teste.com', senha: 'abcdefgh', telefone: '31988887777' };
    const semData = await api('POST', '/api/clientes', { body: base });
    assert.equal(semData.status, 422);

    // HOJE = 2026-11-05: quem nasceu em 2010-11-06 ainda tem 15 anos.
    const menor = await api('POST', '/api/clientes', { body: { ...base, dataNascimento: '2010-11-06' } });
    assert.equal(menor.status, 422);
    assert.match(menor.body.erro, /responsável/);

    const dezesseis = await api('POST', '/api/clientes', { body: { ...base, dataNascimento: '2010-11-05' } });
    assert.equal(dezesseis.status, 201);

    const futura = await api('POST', '/api/clientes', {
      body: { ...base, email: 'outro@teste.com', dataNascimento: '2030-01-01' },
    });
    assert.equal(futura.status, 422);
  });

  test('cadastro público não permite escolher o perfil', async () => {
    const res = await api('POST', '/api/clientes', {
      body: {
        nome: 'X',
        email: 'x@teste.com',
        senha: 'abcdefgh',
        telefone: '31988887777',
        dataNascimento: '2000-05-10',
        perfil: 'administrador',
      },
    });
    assert.equal(res.body.perfil, 'cliente');
  });

  test('usuário edita os próprios dados; trocar o e-mail exige a senha atual', async () => {
    const token = await login('c1@teste.com');
    const dados = { nome: 'Novo Nome', email: 'c1@teste.com', telefone: '31911112222', dataNascimento: '1990-01-01' };

    const ok = await api('PUT', '/api/auth/me', { token, body: { ...dados, perfil: 'administrador' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.nome, 'Novo Nome');
    assert.equal(ok.body.perfil, 'cliente', 'perfil não pode ser alterado');

    const semSenha = await api('PUT', '/api/auth/me', { token, body: { ...dados, email: 'novo@teste.com' } });
    assert.equal(semSenha.status, 422);
    const duplicado = await api('PUT', '/api/auth/me', {
      token, body: { ...dados, email: 'c2@teste.com', senhaAtual: SENHA },
    });
    assert.equal(duplicado.status, 409);
    const comSenha = await api('PUT', '/api/auth/me', {
      token, body: { ...dados, email: 'novo@teste.com', senhaAtual: SENHA },
    });
    assert.equal(comSenha.status, 200);
    assert.equal(comSenha.body.email, 'novo@teste.com');
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
      nome: 'Barbeiro Novo', email: 'bn@teste.com', senha: 'abcdefgh', telefone: '31977776666', dataNascimento: '1995-02-03',
      servicoIds: ['s1'], diasDisponiveis: ['segunda'], horarioInicial: '09:00', horarioFinal: '18:00',
    };
    const res = await api('POST', '/api/barbeiros', { token, body: novo });
    assert.equal(res.status, 201);
    assert.equal(res.body.senhaHash, undefined);
    assert.equal(res.body.ativo, true);

    assert.equal((await api('POST', '/api/auth/login', { body: { email: 'bn@teste.com', senha: 'abcdefgh' } })).status, 200);

    const usuariosAntes = identity.users.size;
    const invalido = await api('POST', '/api/barbeiros', { token, body: { ...novo, email: 'b2@teste.com' } });
    assert.equal(invalido.status, 409);
    assert.equal(repos.tables.perfis.filter((u) => u.email === 'b2@teste.com').length, 1);
    assert.equal(identity.users.size, usuariosAntes, 'nenhum login órfão no Auth');

    const servicoInexistente = await api('POST', '/api/barbeiros', {
      token, body: { ...novo, email: 'outro@teste.com', servicoIds: ['nao-existe'] },
    });
    assert.equal(servicoInexistente.status, 422);
  });

  test('cadastro desfaz o login criado no Auth se o perfil não puder ser salvo', async () => {
    const insert = repos.perfis.insert;
    repos.perfis.insert = async () => { throw new Error('falha simulada no banco'); };
    const usuariosAntes = identity.users.size;
    const res = await api('POST', '/api/clientes', {
      body: {
        nome: 'Z', email: 'z@teste.com', senha: 'abcdefgh', telefone: '31988887777', dataNascimento: '2000-05-10',
      },
    });
    repos.perfis.insert = insert;
    assert.equal(res.status, 500);
    assert.equal(res.body.erro, 'Erro interno do servidor.', 'detalhes internos não vazam');
    assert.equal(identity.users.size, usuariosAntes);
  });

  test('administrador redefine a senha do barbeiro e encerra as sessões dele', async () => {
    const sessaoBarbeiro = await login('b1@teste.com');
    const admin = await login('adm@teste.com');
    const atual = (await api('GET', '/api/barbeiros/b1', { token: admin })).body;
    const res = await api('PUT', '/api/barbeiros/b1', {
      token: admin,
      body: {
        ...atual, servicoIds: atual.servicoIds, novaSenha: 'senha-nova-123', nome: 'Barbeiro Renomeado',
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.nome, 'Barbeiro Renomeado');
    assert.equal((await api('GET', '/api/auth/me', { token: sessaoBarbeiro })).status, 401);
    await login('b1@teste.com', 'senha-nova-123');
  });
});

describe('foto do barbeiro', () => {
  const upload = (token, payload, url = '/api/barbeiros/b1/foto', contentType = 'image/png') => api('PUT', url, {
    token, headers: { 'content-type': contentType }, raw: payload,
  });

  test('administrador envia, substitui e remove a foto; clientes recebem a URL pública', async () => {
    const token = await login('adm@teste.com');
    const res = await upload(token, PNG_1X1);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { fotoUrl } = res.body;
    assert.match(fotoUrl, /^https:\/\/storage\.teste\/fotos-barbeiros\/barbeiros\/[0-9a-f-]{36}\.png$/);

    const nova = (await upload(token, PNG_1X1)).body;
    assert.notEqual(nova.fotoUrl, fotoUrl, 'nova foto gera nova URL');
    assert.equal(photos.files.size, 1, 'arquivo anterior é apagado');

    const cliente = await login('c1@teste.com');
    const lista = await api('GET', '/api/barbeiros', { token: cliente });
    assert.equal(lista.body[0].fotoUrl, nova.fotoUrl);

    assert.equal((await api('DELETE', '/api/barbeiros/b1/foto', { token })).status, 204);
    assert.equal(photos.files.size, 0);
    assert.equal((await api('GET', '/api/barbeiros/b1', { token })).body.fotoUrl, null);
  });

  test('rejeita arquivos que não são imagem, mesmo com Content-Type de imagem, e arquivos grandes', async () => {
    const token = await login('adm@teste.com');
    assert.equal((await upload(token, Buffer.from('<script>alert(1)</script>'))).status, 422);
    assert.equal((await upload(token, Buffer.alloc(2 * 1024 * 1024))).status, 413);
    assert.equal((await upload(token, PNG_1X1, undefined, 'text/html')).status, 415);
  });

  test('barbeiro troca e remove a própria foto pela conta', async () => {
    const token = await login('b1@teste.com');
    const res = await upload(token, PNG_1X1, '/api/auth/me/foto');
    assert.equal(res.status, 200);
    const { fotoUrl } = res.body;
    assert.ok(fotoUrl);
    assert.equal((await api('GET', '/api/auth/me', { token })).body.fotoUrl, fotoUrl);

    assert.equal((await api('DELETE', '/api/auth/me/foto', { token })).status, 204);
    assert.equal((await api('GET', '/api/auth/me', { token })).body.fotoUrl, null);

    const cliente = await login('c1@teste.com');
    assert.equal((await api('DELETE', '/api/auth/me/foto', { token: cliente })).status, 403);
  });

  test('somente o administrador pode enviar foto de qualquer barbeiro', async () => {
    const token = await login('b1@teste.com');
    assert.equal((await upload(token, PNG_1X1)).status, 403);
  });
});

describe('agenda e agendamentos', () => {
  test('disponibilidade lista só horários livres e futuros, sem dados de outros clientes', async () => {
    const token = await login('c1@teste.com');
    const { status, body } = await api('GET', '/api/disponibilidade?servicoId=s1&data=2026-11-06', { token });
    assert.equal(status, 200);
    assert.equal(body.servico.valor, 50);
    assert.deepEqual(body.barbeiros.map((b) => b.barbeiro.id), ['b1'], 'só barbeiros ativos que fazem o serviço');
    const { horarios } = body.barbeiros[0];
    assert.ok(!horarios.includes('09:00'), 'horário ocupado não aparece');
    assert.equal(horarios.at(-1), '11:30', 'último horário termina no fim do expediente');
    assert.equal(JSON.stringify(body).includes('Usuário c2'), false, 'não expõe quem ocupa os horários');

    const hoje = await api('GET', '/api/disponibilidade?servicoId=s1&data=2026-11-05', { token });
    assert.ok(hoje.body.barbeiros[0].horarios.every((h) => h > '10:00'), 'horários passados não aparecem');

    const naoAtende = await api('GET', '/api/disponibilidade?servicoId=s1&barbeiroId=b1&data=2026-11-09', { token });
    assert.equal(naoAtende.body.barbeiros[0].atende, false);
    assert.deepEqual(naoAtende.body.barbeiros[0].horarios, []);

    assert.equal((await api('GET', '/api/disponibilidade?servicoId=s2&data=2026-11-06', { token })).status, 404);
  });

  test('cliente não acessa a agenda completa do barbeiro', async () => {
    const token = await login('c1@teste.com');
    assert.equal((await api('GET', '/api/agenda?barbeiroId=b1&data=2026-11-06', { token })).status, 403);
  });

  test('agenda informa quando o barbeiro não atende no dia', async () => {
    const token = await login('adm@teste.com');
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
    assert.equal(repos.tables.agendamentos.length, 2);
  });

  test('o banco recusa reserva duplicada mesmo se a verificação prévia não perceber', async () => {
    const token = await login('c1@teste.com');
    const listOcupados = repos.agendamentos.listOcupados;
    repos.agendamentos.listOcupados = async () => []; // simula a corrida entre consulta e INSERT
    const res = await api('POST', '/api/agendamentos', {
      token, body: { barbeiroId: 'b1', servicoId: 's1', data: '2026-11-06', horarios: ['09:00'] },
    });
    repos.agendamentos.listOcupados = listOcupados;
    assert.equal(res.status, 409);
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

    const livres = await api('GET', '/api/disponibilidade?servicoId=s1&data=2026-11-06', { token });
    assert.ok(livres.body.barbeiros[0].horarios.includes('09:00'));

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

  test('barbeiro inclui atendimento manual informando o nome do cliente', async () => {
    const token = await login('b1@teste.com');
    const incluir = (extra) => api('POST', '/api/agendamentos', {
      token, body: { data: '2026-11-06', tipo: 'Agendado Barbeiro', servicoId: 's1', ...extra },
    });

    const ok = await incluir({ horarios: ['08:00'], clienteNome: 'Carlos', clienteTelefone: '31988887777' });
    assert.equal(ok.status, 201);
    assert.equal(ok.body[0].cliente, 'Carlos');
    assert.equal(ok.body[0].servico.valor, 50);
    assert.equal(ok.body[0].status, 'Agendado Barbeiro');
    assert.equal(ok.body[0].barbeiro, 'Usuário b1', 'atendimento atribuído ao barbeiro logado');

    assert.equal((await incluir({ horarios: ['10:00'] })).status, 422, 'nome do cliente obrigatório');
    assert.equal((await incluir({ horarios: ['10:00'], clienteNome: 'X', servicoId: 's2' })).status, 422, 'serviço inativo');
    assert.equal((await incluir({ horarios: ['08:00'], clienteNome: 'Outro' })).status, 409, 'horário já ocupado');
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

describe('relatórios', () => {
  const periodo = '?inicio=2026-11-01&fim=2026-11-30';

  test('administrador vê todos os barbeiros; barbeiro só os próprios dados', async () => {
    const barbeiro = await login('b1@teste.com');
    await api('PATCH', '/api/agendamentos/a-hoje/concluir', { token: barbeiro });

    const admin = await login('adm@teste.com');
    const geral = await api('GET', `/api/relatorios${periodo}`, { token: admin });
    assert.equal(geral.status, 200);
    assert.equal(geral.body.resumo.agendamentos, 2);
    assert.equal(geral.body.resumo.concluidos, 1);
    assert.equal(geral.body.resumo.faturamento, 50);
    assert.ok(geral.body.insights.length > 0);

    const proprio = await api('GET', `/api/relatorios${periodo}&barbeiroId=b2`, { token: barbeiro });
    assert.equal(proprio.status, 200);
    assert.equal(proprio.body.barbeiro.id, 'b1', 'barbeiro não consegue ver dados de outro barbeiro');

    const cliente = await login('c1@teste.com');
    assert.equal((await api('GET', `/api/relatorios${periodo}`, { token: cliente })).status, 403);
  });

  test('exporta PDF e Excel', async () => {
    const token = await login('adm@teste.com');

    const pdf = await api('GET', `/api/relatorios/pdf${periodo}`, { token });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.match(pdf.headers['content-disposition'], /attachment; filename="relatorio-ze-barbeiro-2026-11-01-a-2026-11-30\.pdf"/);
    assert.equal(pdf.raw.subarray(0, 5).toString(), '%PDF-');

    const xlsx = await api('GET', `/api/relatorios/xlsx${periodo}`, { token });
    assert.equal(xlsx.status, 200);
    assert.equal(xlsx.raw.subarray(0, 2).toString(), 'PK');
  });

  test('valida o período', async () => {
    const token = await login('adm@teste.com');
    assert.equal((await api('GET', '/api/relatorios?inicio=2026-11-30&fim=2026-11-01', { token })).status, 422);
    assert.equal((await api('GET', '/api/relatorios?inicio=2024-01-01&fim=2026-11-01', { token })).status, 422);
  });
});

describe('servidor HTTP', () => {
  test('envia cabeçalhos de segurança e serve apenas arquivos públicos', async () => {
    const pagina = await api('GET', '/');
    assert.equal(pagina.status, 200);
    const csp = pagina.headers['content-security-policy'];
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /img-src 'self' data: blob: https:\/\/projeto\.supabase\.co/);
    assert.equal(pagina.headers['x-content-type-options'], 'nosniff');
    assert.equal(pagina.headers['x-frame-options'], 'DENY');

    for (const path of ['/../data/seed.json', '/%2e%2e/package.json', '/%2e%2e%2fserver/config.js', '/.env']) {
      assert.ok([403, 404].includes((await api('GET', path)).status), path);
    }
  });

  test('CSS e JS são revalidados a cada acesso (ETag) para não usar versão antiga', async () => {
    const primeira = await api('GET', '/css/base.css');
    assert.equal(primeira.status, 200);
    assert.equal(primeira.headers['cache-control'], 'no-cache');
    const { etag } = primeira.headers;
    assert.ok(etag);

    const revalidacao = await api('GET', '/css/base.css', { headers: { 'if-none-match': etag } });
    assert.equal(revalidacao.status, 304);
  });

  test('respostas da API não são guardadas em cache', async () => {
    const token = await login('c1@teste.com');
    assert.equal((await api('GET', '/api/auth/me', { token })).headers['cache-control'], 'no-store');
  });

  test('rejeita JSON inválido e rotas inexistentes', async () => {
    const invalido = await api('POST', '/api/auth/login', { headers: { 'content-type': 'application/json' }, raw: '{' });
    assert.equal(invalido.status, 400);
    assert.equal(invalido.body.erro, 'O corpo da requisição não é um JSON válido.');
    assert.equal((await api('GET', '/api/nao-existe')).status, 404);
    assert.equal((await api('DELETE', '/api/servicos')).status, 404);
  });
});
