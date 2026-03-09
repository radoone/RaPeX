import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { genkit } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";

export function initializeFirebaseAdmin(): void {
  if (getApps().length === 0) {
    initializeApp();
  }
}

initializeFirebaseAdmin();

export const db = getFirestore();

export const functionsAi = genkit({
  plugins: [googleAI()],
  promptDir: "./prompts",
});

export const embeddingsAi = functionsAi;
