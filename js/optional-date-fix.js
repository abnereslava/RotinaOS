// A data de agendamento agora é opcional no próprio núcleo do RotinaOS.
// Este módulo cuida apenas da interface do botão de limpar.

function installDateClearButton() {
  const input = document.getElementById('act-date');
  const group = document.getElementById('group-single-date');
  if (!input || !group || document.getElementById('btn-clear-act-date')) return;

  const row = document.createElement('div');
  row.className = 'optional-date-row';

  input.parentNode.insertBefore(row, input);
  row.appendChild(input);

  const button = document.createElement('button');
  button.id = 'btn-clear-act-date';
  button.type = 'button';
  button.className = 'btn-secondary optional-date-clear';
  button.title = 'Limpar data de agendamento';
  button.setAttribute('aria-label', 'Limpar data de agendamento');
  button.innerHTML = '<i class="fas fa-eraser"></i><span>Limpar</span>';

  button.addEventListener('click', () => {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus({ preventScroll: true });
  });

  row.appendChild(button);
}

function initializeOptionalDateUi() {
  installDateClearButton();
}

initializeOptionalDateUi();
document.addEventListener('DOMContentLoaded', initializeOptionalDateUi, { once: true });

new MutationObserver(initializeOptionalDateUi).observe(document.documentElement, {
  childList: true,
  subtree: true
});
