import { execFileSync } from "node:child_process";

const PROJECT_ID = process.env.GCLOUD_PROJECT || "rapex-99a2c";
const DEFAULT_BASE_URL =
  process.env.FIREBASE_FUNCTIONS_BASE_URL ||
  "https://europe-west1-rapex-99a2c.cloudfunctions.net";

function getSafetyGateApiKey(): string {
  if (typeof process.env.SAFETY_GATE_API_KEY === "string" && process.env.SAFETY_GATE_API_KEY.trim()) {
    return process.env.SAFETY_GATE_API_KEY.trim();
  }

  return execFileSync(
    "gcloud",
    ["secrets", "versions", "access", "latest", "--secret=SAFETY_GATE_API_KEY", `--project=${PROJECT_ID}`],
    { encoding: "utf8" },
  ).trim();
}

async function main() {
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 20;
  const apiKey = getSafetyGateApiKey();

  const response = await globalThis.fetch(`${DEFAULT_BASE_URL}/pilotRapexEmbeddingBackfill`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      limit: Number.isFinite(limit) && limit > 0 ? limit : 20,
    }),
  });

  const payload = await response.json();

  if (!response.ok) {
    console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
