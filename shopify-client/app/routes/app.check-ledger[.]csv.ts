import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { checkLedger } from "../services/check-ledger.server";
import { csvCell } from "../services/audit-csv";
import { checkLedgerCopy } from "../locales/check-ledger";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const { records, generatedAt, scanned, nextCursor, filters } = await checkLedger(session.shop, url);
  const language = (url.searchParams.get("lang") || "en").split(/[-_]/)[0];
  const copy = checkLedgerCopy[language as keyof typeof checkLedgerCopy] || checkLedgerCopy.en;
  const columns = [copy.shop, copy.generated, copy.scope, copy.scanned, copy.nextCursor, copy.filter, copy.product, copy.productId,
    copy.version, copy.checkedVersion, copy.checkedAt, copy.state, copy.result, copy.evidence, copy.coveredThrough, copy.policy, copy.limit];
  const rows = records.map(record => [session.shop, generatedAt, copy.pageScope, scanned, nextCursor, filters.state,
    record.title, record.id, record.productVersion, record.checkedVersion, record.checkedAt, copy.states[record.state],
    copy.results[record.result], copy.evidenceTypes[record.evidence], record.coveredThrough, record.matcherPolicy, copy.legal]);
  const csv = "\uFEFF" + [columns, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
  return new Response(csv, { headers: {
    "Content-Type": "text/csv; charset=utf-8", "Content-Length": String(Buffer.byteLength(csv)),
    "Content-Disposition": `attachment; filename="zerorecall-check-evidence-page-${generatedAt.slice(0, 10)}.csv"`,
    "Cache-Control": "no-store",
    "X-Check-Ledger-Scope": "current-catalog-page",
    "X-Check-Ledger-Scanned": String(scanned),
    "X-Check-Ledger-Has-More": String(Boolean(nextCursor)),
  } });
}
