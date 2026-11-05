import { unprocessable } from './http/errors.js';
import { ageOn, isValidIsoDate, isValidTime } from './domain/time.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Validadores de entrada. Cada função recebe o valor bruto vindo do cliente,
 * lança 422 com mensagem clara quando inválido e devolve o valor normalizado.
 */

export function requiredString(value, field, { min = 1, max = 120 } = {}) {
  if (typeof value !== 'string') throw unprocessable(`O campo "${field}" é obrigatório.`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw unprocessable(`O campo "${field}" é obrigatório.`);
  if (trimmed.length > max) throw unprocessable(`O campo "${field}" deve ter no máximo ${max} caracteres.`);
  return trimmed;
}

export function email(value, field = 'e-mail') {
  const normalized = requiredString(value, field, { max: 254 }).toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) throw unprocessable(`Informe um ${field} válido.`);
  return normalized;
}

export function password(value, field = 'senha') {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN_LENGTH) {
    throw unprocessable(`A ${field} deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  }
  if (value.length > 128) throw unprocessable(`A ${field} deve ter no máximo 128 caracteres.`);
  return value;
}

/** Aceita telefone com ou sem máscara; armazena no formato (99)99999-9999 / (99)9999-9999. */
export function phone(value, field = 'telefone') {
  const digits = requiredString(value, field, { max: 20 }).replace(/\D/g, '');
  if (digits.length !== 10 && digits.length !== 11) {
    throw unprocessable(`Informe um ${field} válido com DDD.`);
  }
  const split = digits.length === 11 ? 7 : 6;
  return `(${digits.slice(0, 2)})${digits.slice(2, split)}-${digits.slice(split)}`;
}

export function isoDate(value, field = 'data') {
  if (!isValidIsoDate(value)) throw unprocessable(`Informe uma ${field} válida (AAAA-MM-DD).`);
  return value;
}

/**
 * Data de nascimento obrigatória e plausível (não futura, até 120 anos).
 * Com `minAge`, rejeita quem ainda não tem a idade mínima usando `minAgeMessage`.
 */
export function birthDate(value, today, { minAge, minAgeMessage } = {}) {
  if (!value) throw unprocessable('Informe a data de nascimento.');
  const date = isoDate(value, 'data de nascimento');
  const age = ageOn(date, today);
  if (date > today || age > 120) throw unprocessable('Informe uma data de nascimento válida.');
  if (minAge !== undefined && age < minAge) {
    throw unprocessable(minAgeMessage ?? `É preciso ter pelo menos ${minAge} anos.`);
  }
  return date;
}

export function time(value, field = 'horário') {
  if (!isValidTime(value)) throw unprocessable(`Informe um ${field} válido (HH:MM).`);
  return value;
}

export function boolean(value, field) {
  if (typeof value !== 'boolean') throw unprocessable(`O campo "${field}" deve ser verdadeiro ou falso.`);
  return value;
}

export function positiveNumber(value, field, { max = 100000 } = {}) {
  const number = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number <= 0 || number > max) {
    throw unprocessable(`Informe um valor válido para "${field}".`);
  }
  return Math.round(number * 100) / 100;
}

export function positiveInteger(value, field, { max = 24 * 60 } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0 || number > max) {
    throw unprocessable(`Informe um número inteiro válido para "${field}".`);
  }
  return number;
}

export function stringArray(value, field, { allowed, minItems = 0 } = {}) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw unprocessable(`O campo "${field}" deve ser uma lista.`);
  }
  const unique = [...new Set(value)];
  if (unique.length < minItems) throw unprocessable(`Selecione pelo menos ${minItems} item(ns) em "${field}".`);
  if (allowed) {
    const invalid = unique.filter((item) => !allowed.includes(item));
    if (invalid.length) throw unprocessable(`Valores inválidos em "${field}": ${invalid.join(', ')}.`);
  }
  return unique;
}

export function oneOf(value, field, allowed) {
  if (!allowed.includes(value)) throw unprocessable(`Valor inválido para "${field}".`);
  return value;
}
