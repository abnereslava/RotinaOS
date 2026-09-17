(() => {
  const select = document.getElementById('theme-select');
  if (!select) return;

  const THEME_KEY = 'userTheme';
  const MODE_KEY = 'userThemeMode';
  const LAST_RANDOM_KEY = 'rotinaos.randomTheme.last';

  const removedThemes = new Set(['sage', 'japanese', 'xuan']);
  const availableThemes = [
    ['y2k', 'Y2K (Original)'],
    ['medieval', 'Medieval'],
    ['zelda', 'Boy Without a Fairy'],
    ['pinkball', 'Pink Ball'],
    ['pollyana', 'Pollyana']
  ];
  const randomThemeValues = availableThemes.map(([value]) => value);

  // Remove temas que não fazem mais parte da interface.
  removedThemes.forEach(value => select.querySelector(`option[value="${value}"]`)?.remove());

  // Garante que os temas customizados atuais existam.
  availableThemes.forEach(([value, label]) => {
    if (select.querySelector(`option[value="${value}"]`)) return;
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });

  // Aleatório fica sempre em primeiro lugar.
  let randomOption = select.querySelector('option[value="random"]');
  if (!randomOption) {
    randomOption = document.createElement('option');
    randomOption.value = 'random';
    randomOption.textContent = 'Aleatório';
  }
  select.insertBefore(randomOption, select.firstChild);

  const updateThemeColor = () => {
    requestAnimationFrame(() => {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) return;
      const color = getComputedStyle(document.body).getPropertyValue('--bg-color').trim();
      if (color) meta.setAttribute('content', color);
    });
  };

  const chooseRandomTheme = ({ excludeCurrent = false } = {}) => {
    const lastRandom = localStorage.getItem(LAST_RANDOM_KEY);
    const currentTheme = document.body.getAttribute('data-theme');

    let candidates = randomThemeValues.filter(theme => theme !== lastRandom);
    if (excludeCurrent && candidates.length > 1) {
      const withoutCurrent = candidates.filter(theme => theme !== currentTheme);
      if (withoutCurrent.length) candidates = withoutCurrent;
    }
    if (!candidates.length) candidates = [...randomThemeValues];

    return candidates[Math.floor(Math.random() * candidates.length)];
  };

  const applyRandomTheme = ({ excludeCurrent = false } = {}) => {
    const theme = chooseRandomTheme({ excludeCurrent });
    localStorage.setItem(THEME_KEY, theme);
    localStorage.setItem(LAST_RANDOM_KEY, theme);
    document.body.setAttribute('data-theme', theme);
    select.value = 'random';
    updateThemeColor();
    return theme;
  };

  // Migra um tema removido salvo anteriormente para Pollyana.
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (removedThemes.has(savedTheme)) {
    localStorage.setItem(THEME_KEY, 'pollyana');
    localStorage.setItem(MODE_KEY, 'fixed');
  }

  // Compatibilidade caso algum estado intermediário tenha salvo "random" como tema físico.
  if (localStorage.getItem(THEME_KEY) === 'random') {
    localStorage.setItem(MODE_KEY, 'random');
  }

  // Em modo aleatório, toda nova abertura escolhe um tema diferente do sorteio anterior.
  if (localStorage.getItem(MODE_KEY) === 'random') {
    applyRandomTheme();
  }

  // Intercepta Aleatório antes do listener legado do app.js, para nunca aplicar data-theme="random".
  select.addEventListener('change', event => {
    const requested = select.value;

    if (requested === 'random') {
      event.stopImmediatePropagation();
      localStorage.setItem(MODE_KEY, 'random');
      applyRandomTheme({ excludeCurrent: true });
      return;
    }

    if (removedThemes.has(requested)) return;
    localStorage.setItem(MODE_KEY, 'fixed');
  }, true);

  // O app.js aplica o tema físico salvo e também tenta selecionar esse valor no select.
  // Quando o modo é aleatório, mantemos "Aleatório" visível no seletor sem alterar o tema sorteado.
  const observer = new MutationObserver(mutations => {
    if (!mutations.some(mutation => mutation.attributeName === 'data-theme')) return;
    if (localStorage.getItem(MODE_KEY) === 'random') select.value = 'random';
    updateThemeColor();
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });

  const scheme = window.matchMedia?.('(prefers-color-scheme: dark)');
  scheme?.addEventListener?.('change', updateThemeColor);

  // Se estiver em modo fixo, reflete o tema salvo assim que possível.
  if (localStorage.getItem(MODE_KEY) !== 'random') {
    const currentSaved = localStorage.getItem(THEME_KEY);
    if (currentSaved && randomThemeValues.includes(currentSaved)) select.value = currentSaved;
  } else {
    select.value = 'random';
  }

  updateThemeColor();
})();
