import { initializeFirebaseAdmin } from "../firebase-admin.js";
import { runHistoricalSafetyGateBackfill } from "../safety-gate-loader.js";

initializeFirebaseAdmin();

async function main() {
  const args = process.argv.slice(2);
  let year: number | undefined;
  let fromYear: number | undefined;
  let toYear: number | undefined;
  let maxPages: number | undefined;
  let descending = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--year" && args[i + 1]) {
      year = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--from" && args[i + 1]) {
      fromYear = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--to" && args[i + 1]) {
      toYear = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--max-pages" && args[i + 1]) {
      maxPages = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--desc" || args[i] === "--descending") {
      descending = true;
    }
  }

  console.log("Starting Safety Gate historical backfill CLI", {
    year: year || null,
    fromYear: fromYear || null,
    toYear: toYear || null,
    descending,
  });

  try {
    const summary = await runHistoricalSafetyGateBackfill({
      year,
      fromYear,
      toYear,
      descending,
      maxPagesPerYear: maxPages,
    });
    console.log("Backfill completed successfully:", JSON.stringify(summary, null, 2));
    process.exit(0);
  } catch (error) {
    console.error("Backfill failed:", error);
    process.exit(1);
  }
}

main();
