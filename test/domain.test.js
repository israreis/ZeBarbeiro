import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPast, isValidIsoDate, isValidTime, nowInTimeZone, weekdayOf,
} from '../server/domain/time.js';
import { STATUS, findOccupant, generateSlots, slotEnd } from '../server/domain/agenda.js';
import { RateLimiter } from '../server/auth/rate-limiter.js';
import { SessionCache } from '../server/auth/session-cache.js';
import { withCache } from '../server/infra/cached-repositories.js';
import { detectImageType } from '../server/infra/image-type.js';
import {
  barbeiroSchema, cadastroClienteSchema, parse, servicoSchema,
} from '../server/schemas.js';

test('generateSlots respeita minutos e não ultrapassa o fim do expediente', () => {
  assert.deepEqual(generateSlots('16:00', '19:00'), ['16:00', '16:30', '17:00', '17:30', '18:00', '18:30']);
  assert.deepEqual(generateSlots('08:30', '10:00'), ['08:30', '09:00', '09:30']);
  assert.deepEqual(generateSlots('10:00', '10:15'), []);
  assert.equal(slotEnd('09:30'), '10:00');
});

test('weekdayOf não depende do fuso horário e cobre sábado', () => {
  assert.equal(weekdayOf('2026-11-05'), 'quinta');
  assert.equal(weekdayOf('2026-11-07'), 'sabado');
  assert.equal(weekdayOf('2026-11-08'), 'domingo');
});

test('validação de datas e horários', () => {
  assert.ok(isValidIsoDate('2024-02-29'));
  assert.ok(!isValidIsoDate('2023-02-29'));
  assert.ok(!isValidIsoDate('01/10/2024'));
  assert.ok(isValidTime('23:59'));
  assert.ok(!isValidTime('24:00'));
  assert.ok(!isValidTime('8:00'));
});

test('isPast compara data e horário', () => {
  const now = { date: '2026-11-05', time: '10:00' };
  assert.ok(isPast('2026-11-04', '23:30', now));
  assert.ok(isPast('2026-11-05', '10:00', now));
  assert.ok(!isPast('2026-11-05', '10:30', now));
  assert.ok(!isPast('2026-11-06', '08:00', now));
});

test('nowInTimeZone devolve data e hora no fuso informado', () => {
  const instant = new Date('2026-11-05T02:30:00Z');
  assert.deepEqual(nowInTimeZone('America/Sao_Paulo', instant), { date: '2026-11-04', time: '23:30' });
});

test('findOccupant ignora agendamentos cancelados', () => {
  const base = { barbeiroId: 'b1', data: '2026-11-06', horarioInicio: '09:00' };
  const slot = { barbeiroId: 'b1', data: '2026-11-06', horario: '09:00' };
  assert.equal(findOccupant([{ ...base, status: STATUS.CANCELADO }], slot), undefined);
  assert.ok(findOccupant([{ ...base, status: STATUS.BLOQUEADO }], slot));
});

test('rate limiter bloqueia após o limite e libera após a janela', () => {
  let now = 0;
  const limiter = new RateLimiter({ maxAttempts: 2, windowMs: 100, now: () => now });
  limiter.registerFailure('k');
  assert.ok(!limiter.isBlocked('k'));
  limiter.registerFailure('k');
  assert.ok(limiter.isBlocked('k'));
  now = 100;
  assert.ok(!limiter.isBlocked('k'));
});

const cliente = {
  nome: '  Fulano  ', email: '  Fulano@Exemplo.COM ', telefone: '31 97144 8208', dataNascimento: '2000-01-01', senha: 'Abcdef#12',
};

test('esquemas normalizam entradas e descartam campos desconhecidos', () => {
  const dados = parse(cadastroClienteSchema('2026-11-05'), { ...cliente, perfil: 'administrador' });
  assert.equal(dados.nome, 'Fulano');
  assert.equal(dados.email, 'fulano@exemplo.com');
  assert.equal(dados.telefone, '(31)97144-8208');
  assert.equal(dados.perfil, undefined);
  assert.equal(parse(cadastroClienteSchema('2026-11-05'), { ...cliente, telefone: '3133311811' }).telefone, '(31)3331-1811');
  assert.equal(parse(servicoSchema, { nome: 'Corte', valor: '49,99', duracaoMinutos: '30' }).valor, 49.99);
});

