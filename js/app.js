// Entrada canônica do RotinaOS.
// Carrega a mesma pilha de recursos tanto na primeira visita quanto no PWA já
// controlado pelo Service Worker, evitando diferenças entre usuário e visitante.

const STYLE_ASSETS = [
  'css/mobile-fixes.css',
  'css/calendar-view.css',
  'css/calendar-history.css',
  'css/calendar-v3.css',
  'css/theme-polish.css',
  'css/pink-ball.css',
  'css/pollyana.css',
  'css/pollyana-hud.css',
  'css/pollyana-v28.css',
  'css/ui-polish-v24.css',
  'css/optional-date-fix.css',
  'css/category-rename.css',
  'css/activity-tracking.css'
];

const CLASSIC_SCRIPTS = [
  'js/theme-enhancements.js',
  'js/filter-persistence.js',
  'js/ui-fixes.js',
  'js/main-swipe.js',
  'js/mobile-back-nav.js'
];

function ensureStyles() {
  STYLE_ASSETS.forEach(href => {
    if (document.querySelector(`link[data-rotinaos-style="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.rotinaosStyle = href;
    document.head.appendChild(link);
  });
}

function loadClassicScript(src) {
  const existing = document.querySelector(`script[data-rotinaos-script="${src}"]`);
  if (existing) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset.rotinaosScript = src;
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error(`Falha ao carregar ${src}`)), { once: true });
    document.head.appendChild(script);
  });
}

ensureStyles();

// Estes arquivos nasceram como scripts clássicos; mantemos essa semântica para
// não alterar globals/strict mode ao unificar a primeira visita com o PWA.
for (const src of CLASSIC_SCRIPTS) {
  await loadClassicScript(src);
}

await import('./optional-date-fix.js');

// Bootstrap cria Firebase/Auth e decide entre conta real e demonstração.
await import('./bootstrap.js');

// Recursos modernos que funcionam tanto com Firestore quanto com o store local
// do modo visitante.
await import('./category-rename.js');
await import('./activity-tracking.js');
await import('./calendar-view-v3.js');
await import('./demo-calendar-bridge.js');
