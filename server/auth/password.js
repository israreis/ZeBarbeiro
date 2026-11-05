import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const SCRYPT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1 });

/**
 * Hash de senha com scrypt + salt aleatório.
 * Formato: scrypt$N$r$p$salt(base64)$hash(base64)
 */
export async function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(plain, salt, KEY_LENGTH, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(plain, stored) {
  if (typeof plain !== 'string' || typeof stored !== 'string') return false;
  const [algorithm, N, r, p, saltB64, hashB64] = stored.split('$');
  if (algorithm !== 'scrypt' || !saltB64 || !hashB64) return false;

  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(plain, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p),
  });
  return crypto.timingSafeEqual(expected, actual);
}

/**
 * Hash fixo usado quando o e-mail não existe, para que o tempo de resposta
 * do login não revele quais e-mails estão cadastrados.
 */
let dummyHash;
export async function dummyVerify(plain) {
  dummyHash ??= await hashPassword('senha-inexistente');
  await verifyPassword(String(plain ?? ''), dummyHash);
  return false;
}