test('esquemas devolvem mensagens claras (422)', () => {
  const erro = (fn) => {
    try {
      fn();
    } catch (error) {
      return error;
    }
    assert.fail('deveria ter lançado erro');
  };
  const hoje = '2026-11-05';
  assert.match(erro(() => parse(cadastroClienteSchema(hoje), { ...cliente, senha: '1234567' })).message, /pelo menos 8/);
  assert.match(erro(() => parse(cadastroClienteSchema(hoje), { ...cliente, senha: 'abcdef#12' })).message, /maiúscula/);
  assert.match(erro(() => parse(cadastroClienteSchema(hoje), { ...cliente, senha: 'ABCDEF#12' })).message, /minúscula/);
  assert.match(erro(() => parse(cadastroClienteSchema(hoje), { ...cliente, senha: 'Abcdef#gh' })).message, /número/);
  assert.match(erro(() => parse(cadastroClienteSchema(hoje), { ...cliente, senha: 'Abcdef123' })).message, /especial/);
  assert.match(erro(() => parse(cadastroClienteSchema(hoje), { ...cliente, telefone: '1234' })).message, /telefone válido/);
  assert.match(erro(() => parse(cadastroClienteSchema(hoje), { ...cliente, dataNascimento: '2010-11-06' })).message, /responsável/);
  assert.equal(erro(() => parse(cadastroClienteSchema(hoje), {})).status, 422);

  const barbeiro = {
    ...cliente, servicoIds: ['s1'], diasDisponiveis: ['sexta', 'segunda'], horarioInicial: '08:00', horarioFinal: '08:15',
  };
  assert.match(erro(() => parse(barbeiroSchema(hoje, ['s1'], { criacao: true }), barbeiro)).message, /30 minutos/);
  const ok = parse(barbeiroSchema(hoje, ['s1'], { criacao: true }), { ...barbeiro, horarioFinal: '12:00' });
  assert.deepEqual(ok.diasDisponiveis, ['segunda', 'sexta'], 'dias ordenados');
});

test('fotos são reconhecidas pelo conteúdo, não pelo tipo informado', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  assert.deepEqual(detectImageType(png), { ext: 'png', contentType: 'image/png' });
  assert.equal(detectImageType(Buffer.from('<svg onload=alert(1)>    ')), null);
});

test('cache de sessão expira, respeita invalidações e guarda o token só como hash', () => {
  let now = 0;
  const cache = new SessionCache({ ttlMs: 100, now: () => now });
  const usuario = { id: 'u1', nome: 'A' };
  cache.set('tok-1', usuario);
  cache.set('tok-2', usuario);
  assert.equal(cache.get('tok-1'), usuario);
  assert.ok(![...cache.entries.keys()].includes('tok-1'));

  cache.deleteUser('u1', { exceto: 'tok-2' });
  assert.equal(cache.get('tok-1'), null);
  assert.equal(cache.get('tok-2'), usuario);

  now = 100;
  assert.equal(cache.get('tok-2'), null, 'expira após o TTL');
});

test('cache de serviços evita consultas repetidas e é limpo ao salvar', async () => {
  let consultas = 0;
  const lista = [{ id: 's1', nome: 'Corte' }];
  const repos = withCache({
    servicos: {
      list: async () => { consultas += 1; return lista; },
      insert: async (dados) => { lista.push({ id: 's2', ...dados }); return lista.at(-1); },
    },
    barbeiros: { list: async () => [] },
    perfis: {},
  }, { ttlMs: 60_000 });

  await Promise.all([repos.servicos.list(), repos.servicos.findById('s1'), repos.servicos.list()]);
  assert.equal(consultas, 1, 'chamadas simultâneas compartilham a consulta');
  await repos.servicos.insert({ nome: 'Barba' });
  assert.equal((await repos.servicos.list()).length, 2);
  assert.equal(consultas, 2);
});
