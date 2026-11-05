/**
 * Seleção de horários nas tabelas de agenda: destaca a linha marcada,
 * permite clicar em qualquer parte da linha e mostra quantos horários estão selecionados.
 * @returns {{ refresh: () => void }} atualiza o contador após redesenhar a tabela
 */
export function bindSlotSelection(tbody, counter) {
  const checkboxes = () => [...tbody.querySelectorAll('.slot-checkbox')];

  function refresh() {
    let total = 0;
    for (const checkbox of checkboxes()) {
      checkbox.closest('tr').classList.toggle('is-selected', checkbox.checked);
      if (checkbox.checked) total += 1;
    }
    counter.textContent = total === 0
      ? 'Nenhum horário selecionado'
      : `${total} ${total === 1 ? 'horário selecionado' : 'horários selecionados'}`;
  }

  tbody.addEventListener('change', (event) => {
    if (event.target.matches('.slot-checkbox')) refresh();
  });

  tbody.addEventListener('click', (event) => {
    if (event.target.closest('input, button, a, label')) return;
    const checkbox = event.target.closest('tr')?.querySelector('.slot-checkbox');
    if (checkbox && !checkbox.disabled) {
      checkbox.checked = !checkbox.checked;
      refresh();
    }
  });

  return { refresh };
}
