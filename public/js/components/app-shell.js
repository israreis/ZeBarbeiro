import { api } from '../core/api.js';
import { byId, el, modal, withBusy } from '../core/dom.js';
import { isFormValid, rawValue, setMatchValidity } from '../core/forms.js';
import { notifyError, notifySuccess } from '../core/notify.js';
import {
  HOME_BY_ROLE, clearSession, getSession, redirectToLogin,
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

const ROLE_LABELS = Object.freeze({ administrador: 'Administrador', barbeiro: 'Barbeiro', cliente: 'Cliente' });

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
              <li><button type="button" class="dropdown-item" data-bs-toggle="modal" data-bs-target="#minhaContaModal">Minha conta</button></li>
              <li><button type="button" class="dropdown-item" data-bs-toggle="modal" data-bs-target="#alterarSenhaModal">Alterar senha</button></li>
              <li><hr class="dropdown-divider"></li>
              <li><button type="button" class="dropdown-item" data-logout>Sair</button></li>
            </ul>
          </div>
        </div>
      </div>
    </nav>
  </header>`;

const ACCOUNT_MODALS_TEMPLATE = `
  <div class="modal fade" id="minhaContaModal" tabindex="-1" aria-labelledby="minhaContaTitulo" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title" id="minhaContaTitulo">Minha conta</h2>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
        </div>
        <div class="modal-body">
          <dl class="account-details">
            <dt>Nome</dt><dd data-conta="nome"></dd>
            <dt>E-mail</dt><dd data-conta="email"></dd>
            <dt>Telefone</dt><dd data-conta="telefone"></dd>
          </dl>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn-ghost" data-bs-dismiss="modal">Fechar</button>
        </div>
      </div>
    </div>
  </div>

  <div class="modal fade" id="alterarSenhaModal" tabindex="-1" aria-labelledby="alterarSenhaTitulo" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
      <form class="modal-content" id="formAlterarSenha" novalidate>
        <div class="modal-header">
          <h2 class="modal-title" id="alterarSenhaTitulo">Alterar senha</h2>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
        </div>
        <div class="modal-body">
          <label for="senhaAtual" class="form-label">Senha atual</label>
          <input type="password" class="form-control mb-3" id="senhaAtual" name="senhaAtual"
            autocomplete="current-password" required>
          <label for="novaSenha" class="form-label">Nova senha</label>
          <input type="password" class="form-control" id="novaSenha" name="novaSenha"
            autocomplete="new-password" minlength="8" required aria-describedby="novaSenhaDica">
          <p class="form-hint mt-1 mb-3" id="novaSenhaDica">Mínimo de 8 caracteres.</p>
          <label for="confirmarNovaSenha" class="form-label">Confirmar nova senha</label>
          <input type="password" class="form-control" id="confirmarNovaSenha" name="confirmarNovaSenha"
            autocomplete="new-password" required>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn-ghost" data-bs-dismiss="modal">Cancelar</button>
          <button type="submit" class="btn-app">Alterar senha</button>
        </div>
      </form>
    </div>
  </div>`;

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

function renderHeader(usuario, activeKey) {
  const fragment = fromTemplate(HEADER_TEMPLATE);
  fragment.querySelector('[data-home-link]').href = HOME_BY_ROLE[usuario.perfil];

  const firstName = usuario.nome.trim().split(/\s+/)[0];
  fragment.querySelector('[data-user-first-name]').textContent = firstName;
  fragment.querySelector('[data-user-initial]').textContent = firstName.charAt(0).toUpperCase();
  fragment.querySelector('[data-user-role]').textContent = ROLE_LABELS[usuario.perfil];

  const links = NAV_ITEMS[usuario.perfil].map((item) => el('a', {
    className: `nav-link${item.key === activeKey ? ' active' : ''}`,
    href: item.href,
    text: item.label,
    attrs: item.key === activeKey ? { 'aria-current': 'page' } : {},
  }));
  fragment.querySelector('[data-nav-links]').append(...links);
  return fragment;
}

function bindAccountModals(usuario) {
  const fill = (dados) => {
    for (const field of ['nome', 'email', 'telefone']) {
      document.querySelector(`[data-conta="${field}"]`).textContent = dados[field] || '—';
    }
  };
  fill(usuario);
  byId('minhaContaModal').addEventListener('show.bs.modal', async () => {
    try {
      fill(await api.get('/auth/me'));
    } catch (error) {
      notifyError(error);
    }
  });

  const form = byId('formAlterarSenha');
  const submit = form.querySelector('[type="submit"]');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    setMatchValidity(form, 'novaSenha', 'confirmarNovaSenha', 'A confirmação deve ser igual à nova senha.');
    if (!isFormValid(form)) return;

    withBusy(submit, async () => {
      try {
        await api.put('/auth/senha', {
          senhaAtual: rawValue(form, 'senhaAtual'),
          novaSenha: rawValue(form, 'novaSenha'),
        });
        form.reset();
        modal.hide(byId('alterarSenhaModal'));
        notifySuccess('Senha alterada.');
      } catch (error) {
        notifyError(error);
      }
    });
  });

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
 * Protege a página para o perfil informado e monta cabeçalho, rodapé e modais da conta.
 * Usuários de outro perfil são levados à própria página inicial.
 * @param {'administrador'|'barbeiro'|'cliente'} role
 * @returns {Promise<object|null>} usuário logado, ou null se houve redirecionamento
 */
export async function initAppShell(role) {
  const session = getSession();
  if (!session) {
    redirectToLogin();
    return null;
  }
  if (session.usuario.perfil !== role) {
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
  document.body.append(fromTemplate(ACCOUNT_MODALS_TEMPLATE));
  bindAccountModals(usuario);
  document.body.classList.add('is-ready');
  return usuario;
}
