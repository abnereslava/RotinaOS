import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

// Configuração pública do app Firebase. Em apps web do Firebase esses valores
// identificam o projeto; a proteção dos dados continua sendo responsabilidade
// das Security Rules do Firestore/Auth.
export const firebaseConfig = {
  apiKey: "AIzaSyC-iFjByyV-QLGP253kdlJYVqvryw1BI2E",
  authDomain: "planejamentosemanal-6d1dc.firebaseapp.com",
  projectId: "planejamentosemanal-6d1dc",
  storageBucket: "planejamentosemanal-6d1dc.firebasestorage.app",
  messagingSenderId: "537704966796",
  appId: "1:537704966796:web:74b8c137790698f7f8a9a9"
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

let firestore;
try {
  // IndexedDB mantém os documentos já sincronizados disponíveis sem internet e
  // enfileira gravações locais para sincronização quando a conexão voltar.
  firestore = initializeFirestore(firebaseApp, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
} catch (error) {
  // Caso outro módulo já tenha inicializado o Firestore ou o navegador não
  // ofereça o armazenamento persistente esperado, preserva o funcionamento normal.
  console.warn('Persistência offline do Firestore não pôde ser inicializada; usando cache padrão.', error);
  firestore = getFirestore(firebaseApp);
}

export const db = firestore;
