import { HOME_BY_ROLE, getSession } from '../core/session.js';

/** Usuário já autenticado: os botões de acesso levam direto à sua área. */
const session = getSession();
if (session) {
  const home = HOME_BY_ROLE[session.usuario.perfil];
  document.querySelectorAll('[data-access-link]').forEach((link) => {
    link.href = home;
    if (link.dataset.accessLink === 'label') link.textContent = 'Minha área';
  });
}

/** O cabeçalho ganha fundo sólido quando a página sai do topo. */
const header = document.querySelector('.landing-header');
const updateHeader = () => header.classList.toggle('is-scrolled', window.scrollY > 24);
window.addEventListener('scroll', updateHeader, { passive: true });
updateHeader();
