import { initAppShell } from '../components/app-shell.js';
import { initCrudPage } from '../components/crud-page.js';
import { applyPhoneMask, value } from '../core/forms.js';
import { byId } from '../core/dom.js';

if (await initAppShell('administrador')) {
  applyPhoneMask(byId('unidade-telefone'));

  await initCrudPage({
    resource: '/unidades',
    titles: { create: 'CADASTRAR UNIDADE', edit: 'EDITAR UNIDADE' },
    messages: { created: 'Unidade cadastrada com sucesso!', updated: 'Unidade atualizada com sucesso!' },
    columns: [
      { render: (u) => u.nome },
      { className: 'hide-sm', render: (u) => u.endereco },
      { render: (u) => u.telefone },
      { className: 'hide-sm', render: (u) => u.email },
    ],
    fillForm(form, unidade) {
      for (const field of ['nome', 'endereco', 'telefone', 'email']) {
        form.elements[field].value = unidade?.[field] ?? '';
      }
    },
    readForm: (form) => ({
      nome: value(form, 'nome'),
      endereco: value(form, 'endereco'),
      telefone: value(form, 'telefone'),
      email: value(form, 'email'),
    }),
  });
}
