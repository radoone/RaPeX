import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { genkit } from "genkit";
import { googleAI, vertexAI } from "@genkit-ai/google-genai";

export function initializeFirebaseAdmin(): void {
  if (getApps().length === 0) {
    initializeApp();
  }
}

initializeFirebaseAdmin();

export const db = getFirestore();

export const functionsAi = genkit({
  plugins: [
    googleAI(),
    vertexAI({
      location: process.env.GCLOUD_LOCATION || "us-central1",
      apiKey: process.env.GOOGLE_API_KEY || undefined,
    }),
  ],
  promptDir: "./prompts",
});

export const embeddingsAi = functionsAi;
