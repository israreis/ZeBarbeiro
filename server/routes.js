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
    auth, barbeiros, servicos, agendamentos,
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

  /** Dados da conta; barbeiros recebem também a URL da foto. */
  const withFoto = (usuario) => (usuario.perfil === BARBEIRO
    ? { ...usuario, fotoUrl: barbeiros.fotoUrlOf(usuario.id) }
    : usuario);

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
    .get('/api/auth/me', authenticated, (ctx) => withFoto(toPublicUser(ctx.user)))
    .put('/api/auth/me', authenticated, async (ctx) => withFoto(await auth.updateProfile(ctx.user, ctx.body, ctx.token)))
    // O barbeiro gerencia a própria foto pela página Minha conta.
    .put('/api/auth/me/foto', { rawBody: true }, requireRole(BARBEIRO), async (ctx) => {
      await barbeiros.setFoto(ctx.user.id, await ctx.readRawBody());
      return withFoto(toPublicUser(ctx.user));
    })
    .delete('/api/auth/me/foto', requireRole(BARBEIRO), async (ctx) => {
      await barbeiros.removeFoto(ctx.user.id);
      noContent(ctx);
    })
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
    .put('/api/barbeiros/:id/foto', { rawBody: true }, adminOnly,
      async (ctx) => barbeiros.setFoto(ctx.params.id, await ctx.readRawBody()))
    .delete('/api/barbeiros/:id/foto', adminOnly, async (ctx) => {
      await barbeiros.removeFoto(ctx.params.id);
      noContent(ctx);
    })
    // Pública: fotos aparecem para clientes e são carregadas por <img>, que não envia o token.
    .get('/api/barbeiros/:id/foto', async (ctx) => {
      const { content, contentType } = await barbeiros.getFoto(ctx.params.id);
      ctx.res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': content.length,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Disposition': 'inline',
      });
      ctx.res.end(content);
      ctx.handled = true;
    })

    .get('/api/servicos', authenticated, (ctx) => servicos.list(ctx.user))
    .post('/api/servicos', adminOnly, async (ctx) => created(ctx, await servicos.create(ctx.body)))
    .put('/api/servicos/:id', adminOnly, (ctx) => servicos.update(ctx.params.id, ctx.body))


    // Agenda e atendimentos
    .get('/api/agenda', requireRole(ADMIN, BARBEIRO), (ctx) => agendamentos.getAgenda(ctx.user, ctx.query))
    .get('/api/disponibilidade', authenticated, (ctx) => agendamentos.disponibilidade(ctx.query))
    .get('/api/agendamentos', authenticated, (ctx) => agendamentos.history(ctx.user, ctx.query))
    .post('/api/agendamentos', requireRole(BARBEIRO, CLIENTE),
      async (ctx) => created(ctx, await agendamentos.create(ctx.user, ctx.body)))
    .patch('/api/agendamentos/:id/concluir', requireRole(BARBEIRO),
      (ctx) => agendamentos.concluir(ctx.user, ctx.params.id))
    .patch('/api/agendamentos/:id/cancelar', requireRole(BARBEIRO, CLIENTE),
      (ctx) => agendamentos.cancelar(ctx.user, ctx.params.id));
}
