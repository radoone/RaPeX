import { runSafetyGateWeeklyLoaderJob } from "../safety-gate-weekly-loader.js";

async function main() {
  console.log("=== Starting Weekly Safety Gate Sync for 2026 Weeks 31-36 ===");
  try {
    const result = await runSafetyGateWeeklyLoaderJob({
      year: 2026,
      weeks: [31, 32, 33, 34, 35, 36],
    });
    console.log("=== Weekly Sync Completed Successfully ===");
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error("=== Weekly Sync Failed ===", error);
    process.exit(1);
  }
}

main();
