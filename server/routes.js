import { forbidden, unauthorized, unprocessable } from './http/errors.js';
import { ROLES, toPublicUser } from './domain/roles.js';
import { buildReportPdf } from './reports/report-pdf.js';
import { buildReportXlsx } from './reports/report-xlsx.js';

const { ADMIN, BARBEIRO, CLIENTE } = ROLES;
const ANY_ROLE = [ADMIN, BARBEIRO, CLIENTE];

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function bearerToken(request) {
  const header = request.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

/** Corpo binário de upload de foto (o parser de imagens entrega um Buffer). */
function imageBody(request) {
  if (!Buffer.isBuffer(request.body)) throw unprocessable('Envie uma imagem JPG, PNG ou WEBP.');
  return request.body;
}

/** Envia um arquivo para download (o nome é montado no servidor, sem dados do usuário). */
function sendDownload(reply, { content, contentType, fileName }) {
  return reply
    .header('Content-Type', contentType)
    .header('Content-Disposition', `attachment; filename="${fileName}"`)
    .header('Cache-Control', 'no-store')
    .send(content);
}

/**
 * Rotas da API (prefixo /api) e suas regras de acesso.
 * @param {import('fastify').FastifyInstance} app
 */
export async function apiRoutes(app, { services }) {
  const {
    auth, barbeiros, servicos, agendamentos, relatorios,
  } = services;

  app.decorateRequest('user', null);
  app.decorateRequest('token', null);

  /** preHandler de autenticação/autorização por perfil. */
  const requireRole = (...roles) => async (request) => {
    const token = bearerToken(request);
    const user = token ? await auth.authenticate(token) : null;
    if (!user) throw unauthorized();
    if (!roles.includes(user.perfil)) throw forbidden();
    request.user = user;
    request.token = token;
  };
  const authenticated = { preHandler: requireRole(...ANY_ROLE) };
  const only = (...roles) => ({ preHandler: requireRole(...roles) });

  /** Dados da conta; barbeiros recebem também a URL da foto. */
  const contaDe = async (usuario) => {
    const publico = toPublicUser(usuario);
    return usuario.perfil === BARBEIRO ? { ...publico, fotoUrl: await barbeiros.fotoUrlOf(usuario.id) } : publico;
  };

  /** Relatório no escopo do usuário; a visão por barbeiro só aparece para o administrador sem filtro. */
  const gerarRelatorio = async (request) => {
    const report = await relatorios.gerar(request.user, request.query);
    return {
      report,
      mostrarBarbeiros: request.user.perfil === ADMIN && !report.barbeiro,
      fileName: `relatorio-ze-barbeiro-${report.periodo.inicio}-a-${report.periodo.fim}`,
    };
  };

  // ---- Autenticação e conta ----
  app.post('/auth/login', (request) => auth.login(request.body, request.ip));
  app.post('/auth/refresh', (request) => auth.refresh(request.body));
  app.post('/auth/logout', authenticated, async (request, reply) => {
    auth.logout(request.token);
    return reply.code(204).send();
  });
  app.get('/auth/me', authenticated, (request) => contaDe(request.user));
  app.put('/auth/me', authenticated, async (request) => contaDe(await auth.updateProfile(request.user, request.body, request.token)));
  app.put('/auth/senha', authenticated, async (request, reply) => {
    await auth.changePassword(request.user, request.body, request.token);
    return reply.code(204).send();
  });
  // O barbeiro gerencia a própria foto pela página Minha conta.
  app.put('/auth/me/foto', only(BARBEIRO), async (request) => {
    await barbeiros.setFoto(request.user.id, imageBody(request));
    return contaDe(request.user);
  });
  app.delete('/auth/me/foto', only(BARBEIRO), async (request, reply) => {
    await barbeiros.removeFoto(request.user.id);
    return reply.code(204).send();
  });
  app.post('/clientes', async (request, reply) => reply.code(201).send(await auth.registerCliente(request.body)));

  // ---- Cadastros administrativos ----
  app.get('/barbeiros', authenticated, (request) => barbeiros.list(request.user));
  app.get('/barbeiros/:id', only(ADMIN), (request) => barbeiros.get(request.params.id));
  app.post('/barbeiros', only(ADMIN), async (request, reply) => reply.code(201).send(await barbeiros.create(request.body)));
  app.put('/barbeiros/:id', only(ADMIN), (request) => barbeiros.update(request.params.id, request.body));
  app.put('/barbeiros/:id/foto', only(ADMIN), (request) => barbeiros.setFoto(request.params.id, imageBody(request)));
  app.delete('/barbeiros/:id/foto', only(ADMIN), async (request, reply) => {
    await barbeiros.removeFoto(request.params.id);
    return reply.code(204).send();
  });

  app.get('/servicos', authenticated, (request) => servicos.list(request.user));
  app.post('/servicos', only(ADMIN), async (request, reply) => reply.code(201).send(await servicos.create(request.body)));
  app.put('/servicos/:id', only(ADMIN), (request) => servicos.update(request.params.id, request.body));

  // ---- Relatórios e painel (administrador: todos; barbeiro: apenas os próprios dados) ----
  app.get('/relatorios', only(ADMIN, BARBEIRO), async (request) => (await gerarRelatorio(request)).report);
  app.get('/relatorios/pdf', only(ADMIN, BARBEIRO), async (request, reply) => {
    const { report, mostrarBarbeiros, fileName } = await gerarRelatorio(request);
    return sendDownload(reply, {
      content: await buildReportPdf(report, { mostrarBarbeiros }),
      contentType: 'application/pdf',
      fileName: `${fileName}.pdf`,
    });
  });
  app.get('/relatorios/xlsx', only(ADMIN, BARBEIRO), async (request, reply) => {
    const { report, mostrarBarbeiros, fileName } = await gerarRelatorio(request);
    return sendDownload(reply, {
      content: await buildReportXlsx(report, { mostrarBarbeiros }),
      contentType: XLSX_TYPE,
      fileName: `${fileName}.xlsx`,
    });
  });

  // ---- Agenda e atendimentos ----
  app.get('/agenda', only(ADMIN, BARBEIRO), (request) => agendamentos.getAgenda(request.user, request.query));
  app.get('/disponibilidade', authenticated, (request) => agendamentos.disponibilidade(request.query));
  app.get('/agendamentos', authenticated, (request) => agendamentos.history(request.user, request.query));
  app.post('/agendamentos', only(BARBEIRO, CLIENTE),
    async (request, reply) => reply.code(201).send(await agendamentos.create(request.user, request.body)));
  app.patch('/agendamentos/:id/concluir', only(BARBEIRO), (request) => agendamentos.concluir(request.user, request.params.id));
  app.patch('/agendamentos/:id/cancelar', only(BARBEIRO, CLIENTE),
    (request) => agendamentos.cancelar(request.user, request.params.id));
}
