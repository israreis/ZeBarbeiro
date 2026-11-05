import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPast, isValidIsoDate, isValidTime, nowInTimeZone, weekdayOf,
} from '../server/domain/time.js';
import { STATUS, findOccupant, generateSlots, slotEnd } from '../server/domain/agenda.js';
import { hashPassword, verifyPassword } from '../server/auth/password.js';
import { SessionStore } from '../server/auth/sessions.js';
import { RateLimiter } from '../server/auth/rate-limiter.js';
import * as v from '../server/validation.js';

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

test('hash de senha é salgado e verificável', async () => {
  const a = await hashPassword('segredo123');
  const b = await hashPassword('segredo123');
  assert.notEqual(a, b);
  assert.ok(await verifyPassword('segredo123', a));
  assert.ok(!(await verifyPassword('outra-senha', a)));
  assert.ok(!(await verifyPassword('segredo123', 'texto-puro')));
});

test('sessões expiram e podem ser revogadas por usuário', () => {
  let now = 0;
  const sessions = new SessionStore({ ttlMs: 1000, now: () => now });
  const t1 = sessions.create('u1');
  const t2 = sessions.create('u1');
  assert.equal(sessions.resolve(t1), 'u1');
  sessions.revokeUser('u1', t2);
  assert.equal(sessions.resolve(t1), null);
  assert.equal(sessions.resolve(t2), 'u1');
  now = 1000;
  assert.equal(sessions.resolve(t2), null);
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

test('validadores normalizam entradas', () => {
  assert.equal(v.email('  Fulano@Exemplo.COM '), 'fulano@exemplo.com');
  assert.equal(v.phone('31 97144 8208'), '(31)97144-8208');
  assert.equal(v.phone('3133311811'), '(31)3331-1811');
  assert.equal(v.positiveNumber('49,99', 'valor'), 49.99);
  assert.throws(() => v.password('1234567'), /pelo menos 8/);
  assert.throws(() => v.phone('1234'), /telefone válido/);
});
