import "./firebase-init.js";
import { getApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";

const firebaseApp = getApp();
const auth = getAuth(firebaseApp);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Mantém a conta proprietária fora do código-fonte em texto puro. Isso é apenas
// uma barreira de interface; a autorização real dos dados deve continuar nas
// Security Rules do Firestore.
const AUTHORIZED_EMAIL_HASHES = new Set([
  "4bf451b29a9463c6a0759b549d5b8e44d4ca364b96f3138bd3d72aa61f903d19"
]);

let appLoaded = false;
let authActionInProgress = false;
let demoBootstrapping = false;

setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.warn("Não foi possível configurar persistência local do Firebase Auth:", error);
});

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

function getGoogleEmail(user) {
  const googleProfile = user?.providerData?.find((provider) => provider.providerId === "google.com");
  return normalizeEmail(googleProfile?.email || "");
}

function hasGoogleProvider(user) {
  return Boolean(user?.providerData?.some((provider) => provider.providerId === "google.com"));
}

async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) return "";
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function isAllowedGoogleUser(user) {
  const googleEmail = getGoogleEmail(user);
  if (!googleEmail) return false;
  const fingerprint = await sha256Hex(googleEmail);
  return Boolean(fingerprint && AUTHORIZED_EMAIL_HASHES.has(fingerprint));
}

function setLoginStatus(message = "", isError = false) {
  const status = document.getElementById("auth-status");
  if (!status) return;
  status.textContent = message;
  status.style.color = isError ? "#ff6b6b" : "var(--text-secondary)";
}

function setGoogleButtonBusy(busy, label) {
  const button = document.getElementById("btn-google-login");
  if (!button) return;
  button.disabled = busy;
  button.style.opacity = busy ? "0.65" : "1";
  button.style.cursor = busy ? "wait" : "pointer";
  const labelEl = button.querySelector("span");
  if (labelEl) labelEl.textContent = label || (busy ? "AGUARDE..." : "ENTRAR COM GOOGLE");
}

function setDemoButtonBusy(busy) {
  const button = document.getElementById("btn-demo-mode");
  if (!button) return;
  button.disabled = busy;
  button.style.opacity = busy ? "0.65" : "1";
  button.style.cursor = busy ? "wait" : "pointer";
  const labelEl = button.querySelector("span");
  if (labelEl) labelEl.textContent = busy ? "PREPARANDO DEMONSTRAÇÃO..." : "TESTAR O APLICATIVO";
}

function googleLoginCardMarkup() {
  return `
    <div class="auth-card">
      <div class="auth-logo">
        <i class="fas fa-robot"></i>
        <span>TO-DO<strong>OS</strong></span>
      </div>
      <h3 id="auth-title">// ACESSO</h3>
      <form id="form-auth">
        <p style="margin:0 0 18px;color:var(--text-secondary);text-align:center;line-height:1.45;">
          Entre com a conta autorizada ou explore uma demonstração local do aplicativo.
        </p>
        <button type="button" class="btn-primary" id="btn-google-login" style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;">
          <i class="fab fa-google"></i>
          <span>ENTRAR COM GOOGLE</span>
        </button>
        <div class="auth-divider">OU</div>
        <button type="button" class="btn-secondary" id="btn-demo-mode" style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;">
          <i class="fas fa-play"></i>
          <span>TESTAR O APLICATIVO</span>
        </button>
        <p id="auth-status" aria-live="polite" style="min-height:20px;margin:14px 0 0;text-align:center;font-size:.85rem;color:var(--text-secondary);"></p>
      </form>
    </div>
  `;
}

function renderGoogleLogin(message = "", isError = false) {
  if (window.__ROTINAOS_DEMO__) return;

  const app = document.getElementById("app");
  if (app) app.classList.add("hidden");

  const authContainer = document.getElementById("auth-container");
  if (!authContainer) return;

  authContainer.innerHTML = googleLoginCardMarkup();
  authContainer.classList.remove("hidden");
  bindLoginButtons();
  setLoginStatus(message, isError);
}

