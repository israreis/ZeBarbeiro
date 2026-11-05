/**
 * Utilitários de DOM. Todo conteúdo vindo da API é inserido via textContent,
 * o que elimina o risco de XSS que existia com innerHTML + template strings.
 */

export function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Elemento #${id} não encontrado.`);
  return element;
}

/**
 * Cria um elemento.
 * @param {string} tag
 * @param {object} [props] className, text, dataset, attrs, on (eventos) e propriedades diretas
 * @param {Array<Node|string>} [children]
 */
export function el(tag, props = {}, children = []) {
  const element = document.createElement(tag);
  const { className, text, dataset, attrs, on, ...rest } = props;
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  Object.assign(element.dataset, dataset ?? {});
  for (const [name, value] of Object.entries(attrs ?? {})) element.setAttribute(name, value);
  for (const [event, handler] of Object.entries(on ?? {})) element.addEventListener(event, handler);
  Object.assign(element, rest);
  element.append(...children);
  return element;
}

/** Preenche um <select> com opções, mantendo um placeholder opcional. */
export function setOptions(select, items, { placeholder, value = (i) => i.id, label = (i) => i.nome } = {}) {
  const options = items.map((item) => el('option', { value: value(item), text: label(item) }));
  if (placeholder !== undefined) {
    options.unshift(el('option', { value: '', text: placeholder, disabled: !select.multiple, selected: true }));
  }
  select.replaceChildren(...options);
}

/**
 * Renderiza linhas de tabela a partir de uma definição de colunas.
 * Cada coluna: { className, render(row) => string | Node | null }.
 */
export function renderRows(tbody, rows, columns, { emptyMessage = 'Nenhum registro encontrado.' } = {}) {
  if (!rows.length) {
    tbody.replaceChildren(el('tr', {}, [
      el('td', { className: 'table-empty', text: emptyMessage, colSpan: columns.length }),
    ]));
    return;
  }
  tbody.replaceChildren(...rows.map((row) => el('tr', {}, columns.map((column) => {
    const content = column.render(row);
    const cell = el('td', { className: column.className ?? '' });
    if (content instanceof Node) cell.append(content);
    else cell.textContent = content ?? '';
    return cell;
  }))));
}

/** Mostra uma linha de "carregando" enquanto a requisição está em andamento. */
export function renderLoading(tbody, colSpan) {
  tbody.replaceChildren(el('tr', {}, [el('td', { className: 'table-empty', text: 'Carregando...', colSpan })]));
}

/** Desabilita o botão enquanto a ação assíncrona executa (evita cliques duplos). */
export async function withBusy(button, action) {
  if (button.disabled) return undefined;
  button.disabled = true;
  try {
    return await action();
  } finally {
    button.disabled = false;
  }
}

export const modal = {
  show: (element) => window.bootstrap?.Modal.getOrCreateInstance(element).show(),
  hide: (element) => window.bootstrap?.Modal.getOrCreateInstance(element).hide(),
};
