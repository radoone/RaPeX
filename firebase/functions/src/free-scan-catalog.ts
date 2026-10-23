import { createHash } from "node:crypto";

export const PUBLIC_CATALOG_PAGE_SIZE = 50;
export type PublicCatalogProduct = { id: number; [key: string]: any };
export type FreeScanPage = { requestId: string; pageIndex: number };
export type ScanPreviewMatch = {
  productId?: string; productTitle?: string; productUrl?: string;
  result?: { warnings?: Array<{
    alertId?: string; overallSimilarity?: number; reason?: string;
    alertDetails?: { fields?: Record<string, unknown> };
  }> };
};

/** Keep actionable source evidence without storing an unbounded matcher result. */
export function compactScanPreview(matches: ScanPreviewMatch[]): ScanPreviewMatch[] {
  return matches.slice(0, 5).map(match => compactScanMatch(match, 1));
}

export function compactScanMatch(match: ScanPreviewMatch, maxWarnings = Infinity): ScanPreviewMatch {
  const text = (value: unknown, limit: number) => typeof value === "string" ? value.slice(0, limit) : "";
  return ({
    productId: text(match.productId, 100), productTitle: text(match.productTitle, 1000), productUrl: text(match.productUrl, 2048),
    result: { warnings: (match.result?.warnings || []).slice(0, maxWarnings).map(warning => {
      const source = warning.alertDetails?.fields || {};
      const fields = Object.fromEntries(["url", "rapex_url", "caseNumber", "alert_number", "type_numberOfModel", "product_model"].flatMap(key => {
        const value = text(source[key], key.includes("url") ? 2048 : 500);
        return value ? [[key, value]] : [];
      }));
      return {
        alertId: text(warning.alertId, 500), reason: text(warning.reason, 1200), alertDetails: { fields },
        ...(typeof warning.overallSimilarity === "number" && Number.isFinite(warning.overallSimilarity) ? { overallSimilarity: warning.overallSimilarity } : {}),
      };
    }) },
  });
}
export type CatalogProgress = {
  domain: string; status: string; nextPage: number; checkedProducts: number;
  possibleMatches: number; catalogComplete: boolean;
};

export function freeScanPageTaskId(payload: FreeScanPage): string {
  return createHash("sha256").update(`${payload.requestId}:${payload.pageIndex}`).digest("hex");
}

/** A public catalog is exhausted only after Shopify returns an actual empty page. */
export async function fetchPublicCatalogPage(domain: string, pageIndex: number): Promise<PublicCatalogProduct[]> {
  if (!/^[a-z0-9][a-z0-9-]{1,60}\.myshopify\.com$/.test(domain) || !Number.isSafeInteger(pageIndex) || pageIndex < 0) {
    throw new Error("Invalid public catalog cursor");
  }
  const url = `https://${domain}/products.json?limit=${PUBLIC_CATALOG_PAGE_SIZE}&page=${pageIndex + 1}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "ZeroRecall public catalog scan" },
    signal: globalThis.AbortSignal.timeout(20_000),
    redirect: "error",
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("json")) {
    throw new Error(`Catalog page unavailable (${response.status})`);
  }
  const body = await response.json() as { products?: unknown };
  if (!Array.isArray(body.products) || body.products.length > PUBLIC_CATALOG_PAGE_SIZE) throw new Error("Invalid catalog page");
  const products = body.products as PublicCatalogProduct[];
  if (products.some(product => !product || !Number.isSafeInteger(product.id) || product.id <= 0) ||
    new Set(products.map(product => product.id)).size !== products.length) throw new Error("Invalid product IDs in catalog page");
  return products;
}

export type CatalogPageIO = {
  load(): Promise<CatalogProgress | null>;
  fetch(domain: string, pageIndex: number): Promise<PublicCatalogProduct[]>;
  unseen(products: PublicCatalogProduct[]): Promise<PublicCatalogProduct[]>;
  scan(domain: string, products: PublicCatalogProduct[]): Promise<{ totalProductsScanned: number; flaggedProductsCount: number; matches: ScanPreviewMatch[] }>;
  commit(pageIndex: number, products: PublicCatalogProduct[], result: { totalProductsScanned: number; flaggedProductsCount: number; matches: ScanPreviewMatch[] }, exhausted: boolean): Promise<void>;
  enqueue(pageIndex: number): Promise<void>;
  report(): Promise<void>;
};

/** Retrying a committed page repairs the next enqueue instead of incrementing counts again. */
export async function runFreeScanCatalogPage(payload: FreeScanPage, io: CatalogPageIO): Promise<void> {
  if (!/^[A-Za-z0-9]{20}$/.test(payload.requestId) || !Number.isSafeInteger(payload.pageIndex) || payload.pageIndex < 0) throw new Error("Invalid free scan task");
  const state = await io.load();
  if (!state || !["queued", "running", "reporting"].includes(state.status)) return;
  if (state.catalogComplete) {
    if (state.checkedProducts === 0) throw new Error("The public catalog returned no products");
    await io.report();
    return;
  }
  if (payload.pageIndex > state.nextPage) throw new Error("Catalog cursor is ahead of saved progress");
  if (payload.pageIndex === state.nextPage) {
    const fetched = await io.fetch(state.domain, payload.pageIndex);
    const products = await io.unseen(fetched);
    if (fetched.length && !products.length) throw new Error("Catalog pagination repeated already checked products");
    const result = products.length ? await io.scan(state.domain, products)
      : { totalProductsScanned: 0, flaggedProductsCount: 0, matches: [] };
    if (result.totalProductsScanned !== products.length || result.flaggedProductsCount !== result.matches.length) {
      throw new Error("Catalog page checks were incomplete");
    }
    await io.commit(payload.pageIndex, products, result, fetched.length === 0);
  }
  const latest = await io.load();
  if (!latest || !["queued", "running", "reporting"].includes(latest.status)) return;
  if (latest.catalogComplete) {
    if (latest.checkedProducts === 0) throw new Error("The public catalog returned no products");
    await io.report();
  } else await io.enqueue(latest.nextPage);
}
