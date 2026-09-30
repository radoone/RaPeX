import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../merchant-db.server";

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function parsePrimaryWarning(checkResult: string | null | undefined) {
  try {
    const parsed = checkResult ? JSON.parse(checkResult) : null;
    const warning = Array.isArray(parsed?.warnings) ? parsed.warnings[0] : null;
    return {
      alertType: warning?.alertType || warning?.alertDetails?.fields?.alert_type || "",
      riskLevel: warning?.alertDetails?.fields?.alert_level || warning?.alertDetails?.fields?.risk_level || warning?.riskLevel || "",
      overallSimilarity: typeof warning?.overallSimilarity === "number" ? warning.overallSimilarity : "",
      safetyGateAlert: warning?.alertDetails?.fields?.alert_number || warning?.alertId || "",
      recommendation: parsed?.recommendation || "",
    };
  } catch {
    return { alertType: "", riskLevel: "", overallSimilarity: "", safetyGateAlert: "", recommendation: "" };
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const batchSize = 500;
  const alerts: any[] = [];
  for (let skip = 0; ; skip += batchSize) {
    const batch = await db.safetyAlert.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      skip,
      take: batchSize,
    });
    alerts.push(...batch);
    if (batch.length < batchSize) break;
  }

  const headers = ["Product", "Shopify product ID", "Status", "Resolution", "Risk level", "Alert type", "Overall match", "Safety Gate alert", "Detected at", "Resolved at", "Dismissed at", "Audit notes", "Recommendation"];
  const rows = alerts.map((alert) => {
    const warning = parsePrimaryWarning(alert.checkResult);
    return [alert.productTitle, alert.productId, alert.status, alert.resolutionType, warning.riskLevel || alert.riskLevel, warning.alertType, warning.overallSimilarity, warning.safetyGateAlert, alert.createdAt?.toISOString?.() || alert.createdAt, alert.resolvedAt?.toISOString?.() || alert.resolvedAt, alert.dismissedAt?.toISOString?.() || alert.dismissedAt, alert.notes, warning.recommendation].map(csvCell).join(",");
  });
  const date = new Date().toISOString().slice(0, 10);
  const csvContent = "\uFEFF" + [headers.map(csvCell).join(","), ...rows].join("\r\n");
  return new Response(csvContent, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="safety-gate-audit-report-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
