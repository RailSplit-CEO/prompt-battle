// Shared Firebase app singleton — single initialization point
import { initializeApp, FirebaseApp, getApps } from 'firebase/app';

const firebaseConfig = {
  apiKey: "AIzaSyAT4zIS0piAqGfW5ZTCWnbkQPzyLHNDRHY",
  authDomain: "prompt-battle-c5e6a.firebaseapp.com",
  databaseURL: "https://prompt-battle-c5e6a-default-rtdb.firebaseio.com",
  projectId: "prompt-battle-c5e6a",
  storageBucket: "prompt-battle-c5e6a.firebasestorage.app",
  messagingSenderId: "329010584107",
  appId: "1:329010584107:web:c8b08fe0487459e1c1286e",
};

let app: FirebaseApp | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!app) {
    const existing = getApps();
    app = existing.length > 0 ? existing[0] : initializeApp(firebaseConfig);
  }
  return app;
}

export { firebaseConfig };
