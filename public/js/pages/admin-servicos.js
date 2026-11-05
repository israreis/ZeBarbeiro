import { initAppShell } from '../components/app-shell.js';
import { initCrudPage } from '../components/crud-page.js';
import { formatCurrency } from '../core/format.js';
import { value } from '../core/forms.js';

if (await initAppShell('administrador')) {
  await initCrudPage({
    resource: '/servicos',
    titles: { create: 'CADASTRAR SERVIÇO', edit: 'EDITAR SERVIÇO' },
    messages: { created: 'Serviço cadastrado com sucesso!', updated: 'Serviço atualizado com sucesso!' },
    columns: [
      { render: (s) => s.nome },
      { render: (s) => formatCurrency(s.valor) },
      { className: 'hide-sm', render: (s) => `${s.duracaoMinutos} min` },
      { render: (s) => (s.ativo ? 'Ativo' : 'Inativo') },
    ],
    fillForm(form, servico) {
      form.elements.nome.value = servico?.nome ?? '';
      form.elements.valor.value = servico?.valor ?? '';
      form.elements.duracaoMinutos.value = servico?.duracaoMinutos ?? 30;
      form.elements.ativo.value = String(servico?.ativo ?? true);
    },
    readForm: (form) => ({
      nome: value(form, 'nome'),
      valor: Number(value(form, 'valor')),
      duracaoMinutos: Number(value(form, 'duracaoMinutos')),
      ativo: form.elements.ativo.value === 'true',
    }),
  });
}
