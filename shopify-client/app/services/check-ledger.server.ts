import { FieldPath } from "firebase-admin/firestore";
import { firestore } from "../firestore.server";
import { ledgerFilters, ledgerRow } from "./check-ledger";

export const CHECK_LEDGER_PAGE_SIZE = 50;

/** At most 51 catalog reads, 50 coverage reads and 50 one-row check queries per request.
 * Filtering happens within the scanned page, so even an empty page can have a next page.
 */
export async function checkLedger(shop: string, url: URL) {
  const filters = ledgerFilters(url);
  const tenant = firestore.collection("merchants").doc(encodeURIComponent(shop));
  let query = tenant.collection("products").orderBy(FieldPath.documentId()).limit(CHECK_LEDGER_PAGE_SIZE + 1);
  if (filters.cursor) query = query.startAfter(filters.cursor);
  const [merchant, products] = await Promise.all([tenant.get(), query.get()]);
  const installation = merchant.data() || { installationRetiredAt: true };
  const page = products.docs.slice(0, CHECK_LEDGER_PAGE_SIZE);
  const coverage = page.length ? await firestore.getAll(...page.map(product => tenant.collection("product_safety_coverage").doc(product.id))) : [];
  const checks = await Promise.all(page.map((product, index) => {
    const id = String(product.data().productId || decodeURIComponent(product.id));
    // Durable current-version coverage survives check-history TTL. Avoid extra
    // check reads when this stronger receipt already answers the question.
    if (ledgerRow(id, product.data(), coverage[index]?.data(), undefined, installation).state === "current") return null;
    return tenant.collection("checks").where("productId", "==", id)
      .orderBy("checkedAt", "desc").limit(1).get();
  }));
  const records = page.map((product, index) => ledgerRow(String(product.data().productId || decodeURIComponent(product.id)), product.data(),
    coverage[index]?.data(), checks[index]?.docs[0]?.data(), installation));
  return {
    records: records.filter(record => !filters.state || record.state === filters.state), filters,
    nextCursor: products.docs.length > CHECK_LEDGER_PAGE_SIZE ? page.at(-1)!.id : null,
    scanned: page.length, pageSize: CHECK_LEDGER_PAGE_SIZE, shop, generatedAt: new Date().toISOString(),
  };
}
