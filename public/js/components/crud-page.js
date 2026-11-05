import { api } from '../core/api.js';
import {
  byId, el, modal, renderLoading, renderRows, withBusy,
} from '../core/dom.js';
import { isFormValid } from '../core/forms.js';
import { notifyError, notifySuccess } from '../core/notify.js';

/**
 * Página de cadastro (listagem + modal único para incluir/editar).
 * Usada pelas telas administrativas de barbeiros, serviços e unidades,
 * eliminando o código duplicado entre elas.
 *
 * @param {object} options
 * @param {string} options.resource caminho da API (ex.: '/servicos')
 * @param {Array<{className?: string, render: Function}>} options.columns colunas da tabela
 * @param {{create: string, edit: string}} options.titles títulos do modal
 * @param {{created: string, updated: string}} options.messages mensagens de sucesso
 * @param {(form: HTMLFormElement, item: object|null) => void} options.fillForm preenche o form (null = novo)
 * @param {(form: HTMLFormElement, item: object|null) => object|null} options.readForm lê e valida; null aborta
 * @param {() => Promise<void>} [options.beforeLoad] carga de dados auxiliares (ex.: opções de selects)
 * @param {(salvo: object, isEdit: boolean) => Promise<void>} [options.afterSave] etapa extra após salvar
 *   (ex.: enviar a foto); recebe o registro retornado pela API
 */
export async function initCrudPage({
  resource, columns, titles, messages, fillForm, readForm, beforeLoad, afterSave,
}) {
  const tbody = byId('tabela-registros');
  const modalElement = byId('modal-registro');
  const form = byId('form-registro');
  const title = byId('modal-registro-titulo');
  const submit = form.querySelector('[type="submit"]');
  let editing = null;

  const tableColumns = [
    ...columns,
    {
      className: 'col-acoes',
      render: (item) => el('button', {
        type: 'button', className: 'btn-table', text: 'Editar', on: { click: () => open(item) },
      }),
    },
  ];

  async function load() {
    renderLoading(tbody, tableColumns.length);
    try {
      renderRows(tbody, await api.get(resource), tableColumns);
    } catch (error) {
      renderRows(tbody, [], tableColumns, { emptyMessage: 'Não foi possível carregar os registros.' });
      notifyError(error);
    }
  }

  function open(item) {
    editing = item;
    form.reset();
    form.querySelectorAll('input, select').forEach((field) => field.setCustomValidity(''));
    form.dataset.mode = item ? 'edit' : 'create';
    title.textContent = item ? titles.edit : titles.create;
    fillForm(form, item);
    modal.show(modalElement);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const payload = readForm(form, editing);
    if (!payload || !isFormValid(form)) return;

    withBusy(submit, async () => {
      const isEdit = Boolean(editing);
      let salvo;
      try {
        salvo = isEdit
          ? await api.put(`${resource}/${encodeURIComponent(editing.id)}`, payload)
          : await api.post(resource, payload);
      } catch (error) {
        notifyError(error);
        return;
      }

      // O registro já existe: uma nova tentativa (ex.: se a etapa extra falhar) passa a ser edição.
      editing = salvo;
      try {
        if (afterSave) await afterSave(salvo, isEdit);
        modal.hide(modalElement);
        notifySuccess(isEdit ? messages.updated : messages.created);
      } catch (error) {
        notifyError(error);
      }
      await load();
    });
  });

  byId('btn-novo').addEventListener('click', () => open(null));

  if (beforeLoad) await beforeLoad();
  await load();
}
