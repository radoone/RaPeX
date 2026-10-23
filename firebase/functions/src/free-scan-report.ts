import { createHash, timingSafeEqual } from "node:crypto";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase-admin.js";
import type { ScanPreviewMatch } from "./free-scan-catalog.js";

export function reportTokenParts(value: unknown): { id: string; secret: string } | null {
  const match = typeof value === "string" && /^([A-Za-z0-9]{20})\.([A-Za-z0-9_-]{43})$/.exec(value);
  return match ? { id: match[1], secret: match[2] } : null;
}
export function reportAccessAllowed(data: Record<string, unknown>, secret: string, now = Date.now()): boolean {
  const expected = data.reportAccessHash;
  const actual = createHash("sha256").update(secret).digest("hex");
  return data.status === "completed" && data.expireAt instanceof Timestamp && data.expireAt.toMillis() > now &&
    typeof expected === "string" && /^[a-f0-9]{64}$/.test(expected) && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

/** All receipts, in bounded pages. The anonymous status route never calls this. */
export async function readFreeScanReport(token: unknown, cursor: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const parsed = reportTokenParts(token);
  if (!parsed || (cursor !== undefined && (typeof cursor !== "string" || !/^\d{1,30}$/.test(cursor)))) return { status: 400, body: { error: "Invalid report link." } };
  const ref = db.collection("free_scan_requests").doc(parsed.id);
  const snapshot = await ref.get();
  const data = snapshot.data();
  if (!data || !reportAccessAllowed(data, parsed.secret)) return { status: 403, body: { error: "Report link is unavailable or expired." } };
  let query = ref.collection("products").orderBy(FieldPath.documentId()).limit(200);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  const matches = page.docs.flatMap(doc => doc.get("match") ? [doc.get("match") as ScanPreviewMatch] : []);
  return { status: 200, body: {
    domain: data.domain, checkedProducts: data.checkedProducts, possibleMatches: data.possibleMatches,
    matches, nextCursor: page.size === 200 ? page.docs.at(-1)!.id : null,
  } };
}
