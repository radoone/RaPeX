import db from "../merchant-db.server";
import { type SafetyCheckResult } from "./safety-gate-checker.server";

export async function handleAutoDraftAndNotifications(
  shop: string,
  productId: string,
  safetyResult: SafetyCheckResult
) {
  try {
    const settings = await db.safetySetting.findUnique({ where: { shop } });
    if (!settings) return;

    // Check for high-risk warning (similarity >= 95% and risk serious/high)
    const criticalWarning = safetyResult.warnings.find(w => {
      const similarity = w.overallSimilarity ?? 0;
      const risk = String(w.riskLevel || w.alertDetails?.fields?.alert_level || w.alertDetails?.fields?.risk_level || "").toLowerCase();
      const isHighRisk = risk.includes("serious") || risk.includes("high") || risk === "1" || risk === "2";
      return similarity >= 95 && isHighRisk;
    });

    if (criticalWarning) {
      const alertName = criticalWarning.alertDetails?.fields?.product_name ||
                        criticalWarning.alertDetails?.fields?.product_brand ||
                        "unknown product";

      // 1. Priority review marker. This intentionally avoids product mutations so the app only needs read_products.
      if (settings.autoDraftHighRisk) {
        console.log(`Marked product ${productId} for priority safety review on shop ${shop}`);
        await db.activityLog.create({
          data: {
            shop,
            type: "automatic",
            action: "quarantine",
            details: `Marked high-risk product for priority review. Matched warning: "${alertName}" (${criticalWarning.overallSimilarity}% similarity).`
          }
        });
      }

      // Email delivery is intentionally handled by the Firebase alert-created trigger.
      // Keeping a single delivery path prevents duplicate messages across manual checks,
      // Shopify webhooks, and scheduled delta monitoring.
    }
  } catch (error) {
    console.error("Error in handleAutoDraftAndNotifications:", error);
  }
}
