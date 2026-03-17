import * as admin from 'firebase-admin';
import fs from 'fs';
import os from 'os';
import path from 'path';

const DB_URL = 'https://prompt-battle-c5e6a-default-rtdb.firebaseio.com';
let initialized = false;

export function initAdmin(): admin.database.Database {
  if (!initialized) {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    const adcJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

    if (serviceAccount) {
      // Service account key JSON (direct)
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccount)),
        databaseURL: DB_URL,
      });
    } else if (adcJson) {
      // Application Default Credentials passed as JSON env var (for Fly.io)
      // Write to temp file and point GOOGLE_APPLICATION_CREDENTIALS at it
      const tmpPath = path.join(os.tmpdir(), 'gcloud-adc.json');
      fs.writeFileSync(tmpPath, adcJson);
      process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpPath;
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        databaseURL: DB_URL,
      });
    } else {
      // Local dev — uses gcloud application-default credentials automatically
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        databaseURL: DB_URL,
      });
    }
    initialized = true;
    console.log('[Firebase] Admin initialized');
  }
  return admin.database();
}

export function getDb(): admin.database.Database {
  return admin.database();
}
