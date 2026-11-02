import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { createInstance } from "i18next";
import { localizedResources } from "../locales";
import { loadCompleteLocale } from "../locales/complete-loader";
import { csvCell } from "../services/audit-csv";
import { formatActorId } from "../services/review-evidence";
import {
  reviewRecords,
  reviewFilters,
} from "../services/review-records.server";
export async function loader({ request, url }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const filters = reviewFilters(url);
  const language = url.searchParams.get("lang") || "en";
  const i18n = createInstance();
  const locale = Object.hasOwn(localizedResources, language) ? language : "en";
  await i18n.init({ resources: structuredClone(localizedResources), lng: locale, fallbackLng: "en", interpolation: { escapeValue: false } });
  const catalog = await loadCompleteLocale(locale);
  if (catalog) i18n.addResourceBundle(locale, "translation", catalog, true, true);
  const t = i18n.t.bind(i18n);
  const { records, generatedAt } = await reviewRecords(
    session.shop,
    filters,
  );
  const headers = ["shop", "generatedAt", "recordType", "action", "product", "productId", "status", "resolution", "caseNumber", "source", "risk", "guidance", "sourceRisk", "detectedAt", "decisionAt", "actor", "notes"].map(key => t(`workspace.csv.${key}`));
  headers.push(t("barcodeMatch.label"));
  const rows = records.flatMap((record) => {
    const barcodeEvidence = (record.identifierMatches || []).map((item: any) =>
      [item.gtin, item.variantId, item.variantTitle].filter(Boolean).join(" · ")).join("; ");
    const base = [
      session.shop,
      generatedAt,
      "finding",
      "",
      record.productTitle,
      record.productId,
      record.status,
      record.resolutionType,
      record.caseNumber,
      record.url,
      record.riskLevel,
      t("workspace.csvGuidance"),
      record.sourceRisk,
      record.createdAt,
    ];
    return [
      ...(filters.dateBasis === "decisions" ? [] : [[
        ...base,
        record.resolutionType ? record.decisions.find((event: any) => event.resolutionType === record.resolutionType)?.createdAt || record.resolvedAt || record.dismissedAt : null,
        record.resolutionType ? formatActorId(record.decisions.find((event: any) => event.resolutionType === record.resolutionType)?.actorId) : "",
        record.notes,
        barcodeEvidence,
      ]]),
      ...record.decisions.map((event: any) => [
        session.shop,
        generatedAt,
        "decision",
        event.action,
        record.productTitle,
        record.productId,
        event.reviewState,
        event.resolutionType,
        record.caseNumber,
        record.url,
        record.riskLevel,
        t("workspace.csvGuidance"),
        record.sourceRisk,
        record.createdAt,
        event.createdAt,
        formatActorId(event.actorId),
        event.notes,
        barcodeEvidence,
      ]),
    ];
  });
  const csv =
    "\uFEFF" +
    [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Length": String(Buffer.byteLength(csv)),
      "Content-Disposition": `attachment; filename="zerorecall-checks-decisions-${generatedAt.slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
