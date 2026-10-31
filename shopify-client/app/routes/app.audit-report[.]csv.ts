import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { csvCell } from "../services/audit-csv";
import {
  reviewRecords,
  reviewFilters,
} from "../services/review-records.server";
export async function loader({ request, url }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const { records, generatedAt } = await reviewRecords(
    session.shop,
    reviewFilters(url),
  );
  const headers = [
    "Shop",
    "Generated at",
    "Record type",
    "Product",
    "Shopify product ID",
    "Status",
    "Resolution",
    "Safety Gate case",
    "Official source",
    "Risk level",
    "Review guidance",
    "Risk in official alert",
    "Detected at",
    "Decision at",
    "Recorded by",
    "Review notes",
  ];
  const rows = records.flatMap((record) => {
    const base = [
      session.shop,
      generatedAt,
      "finding",
      record.productTitle,
      record.productId,
      record.status,
      record.resolutionType,
      record.caseNumber,
      record.url,
      record.riskLevel,
      "Possible match. Compare the product identifiers and official record before deciding.",
      record.sourceRisk,
      record.createdAt,
    ];
    return [
      [
        ...base,
        record.resolvedAt || record.dismissedAt,
        record.decisions[0]?.actorId,
        record.notes,
      ],
      ...record.decisions.map((event: any) => [
        session.shop,
        generatedAt,
        "decision",
        record.productTitle,
        record.productId,
        event.reviewState,
        event.resolutionType,
        record.caseNumber,
        record.url,
        record.riskLevel,
        "Possible match. Compare the product identifiers and official record before deciding.",
        record.sourceRisk,
        record.createdAt,
        event.createdAt,
        event.actorId,
        event.notes,
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
