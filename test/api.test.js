import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { JsonStore } from '../server/db/store.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hashPassword } from '../server/auth/password.js';

const SENHA = 'senha-forte-1';
const HOJE = { date: '2026-11-05', time: '10:00' }; // quinta-feira

const uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'barberapp-uploads-'));
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const testConfig = {
  uploadsDir,
  maxUploadBytes: 1024 * 1024,
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

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(uploadsDir, { recursive: true, force: true });
});

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
    const dados = {
      nome: 'Novo', email: 'novo@teste.com', senha: 'abcdefgh', telefone: '31988887777', dataNascimento: '2000-05-10',
    };
    const criado = await api('POST', '/api/clientes', { body: dados });
    assert.equal(criado.status, 201);
    assert.equal(criado.body.perfil, 'cliente');
    assert.equal(criado.body.telefone, '(31)98888-7777');

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

    const invalido = await api('POST', '/api/barbeiros', { token, body: { ...novo, email: 'b2@teste.com' } });
    assert.equal(invalido.status, 409);
    assert.equal(store.snapshot.usuarios.filter((u) => u.email === 'b2@teste.com').length, 1);

    const servicoInexistente = await api('POST', '/api/barbeiros', {
      token, body: { ...novo, email: 'outro@teste.com', servicoIds: ['nao-existe'] },
    });
    assert.equal(servicoInexistente.status, 422);
  });
});

describe('foto do barbeiro', () => {
  const upload = (token, body, contentType = 'image/png') => fetch(`${baseUrl}/api/barbeiros/b1/foto`, {
    method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': contentType }, body,
  });

  test('administrador envia, substitui e remove a foto; qualquer pessoa pode vê-la', async () => {
    const token = await login('adm@teste.com');
    const res = await upload(token, PNG_1X1);
    assert.equal(res.status, 200);
    const { fotoUrl } = await res.json();
    assert.match(fotoUrl, /^\/api\/barbeiros\/b1\/foto\?v=/);

    const imagem = await fetch(`${baseUrl}${fotoUrl}`);
    assert.equal(imagem.status, 200);
    assert.equal(imagem.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await imagem.arrayBuffer()), PNG_1X1);

    const nova = await (await upload(token, PNG_1X1)).json();
    assert.notEqual(nova.fotoUrl, fotoUrl, 'nova foto gera nova URL');
    assert.equal((await fs.readdir(uploadsDir)).length, 1, 'arquivo anterior é apagado');

    const cliente = await login('c1@teste.com');
    const lista = await api('GET', '/api/barbeiros', { token: cliente });
    assert.equal(lista.body[0].fotoUrl, nova.fotoUrl);

    assert.equal((await api('DELETE', '/api/barbeiros/b1/foto', { token })).status, 204);
    assert.equal((await fetch(`${baseUrl}${nova.fotoUrl}`)).status, 404);
    assert.equal((await fs.readdir(uploadsDir)).length, 0);
  });

  test('rejeita arquivos que não são imagem, mesmo com Content-Type de imagem, e arquivos grandes', async () => {
    const token = await login('adm@teste.com');
    assert.equal((await upload(token, Buffer.from('<script>alert(1)</script>'))).status, 422);
    assert.equal((await upload(token, Buffer.alloc(2 * 1024 * 1024))).status, 413);
  });

  test('barbeiro troca e remove a própria foto pela conta', async () => {
    const token = await login('b1@teste.com');
    const res = await fetch(`${baseUrl}/api/auth/me/foto`, {
      method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png' }, body: PNG_1X1,
    });
    assert.equal(res.status, 200);
    const { fotoUrl } = await res.json();
    assert.match(fotoUrl, /^\/api\/barbeiros\/b1\/foto/);
    assert.equal((await api('GET', '/api/auth/me', { token })).body.fotoUrl, fotoUrl);

    assert.equal((await api('DELETE', '/api/auth/me/foto', { token })).status, 204);
    assert.equal((await api('GET', '/api/auth/me', { token })).body.fotoUrl, null);

    const cliente = await login('c1@teste.com');
    assert.equal((await api('DELETE', '/api/auth/me/foto', { token: cliente })).status, 403);
  });

  test('somente o administrador pode enviar foto', async () => {
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
