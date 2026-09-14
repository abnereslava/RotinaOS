import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  linkWithPopup,
  signOut,
  unlink,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC-iFjByyV-QLGP253kdlJYVqvryw1BI2E",
  authDomain: "planejamentosemanal-6d1dc.firebaseapp.com",
  projectId: "planejamentosemanal-6d1dc",
  storageBucket: "planejamentosemanal-6d1dc.firebasestorage.app",
  messagingSenderId: "537704966796",
  appId: "1:537704966796:web:74b8c137790698f7f8a9a9"
};

// Lista de contas Google autorizadas. Para liberar outra conta futuramente,
// basta acrescentar o e-mail aqui e revisar as regras do Firebase.
const ALLOWED_EMAILS = new Set([
  "abner.eslava@gmail.com"
]);

// Usuário Firebase antigo, que contém os dados já existentes.
const LEGACY_UID = "4WWB1N34GLXWBEAX1lj3LDNUgsL2";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

let appLoaded = false;
let authActionInProgress = false;
let migrationInProgress = false;

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

function hasProvider(user, providerId) {
  return Boolean(user?.providerData?.some((provider) => provider.providerId === providerId));
}

function isAllowedGoogleUser(user) {
  const googleEmail = getGoogleEmail(user);
  return Boolean(googleEmail && ALLOWED_EMAILS.has(googleEmail));
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

function googleLoginCardMarkup() {
  return `
    <div class="auth-card">
      <div class="auth-logo">
        <i class="fas fa-robot"></i>
        <span>TO-DO<strong>OS</strong></span>
      </div>
      <h3 id="auth-title">// ACESSO PESSOAL</h3>
      <form id="form-auth">
        <p style="margin:0 0 18px;color:var(--text-secondary);text-align:center;line-height:1.45;">
          Entre com a conta Google autorizada para acessar seus dados.
        </p>
        <button type="button" class="btn-primary" id="btn-google-login" style="display:flex;align-items:center;justify-content:center;gap:10px;">
          <i class="fab fa-google"></i>
          <span>ENTRAR COM GOOGLE</span>
        </button>
        <p id="auth-status" aria-live="polite" style="min-height:20px;margin:14px 0 0;text-align:center;font-size:.85rem;color:var(--text-secondary);"></p>
      </form>
    </div>
  `;
}

function renderGoogleLogin(message = "", isError = false) {
  const app = document.getElementById("app");
  if (app) app.classList.add("hidden");

  const authContainer = document.getElementById("auth-container");
  if (!authContainer) return;

  authContainer.innerHTML = googleLoginCardMarkup();
  authContainer.classList.remove("hidden");
  bindGoogleButton();
  setLoginStatus(message, isError);
}

async function handleGoogleLogin() {
  if (authActionInProgress) return;
  authActionInProgress = true;
  setGoogleButtonBusy(true);
  setLoginStatus("");

  try {
    const existingUser = auth.currentUser;
    let result;

    // Caso a sessão antiga ainda esteja aberta, ligamos o Google diretamente ao
    // UID antigo. Assim o banco continua pertencendo ao mesmo usuário Firebase.
    if (existingUser && existingUser.uid === LEGACY_UID && !hasProvider(existingUser, "google.com")) {
      setGoogleButtonBusy(true, "VINCULANDO CONTA...");
      result = await linkWithPopup(existingUser, googleProvider);
    } else {
      result = await signInWithPopup(auth, googleProvider);
    }

    if (!isAllowedGoogleUser(result.user)) {
      await signOut(auth);
      renderGoogleLogin("Esta conta Google não está autorizada.", true);
      return;
    }

    await prepareAuthorizedUser(result.user);
  } catch (error) {
    console.error("Falha no login Google:", error);

    let message = "Não foi possível entrar com o Google.";
    if (error?.code === "auth/popup-closed-by-user") {
      message = "Login cancelado.";
    } else if (error?.code === "auth/popup-blocked") {
      message = "O navegador bloqueou a janela do Google. Permita pop-ups e tente novamente.";
    } else if (error?.code === "auth/credential-already-in-use") {
      message = "Esta conta Google já está ligada a outro usuário Firebase. A migração precisa ser concluída antes de continuar.";
    } else if (error?.code === "auth/account-exists-with-different-credential") {
      message = "O Firebase encontrou a conta antiga, mas ainda precisa vinculá-la ao Google. Entre uma vez pela sessão antiga neste navegador e tente novamente.";
    }

    setLoginStatus(message, true);
  } finally {
    authActionInProgress = false;
    setGoogleButtonBusy(false);
  }
}

function bindGoogleButton() {
  const button = document.getElementById("btn-google-login");
  if (!button || button.dataset.bound === "true") return;
  button.dataset.bound = "true";
  button.addEventListener("click", handleGoogleLogin);
}

async function removePasswordProviderIfPossible(user) {
  if (!hasProvider(user, "google.com") || !hasProvider(user, "password")) return user;

  try {
    const updatedUser = await unlink(user, "password");
    console.info("Provedor de senha removido; Google permanece vinculado ao usuário Firebase.");
    return updatedUser;
  } catch (error) {
    console.warn("Não foi possível remover o provedor de senha automaticamente:", error);
    return user;
  }
}

async function migrateLegacyActivitiesIfNeeded(user) {
  if (!user || user.uid === LEGACY_UID || migrationInProgress) return;

  migrationInProgress = true;
  setLoginStatus("Migrando seus dados antigos para a conta Google...");

  try {
    const legacyQuery = query(
      collection(db, "activities"),
      where("userId", "==", LEGACY_UID)
    );
    const snapshot = await getDocs(legacyQuery);

    if (snapshot.empty) return;

    const docs = snapshot.docs;
    for (let start = 0; start < docs.length; start += 400) {
      const batch = writeBatch(db);
      docs.slice(start, start + 400).forEach((item) => {
        batch.update(item.ref, { userId: user.uid });
      });
      await batch.commit();
    }

    console.info(`${docs.length} atividade(s) migrada(s) do UID antigo para o UID Google.`);
  } finally {
    migrationInProgress = false;
  }
}

async function prepareAuthorizedUser(user) {
  // O UID legado pode chegar aqui ainda autenticado por senha. Ele só recebe acesso
  // ao app depois que o Google autorizado for efetivamente vinculado.
  if (!hasProvider(user, "google.com")) {
    if (user.uid === LEGACY_UID) {
      renderGoogleLogin("Sua sessão antiga foi encontrada. Clique abaixo para vinculá-la à sua conta Google.");
      setGoogleButtonBusy(false, "VINCULAR COM GOOGLE");
      return;
    }

    await signOut(auth);
    renderGoogleLogin("Use a conta Google autorizada para entrar.", true);
    return;
  }

  if (!isAllowedGoogleUser(user)) {
    await signOut(auth);
    renderGoogleLogin("Esta conta Google não está autorizada.", true);
    return;
  }

  try {
    await migrateLegacyActivitiesIfNeeded(user);
  } catch (error) {
    console.error("Falha ao migrar dados antigos:", error);
    renderGoogleLogin(
      "Sua conta Google entrou, mas o Firebase bloqueou a migração automática dos dados do UID antigo. Os dados antigos não foram apagados.",
      true
    );
    return;
  }

  await removePasswordProviderIfPossible(user);
  await loadOriginalApplication();
}

async function loadOriginalApplication() {
  if (appLoaded) return;
  appLoaded = true;

  const authContainer = document.getElementById("auth-container");
  if (authContainer) authContainer.classList.add("hidden");

  // Prepara o histórico por ocorrência antes da lógica antiga fazer manutenção diária.
  const occurrenceModule = await import("./occurrence-history.js");
  await occurrenceModule.occurrenceHistoryReady;

  // Só agora a lógica completa do RotinaOS é carregada.
  await import("./app.js");
}

onAuthStateChanged(auth, async (user) => {
  try {
    if (!user) {
      renderGoogleLogin();
      return;
    }

    // Permite temporariamente apenas o UID legado chegar à etapa de vinculação.
    if (user.uid === LEGACY_UID && !hasProvider(user, "google.com")) {
      await prepareAuthorizedUser(user);
      return;
    }

    if (!isAllowedGoogleUser(user)) {
      await signOut(auth);
      renderGoogleLogin("Esta conta Google não está autorizada.", true);
      return;
    }

    await prepareAuthorizedUser(user);
  } catch (error) {
    console.error("Erro no gate de autenticação:", error);
    renderGoogleLogin("Ocorreu um erro ao preparar o acesso. Tente novamente.", true);
  }
});

// Substitui imediatamente a interface antiga de e-mail/senha antes de qualquer login.
renderGoogleLogin();

// Mantém o PWA atualizável mesmo enquanto o usuário está parado na tela de login.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((error) => {
    console.warn("Falha ao registrar Service Worker:", error);
  });
}
