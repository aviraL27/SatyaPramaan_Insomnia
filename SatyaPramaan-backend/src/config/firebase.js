const admin = require("firebase-admin");
const { env } = require("./env");

let firebaseApp;

function buildCredential() {
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    return admin.credential.cert(parsed);
  }

  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    return admin.credential.cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    });
  }

  return null;
}

function isFirebaseConfigured() {
  return Boolean(buildCredential());
}

function getFirebaseAdmin() {
  if (!firebaseApp) {
    const credential = buildCredential();

    if (!credential) {
      throw new Error("Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_* env vars.");
    }

    firebaseApp = admin.initializeApp({ credential });
  }

  return admin;
}

module.exports = { getFirebaseAdmin, isFirebaseConfigured };
