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

const MODERN_FEATURES = [
  './category-rename.js',
  './activity-tracking.js',
  './calendar-view-v3.js',
  './demo-calendar-bridge.js'
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
    script.async = true;
    script.dataset.rotinaosScript = src;
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error(`Falha ao carregar ${src}`)), { once: true });
    document.head.appendChild(script);
  });
}

function showBootFailure(error) {
  console.error('Falha ao inicializar o RotinaOS:', error);
  const auth = document.getElementById('auth-container');
  if (!auth) return;
  auth.classList.remove('hidden');
  auth.innerHTML = `
    <div class="auth-card">
      <div class="auth-logo"><span>TO-DO<strong>OS</strong></span></div>
      <h3>// NÃO FOI POSSÍVEL ABRIR</h3>
      <p style="line-height:1.5;color:var(--text-secondary);text-align:center;">
        ${navigator.onLine
          ? 'O aplicativo não conseguiu concluir a inicialização. Recarregue a página.'
          : 'O cache offline deste aparelho ainda não está completo. Conecte-se uma vez, abra o aplicativo e tente novamente sem internet.'}
      </p>
      <button type="button" class="btn-primary" style="width:100%;" onclick="location.reload()">TENTAR NOVAMENTE</button>
    </div>
  `;
}

ensureStyles();

// Antes estes scripts eram baixados um por vez, adicionando vários round-trips
// ao boot. Eles são independentes e podem ser preparados em paralelo.
const classicResults = await Promise.allSettled(CLASSIC_SCRIPTS.map(loadClassicScript));
classicResults.forEach((result, index) => {
  if (result.status === 'rejected') {
    console.warn(`Recurso auxiliar não carregado: ${CLASSIC_SCRIPTS[index]}`, result.reason);
  }
});

await import('./optional-date-fix.js').catch(error => {
  console.warn('Interface de data opcional não carregada:', error);
});

try {
  // Bootstrap cria Firebase/Auth e decide entre conta real e demonstração.
  await import('./bootstrap.js');
} catch (error) {
  showBootFailure(error);
  throw error;
}

// Recursos complementares não devem impedir a agenda principal de abrir.
const featureResults = await Promise.allSettled(MODERN_FEATURES.map(path => import(path)));
featureResults.forEach((result, index) => {
  if (result.status === 'rejected') {
    console.warn(`Recurso moderno não carregado: ${MODERN_FEATURES[index]}`, result.reason);
  }
});
