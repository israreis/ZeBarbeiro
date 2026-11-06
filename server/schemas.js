import { z } from 'zod';
import { unprocessable } from './http/errors.js';
import {
  WEEKDAYS, ageOn, isValidIsoDate, isValidTime, timeToMinutes,
} from './domain/time.js';
import { SLOT_MINUTES, STATUS } from './domain/agenda.js';
import { IDADE_MINIMA_CLIENTE, MENSAGEM_MENOR_DE_IDADE } from './domain/clientes.js';

/**
 * Esquemas de validação (Zod) das entradas da API.
 * Campos desconhecidos são descartados (evita mass assignment, ex.: enviar "perfil").
 * Mensagens em português, prontas para exibir ao usuário.
 */

export const PASSWORD_MIN_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Valida `data` com `schema`; em caso de erro lança 422 com a primeira mensagem. */
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const [issue] = result.error.issues;
  throw unprocessable(issue.message, { campo: issue.path.join('.') || undefined });
}

// ---------------------------------------------------------------------------
// Blocos básicos
// ---------------------------------------------------------------------------

export const texto = (campo, { max = 120 } = {}) => z
  .string({ required_error: `O campo "${campo}" é obrigatório.`, invalid_type_error: `O campo "${campo}" é obrigatório.` })
  .trim()
  .min(1, `O campo "${campo}" é obrigatório.`)
  .max(max, `O campo "${campo}" deve ter no máximo ${max} caracteres.`);

export const email = (campo = 'e-mail') => texto(campo, { max: 254 })
  .toLowerCase()
  .regex(EMAIL_PATTERN, `Informe um ${campo} válido.`);

/** Requisitos de senha forte (os mesmos exibidos nas telas, em password-strength.js). */
export const PASSWORD_RULES = Object.freeze([
  { test: (s) => /\p{Lu}/u.test(s), message: 'pelo menos uma letra maiúscula' },
  { test: (s) => /\p{Ll}/u.test(s), message: 'pelo menos uma letra minúscula' },
  { test: (s) => /\d/.test(s), message: 'pelo menos um número' },
  { test: (s) => /[^\p{L}\d\s]/u.test(s), message: 'pelo menos um caractere especial (ex.: ! @ # $ %)' },
]);

export const senha = (campo = 'senha') => z
  .string({ required_error: `A ${campo} deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.` })
  .min(PASSWORD_MIN_LENGTH, `A ${campo} deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`)
  .max(128, `A ${campo} deve ter no máximo 128 caracteres.`)
  .superRefine((value, ctx) => {
    const falha = PASSWORD_RULES.find((rule) => !rule.test(value));
    if (falha) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `A ${campo} deve ter ${falha.message}.` });
  });

