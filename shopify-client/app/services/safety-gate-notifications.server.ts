import { unauthenticated } from "../shopify.server";
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

      // 1. Auto-Quarantine (Auto-Draft)
      if (settings.autoDraftHighRisk) {
        console.log(`Auto-drafting product ${productId} on shop ${shop}`);
        try {
          const { admin } = await unauthenticated.admin(shop);
          const productGid = productId.startsWith("gid://") ? productId : `gid://shopify/Product/${productId}`;
          
          const response = await admin.graphql(`#graphql
            mutation productUpdate($input: ProductInput!) {
              productUpdate(input: $input) {
                product { id status }
                userErrors { field message }
              }
            }
          `, {
            variables: {
              input: {
                id: productGid,
                status: "DRAFT"
              }
            }
          });

          const responseJson = await response.json();
          console.log(`Draft response:`, JSON.stringify(responseJson));

          // Log to Activity Logs
          await db.activityLog.create({
            data: {
              shop,
              type: "automatic",
              action: "quarantine",
              details: `Automatically drafted high-risk product. Matched warning: "${alertName}" (${criticalWarning.overallSimilarity}% similarity).`
            }
          });
        } catch (gqlErr) {
          console.error("Failed to execute product auto-draft GraphQL mutation:", gqlErr);
        }
      }

      // 2. Email Notifications
      if (settings.emailNotifications) {
        console.log(`[Notification Alert] Send email to merchant for shop ${shop}: Product ${productId} is unsafe!`);
        // Log notification trigger to activity log
        await db.activityLog.create({
          data: {
            shop,
            type: "automatic",
            action: "check",
            details: `Sent email alert notification for unsafe product match "${alertName}".`
          }
        });
      }

      // 3. Slack Notifications
      if (settings.slackWebhookUrl) {
        console.log(`[Slack Alert] Send slack payload to ${settings.slackWebhookUrl}`);
        try {
          const res = await fetch(settings.slackWebhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: `🚨 *Safety Gate (RAPEX) Critical Alert* for shop *${shop}*!\n\n` +
                    `*Product in catalog:* ID ${productId}\n` +
                    `*Matched Safety Gate Alert:* ${alertName}\n` +
                    `*Similarity Score:* ${criticalWarning.overallSimilarity}%\n` +
                    `*Risk Level:* ${criticalWarning.riskLevel || 'High/Serious'}\n` +
                    `*Status:* ${settings.autoDraftHighRisk ? "Automatically set to DRAFT" : "Needs Review"}`
            })
          });
          
          if (!res.ok) {
            console.error(`Slack webhook returned status ${res.status}`);
          } else {
            // Log Slack trigger to activity log
            await db.activityLog.create({
              data: {
                shop,
                type: "automatic",
                action: "check",
                details: `Sent Slack webhook notification for unsafe product match "${alertName}".`
              }
            });
          }
        } catch (slackErr) {
          console.error("Failed to send Slack alert:", slackErr);
        }
      }
    }
  } catch (error) {
    console.error("Error in handleAutoDraftAndNotifications:", error);
  }
}
