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
    { key: 'barbeiros', label: 'BARBEIROS', href: 'admin-barbeiros.html' },
    { key: 'unidades', label: 'UNIDADES', href: 'admin-unidades.html' },
    { key: 'servicos', label: 'SERVIÇOS', href: 'admin-servicos.html' },
    { key: 'atendimentos', label: 'ATENDIMENTOS', href: 'admin-agenda.html' },
  ],
  barbeiro: [
    { key: 'agenda', label: 'MINHA AGENDA', href: 'barbeiro-agenda.html' },
    { key: 'historico', label: 'ATENDIMENTOS REALIZADOS', href: 'barbeiro-historico.html' },
  ],
  cliente: [
    { key: 'agendar', label: 'AGENDAR', href: 'cliente-agendar.html' },
    { key: 'atendimentos', label: 'MEUS ATENDIMENTOS', href: 'cliente-atendimentos.html' },
  ],
});

/* Marcação estática (sem dados do usuário), por isso pode ser montada via template. */
const HEADER_TEMPLATE = `
  <header class="app-header container-fluid text-light">
    <nav class="navbar navbar-expand-lg" aria-label="Menu principal">
      <div class="container-fluid">
        <a class="navbar-brand" data-home-link><img class="app-logo" src="img/logo.png" alt="Zé Barbeiro"></a>
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#menu-principal"
          aria-controls="menu-principal" aria-expanded="false" aria-label="Abrir menu">
          <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse justify-content-end" id="menu-principal">
          <div class="navbar-nav" data-nav-links></div>
          <span class="app-greeting" data-greeting></span>
          <button type="button" class="btn btn-account rounded-pill px-3" data-bs-toggle="modal"
            data-bs-target="#menuContaModal" aria-label="Menu da conta">
            <img src="img/icone-usuario.png" alt="">
          </button>
        </div>
      </div>
    </nav>
    <div class="divider-gold"></div>
  </header>`;

const ACCOUNT_MODALS_TEMPLATE = `
  <div class="modal fade" id="menuContaModal" tabindex="-1" aria-label="Menu da conta" aria-hidden="true">
    <div class="modal-dialog modal-sm modal-account-menu">
      <div class="modal-content">
        <div class="modal-header border-0 p-1">
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
        </div>
        <div class="modal-body account-menu p-1">
          <button type="button" class="account-menu-item" data-bs-toggle="modal" data-bs-target="#minhaContaModal">
            <img src="img/icone-usuario.png" alt="">Minha conta
          </button>
          <button type="button" class="account-menu-item" data-bs-toggle="modal" data-bs-target="#alterarSenhaModal">
            <img src="img/icone-cadeado.png" alt="">Alterar senha
          </button>
          <button type="button" class="account-menu-item" data-logout>
            <img src="img/icone-sair.png" alt="">Sair
          </button>
        </div>
      </div>
    </div>
  </div>

  <div class="modal fade" id="minhaContaModal" tabindex="-1" aria-labelledby="minhaContaTitulo" aria-hidden="true">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title fs-5" id="minhaContaTitulo">Minha Conta</h2>
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
          <button type="button" class="btn-app" data-bs-dismiss="modal">Fechar</button>
        </div>
      </div>
    </div>
  </div>

  <div class="modal fade" id="alterarSenhaModal" tabindex="-1" aria-labelledby="alterarSenhaTitulo" aria-hidden="true">
    <div class="modal-dialog">
      <form class="modal-content" id="formAlterarSenha" novalidate>
        <div class="modal-header">
          <h2 class="modal-title fs-5" id="alterarSenhaTitulo">Alterar Senha</h2>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
        </div>
        <div class="modal-body">
          <label for="senhaAtual" class="form-label">Senha atual</label>
          <input type="password" class="form-control mb-3" id="senhaAtual" name="senhaAtual"
            autocomplete="current-password" required>
          <label for="novaSenha" class="form-label">Nova senha</label>
          <input type="password" class="form-control mb-3" id="novaSenha" name="novaSenha"
            autocomplete="new-password" minlength="8" required>
          <label for="confirmarNovaSenha" class="form-label">Confirmar nova senha</label>
          <input type="password" class="form-control" id="confirmarNovaSenha" name="confirmarNovaSenha"
            autocomplete="new-password" required>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn-app" data-bs-dismiss="modal">Cancelar</button>
          <button type="submit" class="btn-app">Alterar senha</button>
        </div>
      </form>
    </div>
  </div>`;

const FOOTER_TEMPLATE = `
  <footer class="app-footer text-light text-center">
    <div class="row justify-content-between m-0">
      <div class="col-12 col-md-4 mb-3">
        <h2 class="footer-title">ENDEREÇO</h2>
        <p>Av. Aggeo Pio Sobrinho, 577, Buritis, Belo Horizonte - MG</p>
      </div>
      <div class="col-12 col-md-4 mb-3" id="contatos">
        <h2 class="footer-title">CONTATO</h2>
        <ul class="list-unstyled">
          <li class="mb-2"><a href="mailto:barberapp@gmail.com">barberapp@gmail.com</a> · (31) 91234-5678</li>
          <li class="mb-2"><a href="mailto:contato.barberapp@gmail.com">contato.barberapp@gmail.com</a> · (31) 98765-4321</li>
        </ul>
      </div>
      <div class="col-12 col-md-4 mb-3">
        <h2 class="footer-title">REDES SOCIAIS</h2>
        <ul class="list-unstyled">
          <li class="mb-2"><img class="social-icon" src="img/icone-instagram.png" alt="Instagram"> @agenda_barber</li>
          <li class="mb-2"><img class="social-icon" src="img/icone-facebook.png" alt="Facebook"> @agenda_barber</li>
        </ul>
      </div>
    </div>
    <div class="divider-gold"></div>
    <p class="footer-copyright">© ${new Date().getFullYear()} Zé Barbeiro. Todos os direitos reservados.</p>
  </footer>`;

function fromTemplate(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content;
}

function renderHeader(usuario, activeKey) {
  const fragment = fromTemplate(HEADER_TEMPLATE);
  const home = HOME_BY_ROLE[usuario.perfil];
  fragment.querySelector('[data-home-link]').href = home;
  fragment.querySelector('[data-greeting]').textContent = `Olá, ${usuario.nome.split(' ')[0]}!`;

  const links = [{ key: 'inicio', label: 'INÍCIO', href: home }, ...NAV_ITEMS[usuario.perfil]]
    .map((item) => el('a', {
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
        notifySuccess('Senha alterada com sucesso!');
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
    redirectToLogin();
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

  const activeKey = document.body.dataset.nav;
  byId('app-header').replaceWith(renderHeader(usuario, activeKey));
  byId('app-footer').replaceWith(fromTemplate(FOOTER_TEMPLATE));
  document.body.append(fromTemplate(ACCOUNT_MODALS_TEMPLATE));
  bindAccountModals(usuario);
  document.body.classList.add('is-ready');
  return usuario;
}
