import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { genkit } from "genkit";
import { googleAI, vertexAI } from "@genkit-ai/google-genai";

export function initializeFirebaseAdmin(): void {
  if (getApps().length === 0) {
    const projectId =
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GCLOUD_PROJECT ||
      "rapex-99a2c";
    initializeApp({ projectId });
  }
}

initializeFirebaseAdmin();

export const db = getFirestore();

export const functionsAi = genkit({
  plugins: [
    googleAI({
      apiKey: process.env.GOOGLE_API_KEY || undefined,
    }),
    vertexAI({
      location: process.env.GCLOUD_LOCATION || "us-central1",
    }),
  ],
  promptDir: "./prompts",
});

export const embeddingsAi = functionsAi;
