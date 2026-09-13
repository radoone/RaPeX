import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { genkit } from "genkit";
import { googleAI, vertexAI } from "@genkit-ai/google-genai";

function loadEnvFiles(): void {
  const candidatePaths = [
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../.env.local"),
    resolve(process.cwd(), "../.env"),
    resolve(process.cwd(), "firebase/functions/.env.local"),
    resolve(process.cwd(), "firebase/functions/.env"),
  ];

  for (const filePath of candidatePaths) {
    if (existsSync(filePath)) {
      try {
        if (typeof process.loadEnvFile === "function") {
          process.loadEnvFile(filePath);
        } else {
          const content = readFileSync(filePath, "utf-8");
          content.split("\n").forEach((line) => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
              const [key, ...rest] = trimmed.split("=");
              const val = rest.join("=").replace(/^["']|["']$/g, "").trim();
              if (key && !process.env[key.trim()]) {
                process.env[key.trim()] = val;
              }
            }
          });
        }
      } catch (err: unknown) {
        // Environment file is optional; continue silently if missing or unreadable
        void err;
      }
    }
  }
}

loadEnvFiles();

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
db.settings({ ignoreUndefinedProperties: true });

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
