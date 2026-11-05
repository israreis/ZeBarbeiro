import { api } from '../core/api.js';
import { byId, el } from '../core/dom.js';
import { notifyError } from '../core/notify.js';
import {
  HOME_BY_ROLE, clearSession, getSession, redirectToLogin, updateSessionUser,
} from '../core/session.js';

/** Itens de menu por perfil. `key` é comparado com o atributo data-nav da página. */
const NAV_ITEMS = Object.freeze({
  administrador: [
    { key: 'barbeiros', label: 'Barbeiros', href: 'admin-barbeiros.html' },
    { key: 'servicos', label: 'Serviços', href: 'admin-servicos.html' },
    { key: 'unidades', label: 'Unidades', href: 'admin-unidades.html' },
    { key: 'atendimentos', label: 'Atendimentos', href: 'admin-agenda.html' },
  ],
  barbeiro: [
    { key: 'agenda', label: 'Minha agenda', href: 'barbeiro-agenda.html' },
    { key: 'historico', label: 'Histórico', href: 'barbeiro-historico.html' },
  ],
  cliente: [
    { key: 'agendar', label: 'Agendar', href: 'cliente-agendar.html' },
    { key: 'atendimentos', label: 'Meus atendimentos', href: 'cliente-atendimentos.html' },
  ],
});

export const ROLE_LABELS = Object.freeze({ administrador: 'Administrador', barbeiro: 'Barbeiro', cliente: 'Cliente' });

/* Marcação estática (sem dados do usuário), por isso pode ser montada via template. */
const HEADER_TEMPLATE = `
  <a class="visually-hidden-focusable" href="#conteudo">Pular para o conteúdo</a>
  <header class="app-header">
    <nav class="navbar navbar-expand-lg" aria-label="Menu principal">
      <div class="container">
        <a class="brand" data-home-link>
          <img src="img/logo.png" alt="">
          <span class="brand-name">Zé Barbeiro</span>
        </a>
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#menu-principal"
          aria-controls="menu-principal" aria-expanded="false" aria-label="Abrir menu">
          <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse justify-content-end gap-3" id="menu-principal">
          <div class="navbar-nav" data-nav-links></div>
          <div class="dropdown">
            <button type="button" class="account-trigger" data-bs-toggle="dropdown" aria-expanded="false">
              <span data-user-first-name></span>
              <span class="account-avatar" data-user-initial aria-hidden="true"></span>
            </button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><h2 class="dropdown-header" data-user-role></h2></li>
              <li><a class="dropdown-item" href="minha-conta.html">Minha conta</a></li>
              <li><hr class="dropdown-divider"></li>
              <li><button type="button" class="dropdown-item" data-logout>Sair</button></li>
            </ul>
          </div>
        </div>
      </div>
    </nav>
  </header>`;

export const FOOTER_TEMPLATE = `
  <footer class="app-footer">
    <div class="container">
      <div class="row g-4">
        <div class="col-12 col-md-4">
          <h2>Endereço</h2>
          <p class="mb-0">Av. Aggeo Pio Sobrinho, 577<br>Buritis, Belo Horizonte - MG</p>
        </div>
        <div class="col-12 col-md-4">
          <h2>Contato</h2>
          <ul>
            <li><a href="mailto:barberapp@gmail.com">barberapp@gmail.com</a></li>
            <li><a href="tel:+5531912345678">(31) 91234-5678</a></li>
          </ul>
        </div>
        <div class="col-12 col-md-4">
          <h2>Redes sociais</h2>
          <ul>
            <li class="social-link"><img src="img/icone-instagram.png" alt="Instagram"> @agenda_barber</li>
            <li class="social-link"><img src="img/icone-facebook.png" alt="Facebook"> @agenda_barber</li>
          </ul>
        </div>
      </div>
      <p class="footer-bottom mb-0">© ${new Date().getFullYear()} Zé Barbeiro. Todos os direitos reservados.</p>
    </div>
  </footer>`;

export function fromTemplate(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content;
}

function fillUser(root, usuario) {
  const firstName = usuario.nome.trim().split(/\s+/)[0];
  root.querySelector('[data-user-first-name]').textContent = firstName;
  root.querySelector('[data-user-initial]').textContent = firstName.charAt(0).toUpperCase();
  root.querySelector('[data-user-role]').textContent = ROLE_LABELS[usuario.perfil];
}

/** Reflete no cabeçalho e na sessão local os dados atualizados do usuário. */
export function refreshCurrentUser(usuario) {
  updateSessionUser(usuario);
  fillUser(document, usuario);
}

function renderHeader(usuario, activeKey) {
  const fragment = fromTemplate(HEADER_TEMPLATE);
  fragment.querySelector('[data-home-link]').href = HOME_BY_ROLE[usuario.perfil];
  fillUser(fragment, usuario);

  const links = NAV_ITEMS[usuario.perfil].map((item) => el('a', {
    className: `nav-link${item.key === activeKey ? ' active' : ''}`,
    href: item.href,
    text: item.label,
    attrs: item.key === activeKey ? { 'aria-current': 'page' } : {},
  }));
  fragment.querySelector('[data-nav-links]').append(...links);
  return fragment;
}

function bindLogout() {
  document.querySelector('[data-logout]').addEventListener('click', async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* mesmo com erro de rede, a sessão local é encerrada */
    }
    clearSession();
    window.location.replace('index.html');
  });
}

/**
 * Protege a página para o perfil informado e monta cabeçalho e rodapé.
 * Usuários de outro perfil são levados à própria página inicial.
 * @param {'administrador'|'barbeiro'|'cliente'|null} role perfil exigido (null = qualquer perfil)
 * @returns {Promise<object|null>} usuário logado, ou null se houve redirecionamento
 */
export async function initAppShell(role) {
  const session = getSession();
  if (!session) {
    redirectToLogin();
    return null;
  }
  if (role && session.usuario.perfil !== role) {
    window.location.replace(HOME_BY_ROLE[session.usuario.perfil] ?? 'index.html');
    return null;
  }

  let usuario;
  try {
    usuario = await api.get('/auth/me');
  } catch (error) {
    if (error.status !== 401) notifyError(error);
    return null;
  }

  byId('app-header').replaceWith(renderHeader(usuario, document.body.dataset.nav));
  byId('app-footer').replaceWith(fromTemplate(FOOTER_TEMPLATE));
  bindLogout();
  document.body.classList.add('is-ready');
  return usuario;
}