/** Aceita telefone com ou sem máscara; normaliza para (99)99999-9999 / (99)9999-9999. */
export const telefone = (campo = 'telefone') => texto(campo, { max: 20 }).transform((value, ctx) => {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 10 && digits.length !== 11) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Informe um ${campo} válido com DDD.` });
    return z.NEVER;
  }
  const split = digits.length === 11 ? 7 : 6;
  return `(${digits.slice(0, 2)})${digits.slice(2, split)}-${digits.slice(split)}`;
});

export const dataIso = (campo = 'data') => z
  .string({ required_error: `Informe uma ${campo} válida (AAAA-MM-DD).`, invalid_type_error: `Informe uma ${campo} válida (AAAA-MM-DD).` })
  .refine(isValidIsoDate, `Informe uma ${campo} válida (AAAA-MM-DD).`);

export const horario = (campo = 'horário') => z
  .string({ required_error: `Informe um ${campo} válido (HH:MM).`, invalid_type_error: `Informe um ${campo} válido (HH:MM).` })
  .refine(isValidTime, `Informe um ${campo} válido (HH:MM).`);

const booleano = (campo) => z.boolean({ invalid_type_error: `O campo "${campo}" deve ser verdadeiro ou falso.` });

const id = (campo) => texto(campo, { max: 64 });
const barbeiroOpcional = z.string().max(64).optional().transform((v) => v || null);

/**
 * Data de nascimento obrigatória e plausível (não futura, até 120 anos).
 * Com `idadeMinima`, recusa quem ainda não tem a idade usando `mensagem`.
 */
export const dataNascimento = (hoje, { idadeMinima, mensagem } = {}) => z
  .string({ required_error: 'Informe a data de nascimento.', invalid_type_error: 'Informe a data de nascimento.' })
  .min(1, 'Informe a data de nascimento.')
  .superRefine((value, ctx) => {
    const fail = (message) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (!isValidIsoDate(value)) return fail('Informe uma data de nascimento válida (AAAA-MM-DD).');
    const idade = ageOn(value, hoje);
    if (value > hoje || idade > 120) return fail('Informe uma data de nascimento válida.');
    if (idadeMinima !== undefined && idade < idadeMinima) {
      return fail(mensagem ?? `É preciso ter pelo menos ${idadeMinima} anos.`);
    }
    return undefined;
  });

/** Valor monetário positivo; aceita "49,99" vindo da máscara de moeda. */
const valorMonetario = (campo) => z
  .union([z.number(), z.string()], { errorMap: () => ({ message: `Informe um valor válido para "${campo}".` }) })
  .transform((value) => (typeof value === 'string' ? Number(value.trim().replace(',', '.')) : value))
  .refine((n) => Number.isFinite(n) && n > 0 && n <= 100000, `Informe um valor válido para "${campo}".`)
  .transform((n) => Math.round(n * 100) / 100);

const inteiroPositivo = (campo, max) => z.coerce
  .number({ invalid_type_error: `Informe um número inteiro válido para "${campo}".` })
  .int(`Informe um número inteiro válido para "${campo}".`)
  .positive(`Informe um número inteiro válido para "${campo}".`)
  .max(max, `Informe um número inteiro válido para "${campo}".`);

/** Lista de textos sem repetição, opcionalmente restrita a `permitidos`. */
const listaUnica = (campo, { permitidos, minimo = 0 } = {}) => z
  .array(z.string(), { required_error: `O campo "${campo}" deve ser uma lista.`, invalid_type_error: `O campo "${campo}" deve ser uma lista.` })
  .transform((lista) => [...new Set(lista)])
  .superRefine((lista, ctx) => {
    if (lista.length < minimo) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Selecione pelo menos ${minimo} item(ns) em "${campo}".` });
      return;
    }
    const invalidos = permitidos ? lista.filter((item) => !permitidos.includes(item)) : [];
    if (invalidos.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Valores inválidos em "${campo}": ${invalidos.join(', ')}.` });
    }
  });

// ---------------------------------------------------------------------------
// Autenticação e conta
// ---------------------------------------------------------------------------

/** Login: valida apenas o formato; a mensagem de erro de credencial é sempre genérica. */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).catch(''),
  senha: z.string().max(128).catch(''),
});

export const refreshSchema = z.object({
  refreshToken: texto('refreshToken', { max: 2048 }),
});

const dadosPessoais = (hoje, nascimento = {}) => z.object({
  nome: texto('nome'),
  email: email(),
  telefone: telefone(),
  dataNascimento: dataNascimento(hoje, nascimento),
});

const regraNascimentoCliente = { idadeMinima: IDADE_MINIMA_CLIENTE, mensagem: MENSAGEM_MENOR_DE_IDADE };

export const cadastroClienteSchema = (hoje) => dadosPessoais(hoje, regraNascimentoCliente)
  .extend({ senha: senha() });

/** Dados editáveis da própria conta. Perfil (papel) e senha nunca mudam por aqui. */
export const perfilSchema = (hoje, perfil) => dadosPessoais(hoje, perfil === 'cliente' ? regraNascimentoCliente : {})
  .extend({ senhaAtual: z.string().max(128).optional() });

export const trocaSenhaSchema = z.object({
  senhaAtual: z.string().max(128).catch(''),
  novaSenha: senha('nova senha'),
});

// ---------------------------------------------------------------------------
// Cadastros administrativos
// ---------------------------------------------------------------------------

export const servicoSchema = z.object({
  nome: texto('nome', { max: 60 }),
  valor: valorMonetario('valor'),
  duracaoMinutos: inteiroPositivo('duração (minutos)', 480),
  ativo: booleano('ativo').default(true),
});

/** Barbeiro: dados pessoais + expediente. `servicosExistentes` restringe os ids aceitos. */
export const barbeiroSchema = (hoje, servicosExistentes, { criacao }) => dadosPessoais(hoje)
  .extend({
    // Na criação a senha é obrigatória; na edição, `novaSenha` é opcional (vazia = mantém).
    ...(criacao
      ? { senha: senha() }
      : { novaSenha: z.union([z.literal(''), senha('nova senha')]).optional().transform((v) => v || undefined) }),
    ativo: booleano('ativo').default(true),
    servicoIds: listaUnica('serviços', { permitidos: servicosExistentes, minimo: 1 }),
    diasDisponiveis: listaUnica('dias disponíveis', { permitidos: WEEKDAYS, minimo: 1 })
      .transform((dias) => [...dias].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b))),
    horarioInicial: horario('horário inicial'),
    horarioFinal: horario('horário final'),
  })
  .refine(
    (b) => timeToMinutes(b.horarioFinal) - timeToMinutes(b.horarioInicial) >= SLOT_MINUTES,
    { message: `O expediente deve terminar pelo menos ${SLOT_MINUTES} minutos após o início.`, path: ['horarioFinal'] },
  );

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

export const MAX_HORARIOS_POR_RESERVA = 12;

const horarios = listaUnica('horários', { minimo: 1 })
  .refine((lista) => lista.length <= MAX_HORARIOS_POR_RESERVA, `Selecione no máximo ${MAX_HORARIOS_POR_RESERVA} horários por vez.`)
  .refine((lista) => lista.every(isValidTime), 'Informe um horário válido (HH:MM).')
  .transform((lista) => [...lista].sort());

export const agendaQuerySchema = z.object({
  data: dataIso(),
  barbeiroId: z.string().max(64).optional(),
});

export const disponibilidadeQuerySchema = z.object({
  data: dataIso(),
  servicoId: id('serviço'),
  barbeiroId: barbeiroOpcional,
});

/** Período com data inicial ≤ final; `extra` acrescenta outros filtros. */
const periodo = (extra = {}) => z.object({
  inicio: dataIso('data inicial'),
  fim: dataIso('data final'),
  ...extra,
}).refine((p) => p.inicio <= p.fim, {
  message: 'A data inicial deve ser anterior ou igual à data final.', path: ['fim'],
});

export const historicoQuerySchema = periodo({
  situacao: z.enum(['pendentes', 'concluidos'], { errorMap: () => ({ message: 'Valor inválido para "situação".' }) })
    .default('pendentes'),
  barbeiroId: barbeiroOpcional,
});

export const relatorioQuerySchema = periodo({ barbeiroId: barbeiroOpcional });

export const reservaClienteSchema = z.object({
  data: dataIso(),
  horarios,
  barbeiroId: id('barbeiro'),
  servicoId: id('serviço'),
});

export const TIPOS_RESERVA_BARBEIRO = Object.freeze([STATUS.AGENDADO_BARBEIRO, STATUS.BLOQUEADO]);

/** Barbeiro inclui um atendimento (cliente por nome + serviço) ou bloqueia horários. */
export const reservaBarbeiroSchema = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal(STATUS.AGENDADO_BARBEIRO),
    data: dataIso(),
    horarios,
    servicoId: id('serviço'),
    clienteNome: texto('nome do cliente'),
    clienteTelefone: z.union([z.literal(''), telefone('celular do cliente')]).optional()
      .transform((v) => v || undefined),
  }),
  z.object({
    tipo: z.literal(STATUS.BLOQUEADO),
    data: dataIso(),
    horarios,
  }),
], { errorMap: () => ({ message: 'Valor inválido para "tipo".' }) });
