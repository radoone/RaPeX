import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function initializeFirebaseAdmin(): void {
  if (getApps().length > 0) {
    return;
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    "rapex-99a2c";

  initializeApp({
    credential: applicationDefault(),
    projectId,
  });
}

initializeFirebaseAdmin();

export const firestore = getFirestore();
