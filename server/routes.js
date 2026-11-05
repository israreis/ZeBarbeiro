import { Router } from './http/router.js';
import { forbidden, unauthorized } from './http/errors.js';
import { ROLES, toPublicUser } from './domain/roles.js';

const { ADMIN, BARBEIRO, CLIENTE } = ROLES;
const ANY_ROLE = [ADMIN, BARBEIRO, CLIENTE];

/**
 * Define as rotas da API e suas regras de acesso.
 * Cada rota recebe um `ctx` com { req, params, query, body, ip, token, user } e devolve
 * o corpo da resposta (status 200 por padrão; `ctx.status` permite alterá-lo).
 */
export function buildRouter({ sessions, store, services }) {
  const {
    auth, barbeiros, servicos, unidades, agendamentos,
  } = services;

  /** Middleware de autenticação/autorização baseado em perfil. */
  const requireRole = (...roles) => (ctx) => {
    const userId = sessions.resolve(ctx.token);
    const user = userId && store.snapshot.usuarios.find((u) => u.id === userId);
    if (!user) throw unauthorized();
    if (!roles.includes(user.perfil)) throw forbidden();
    ctx.user = user;
  };
  const authenticated = requireRole(...ANY_ROLE);
  const adminOnly = requireRole(ADMIN);

  const created = (ctx, value) => {
    ctx.status = 201;
    return value;
  };
  const noContent = (ctx) => {
    ctx.status = 204;
  };

  return new Router()
    // Autenticação e conta
    .post('/api/auth/login', (ctx) => auth.login(ctx.body, ctx.ip))
    .post('/api/auth/logout', authenticated, (ctx) => {
      auth.logout(ctx.token);
      noContent(ctx);
    })
    .get('/api/auth/me', authenticated, (ctx) => toPublicUser(ctx.user))
    .put('/api/auth/me', authenticated, (ctx) => auth.updateProfile(ctx.user, ctx.body, ctx.token))
    .put('/api/auth/senha', authenticated, async (ctx) => {
      await auth.changePassword(ctx.user, ctx.body, ctx.token);
      noContent(ctx);
    })
    .post('/api/clientes', async (ctx) => created(ctx, await auth.registerCliente(ctx.body)))

    // Cadastros administrativos
    .get('/api/barbeiros', authenticated, (ctx) => barbeiros.list(ctx.user))
    .get('/api/barbeiros/:id', adminOnly, (ctx) => barbeiros.get(ctx.params.id))
    .post('/api/barbeiros', adminOnly, async (ctx) => created(ctx, await barbeiros.create(ctx.body)))
    .put('/api/barbeiros/:id', adminOnly, (ctx) => barbeiros.update(ctx.params.id, ctx.body))

    .get('/api/servicos', authenticated, (ctx) => servicos.list(ctx.user))
    .post('/api/servicos', adminOnly, async (ctx) => created(ctx, await servicos.create(ctx.body)))
    .put('/api/servicos/:id', adminOnly, (ctx) => servicos.update(ctx.params.id, ctx.body))

    .get('/api/unidades', adminOnly, () => unidades.list())
    .post('/api/unidades', adminOnly, async (ctx) => created(ctx, await unidades.create(ctx.body)))
    .put('/api/unidades/:id', adminOnly, (ctx) => unidades.update(ctx.params.id, ctx.body))

    // Agenda e atendimentos
    .get('/api/agenda', authenticated, (ctx) => agendamentos.getAgenda(ctx.user, ctx.query))
    .get('/api/agendamentos', authenticated, (ctx) => agendamentos.history(ctx.user, ctx.query))
    .post('/api/agendamentos', requireRole(BARBEIRO, CLIENTE),
      async (ctx) => created(ctx, await agendamentos.create(ctx.user, ctx.body)))
    .patch('/api/agendamentos/:id/concluir', requireRole(BARBEIRO),
      (ctx) => agendamentos.concluir(ctx.user, ctx.params.id))
    .patch('/api/agendamentos/:id/cancelar', requireRole(BARBEIRO, CLIENTE),
      (ctx) => agendamentos.cancelar(ctx.user, ctx.params.id));
}
