import * as admin from 'firebase-admin';

let initialized = false;

export function initAdmin(): admin.database.Database {
  if (!initialized) {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccount)),
        databaseURL: 'https://prompt-battle-c5e6a-default-rtdb.firebaseio.com',
      });
    } else {
      admin.initializeApp({
        databaseURL: 'https://prompt-battle-c5e6a-default-rtdb.firebaseio.com',
      });
    }
    initialized = true;
  }
  return admin.database();
}

export function getDb(): admin.database.Database {
  return admin.database();
}
