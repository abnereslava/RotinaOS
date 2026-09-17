(() => {
  const select = document.getElementById('theme-select');
  if (!select) return;

  const themes = [
    ['sage', 'Sage / Graphite'],
    ['japanese', 'Japanese Stationery'],
    ['xuan', 'Xuan Paper / Cinnabar'],
    ['pinkball', 'Pink Ball'],
    ['pollyana', 'Pollyana']
  ];

  themes.forEach(([value, label]) => {
    if (select.querySelector(`option[value="${value}"]`)) return;
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });

  const updateThemeColor = () => {
    requestAnimationFrame(() => {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) return;
      const color = getComputedStyle(document.body).getPropertyValue('--bg-color').trim();
      if (color) meta.setAttribute('content', color);
    });
  };

  select.addEventListener('change', updateThemeColor);

  const observer = new MutationObserver(mutations => {
    if (mutations.some(mutation => mutation.attributeName === 'data-theme')) updateThemeColor();
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });

  const scheme = window.matchMedia?.('(prefers-color-scheme: dark)');
  scheme?.addEventListener?.('change', updateThemeColor);

  updateThemeColor();
})();