function getTodayString() {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function buildDemoActivities() {
  const today = getTodayString();
  const createdAt = Date.now();

  return [
    { id: 'demo1', title: '🚀 Explorar o To-doOS', category: 'Tutorial', priority: '3', recurrence: 'single', status: 'pending', createdAt },
    { id: 'demo2', title: '🍔 Almoçar com a equipe', category: 'Social', priority: '2', recurrence: 'daily', scheduledDate: today, scheduledTime: '12:00', status: 'pending', createdAt },
    { id: 'demo3', title: '💻 Finalizar Projeto X', category: 'Trabalho', priority: '3', recurrence: 'single', deadline: '2026-05-15', status: 'pending', createdAt },
    { id: 'demo4', title: '🎸 Praticar Violão', category: 'Hobby', priority: '1', recurrence: 'weekly', fixedDays: [1, 3, 5], status: 'pending', createdAt },
    { id: 'demo5', title: '🧹 Limpar a sala', category: 'Casa', priority: '1', recurrence: 'weekly', fixedDays: [6], status: 'completed', createdAt },
    { id: 'demo6', title: '📚 Ler 20 páginas', category: 'Estudos', priority: '2', recurrence: 'single', status: 'pending', createdAt },
    { id: 'demo7', title: '🛒 Fazer compras', category: 'Casa', priority: '1', recurrence: 'single', status: 'pending', createdAt },
    { id: 'demo8', title: '🎧 Podcast Semanal', category: 'Hobby', priority: '2', recurrence: 'weekly', fixedDays: [2, 4], status: 'pending', createdAt },
    { id: 'demo9', title: '☕ Café da manhã', category: 'Rotina', priority: '1', recurrence: 'daily', scheduledDate: today, scheduledTime: '08:30', status: 'pending', createdAt },
    { id: 'demo10', title: '📞 Reunião de Alinhamento', category: 'Trabalho', priority: '3', recurrence: 'single', scheduledDate: today, scheduledTime: '10:00', status: 'pending', createdAt },
    { id: 'demo11', title: '🏋️ Treino na Academia', category: 'Saúde', priority: '2', recurrence: 'daily', scheduledDate: today, scheduledTime: '18:00', status: 'pending', createdAt }
  ];
}

function publishDemoActivities() {
  const list = buildDemoActivities();
  window.__ROTINAOS_DEMO_ACTIVITIES__ = list.map(item => ({ ...item }));
  document.dispatchEvent(new CustomEvent('rotinaos:demo-activities', {
    detail: { activities: window.__ROTINAOS_DEMO_ACTIVITIES__.map(item => ({ ...item })) }
  }));
}

async function handleGoogleLogin() {
  if (authActionInProgress || window.__ROTINAOS_DEMO__) return;
  authActionInProgress = true;
  setGoogleButtonBusy(true);
  setLoginStatus("");

  try {
    const result = await signInWithPopup(auth, googleProvider);

    if (!(await isAllowedGoogleUser(result.user))) {
      await signOut(auth);
      renderGoogleLogin("Esta conta Google não está autorizada. Use a demonstração para explorar o aplicativo.", true);
      return;
    }

    await prepareAuthorizedUser(result.user);
  } catch (error) {
    console.error("Falha no login Google:", error);

    let message = "Não foi possível entrar com o Google.";
    if (error?.code === "auth/popup-closed-by-user") message = "Login cancelado.";
    if (error?.code === "auth/popup-blocked") message = "O navegador bloqueou a janela do Google. Permita pop-ups e tente novamente.";

    setLoginStatus(message, true);
  } finally {
    authActionInProgress = false;
    setGoogleButtonBusy(false);
  }
}

async function handleDemoMode() {
  if (appLoaded || demoBootstrapping) return;

  demoBootstrapping = true;
  window.__ROTINAOS_DEMO__ = true;
  setDemoButtonBusy(true);
  setLoginStatus("Preparando demonstração local...");

  try {
    // Publica os dados antes de carregar o núcleo. Assim todos os módulos usam
    // exatamente a mesma coleção local desde o primeiro render.
    publishDemoActivities();
    await loadOriginalApplication({ demo: true });

    await new Promise(resolve => window.setTimeout(resolve, 120));
    setDemoButtonBusy(false);
    document.getElementById('btn-demo-mode')?.click();
  } catch (error) {
    console.error('Falha ao iniciar modo demonstração:', error);
    window.__ROTINAOS_DEMO__ = false;
    renderGoogleLogin('Não foi possível iniciar a demonstração.', true);
  } finally {
    demoBootstrapping = false;
  }
}

function bindLoginButtons() {
  const googleButton = document.getElementById("btn-google-login");
  if (googleButton && googleButton.dataset.bootstrapBound !== "true") {
    googleButton.dataset.bootstrapBound = "true";
    googleButton.addEventListener("click", handleGoogleLogin);
  }

  const demoButton = document.getElementById("btn-demo-mode");
  if (demoButton && demoButton.dataset.bootstrapBound !== "true") {
    demoButton.dataset.bootstrapBound = "true";
    demoButton.addEventListener("click", handleDemoMode);
  }
}

async function prepareAuthorizedUser(user) {
  if (!hasGoogleProvider(user) || !(await isAllowedGoogleUser(user))) {
    await signOut(auth);
    renderGoogleLogin("Use a conta autorizada ou entre na demonstração.", true);
    return;
  }

  await loadOriginalApplication();
}

async function loadOriginalApplication({ demo = false } = {}) {
  if (appLoaded) return;
  appLoaded = true;

  const authContainer = document.getElementById("auth-container");
  if (authContainer) authContainer.classList.add("hidden");

  if (!demo) {
    const occurrenceModule = await import("./occurrence-history.js");
    await occurrenceModule.occurrenceHistoryReady;
  }

  const coreLoader = await import("./core-loader.js");
  await coreLoader.loadCore();
}

onAuthStateChanged(auth, async (user) => {
  if (window.__ROTINAOS_DEMO__) return;

  try {
    if (!user) {
      renderGoogleLogin();
      return;
    }

    if (!(await isAllowedGoogleUser(user))) {
      await signOut(auth);
      renderGoogleLogin("Esta conta Google não está autorizada. Use a demonstração para explorar o aplicativo.", true);
      return;
    }

    await prepareAuthorizedUser(user);
  } catch (error) {
    console.error("Erro no gate de autenticação:", error);
    renderGoogleLogin("Ocorreu um erro ao preparar o acesso. Tente novamente.", true);
  }
});

renderGoogleLogin();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((error) => {
    console.warn("Falha ao registrar Service Worker:", error);
  });
}
