import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../merchant-db.server";
import { requireActiveBilling } from "../services/billing.server";

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function parsePrimaryWarning(checkResult: string | null | undefined) {
  try {
    const parsed = checkResult ? JSON.parse(checkResult) : null;
    const warning = Array.isArray(parsed?.warnings) ? parsed.warnings[0] : null;
    return {
      alertType: warning?.alertType || warning?.alertDetails?.fields?.alert_type || "",
      riskLevel:
        warning?.alertDetails?.fields?.alert_level ||
        warning?.alertDetails?.fields?.risk_level ||
        warning?.riskLevel ||
        "",
      overallSimilarity:
        typeof warning?.overallSimilarity === "number" ? warning.overallSimilarity : "",
      safetyGateAlert:
        warning?.alertDetails?.fields?.alert_number ||
        warning?.alertId ||
        "",
      recommendation: parsed?.recommendation || "",
    };
  } catch {
    return {
      alertType: "",
      riskLevel: "",
      overallSimilarity: "",
      safetyGateAlert: "",
      recommendation: "",
    };
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const billingRedirect = await requireActiveBilling(billing, session.shop);
  if (billingRedirect) return billingRedirect as never;
  const alerts = await db.safetyAlert.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });

  const headers = [
    "Product",
    "Shopify product ID",
    "Status",
    "Resolution",
    "Risk level",
    "Alert type",
    "Overall match",
    "Safety Gate alert",
    "Detected at",
    "Resolved at",
    "Dismissed at",
    "Audit notes",
    "Recommendation",
  ];

  const rows = alerts.map((alert: any) => {
    const warning = parsePrimaryWarning(alert.checkResult);
    return [
      alert.productTitle,
      alert.productId,
      alert.status,
      alert.resolutionType,
      warning.riskLevel || alert.riskLevel,
      warning.alertType,
      warning.overallSimilarity,
      warning.safetyGateAlert,
      alert.createdAt,
      alert.resolvedAt,
      alert.dismissedAt,
      alert.notes,
      warning.recommendation,
    ].map(csvCell).join(",");
  });

  const csv = [headers.map(csvCell).join(","), ...rows].join("\n");
  const date = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="safety-gate-audit-report-${date}.csv"`,
    },
  });
};

export default function AuditReportRoute() {
  return null;
}
