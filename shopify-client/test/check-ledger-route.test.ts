import { beforeEach, describe, expect, it, vi } from "vitest";
import { loader } from "../app/routes/app.check-ledger[.]csv";
import { checkLedger } from "../app/services/check-ledger.server";

const { authenticateAdmin, products, coverages, checkRows, paths, limits, cursors } = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(), products: [] as any[], coverages: [] as any[], checkRows: {} as Record<string, any>,
  paths: [] as string[], limits: [] as number[], cursors: [] as string[],
}));
vi.mock("../app/shopify.server", () => ({ authenticate: { admin: authenticateAdmin } }));
vi.mock("firebase-admin/firestore", () => ({ FieldPath: { documentId: () => "__name__" } }));
vi.mock("../app/firestore.server", () => {
  const ref = (path = "", productId = ""): any => ({
    path,
    collection: (id: string) => ref(`${path}/${id}`), doc: (id: string) => ref(`${path}/${id}`),
    orderBy: () => ref(path, productId),
    where: (_field: string, _operator: string, value: string) => ref(path, value),
    limit: (size: number) => { limits.push(size); return ref(path, productId); },
    startAfter: (cursor: string) => { cursors.push(cursor); return ref(path, productId); },
    get: async () => {
      paths.push(path);
      if (path.endsWith("/products")) return { docs: products };
      if (path.endsWith("/checks")) return { docs: checkRows[productId] ? [{ data: () => checkRows[productId] }] : [] };
      return { data: () => ({ createdAt: "2026-11-01" }) };
    },
  });
  return { firestore: { collection: (id: string) => ref(id), getAll: async (...refs: any[]) => {
    paths.push(...refs.map(r => r.path));
    return refs.map((_: any, i: number) => ({ data: () => coverages[i] }));
  } } };
});
const version = "2026-11-20T10:00:00Z";
const doc = (id: string, title = "Toy") => ({ id, data: () => ({ productId: id, name: title, sourceUpdatedAt: version }) });
const url = (query = "") => new URL(`https://app.test/app/check-ledger.csv${query}`);

describe("bounded authenticated product check evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks(); products.length = coverages.length = paths.length = limits.length = cursors.length = 0;
    for (const key in checkRows) delete checkRows[key];
    authenticateAdmin.mockResolvedValue({ session: { shop: "own.myshopify.com" } });
  });
  it("uses the authenticated tenant even if a different shop is requested", async () => {
    products.push(doc("1", '=HYPERLINK("https://bad.example")'));
    checkRows["1"] = { checkedAt: version, sourceUpdatedAt: version, isSafe: true };
    const response = await loader({ request: new Request(url("?shop=other.myshopify.com")) } as never);
    const csv = Buffer.from(await response.arrayBuffer()).toString("utf8");
    expect(paths.every(path => path.startsWith("merchants/own.myshopify.com"))).toBe(true);
    expect(csv).toContain('"\'=HYPERLINK(""https://bad.example"")"');
    expect(csv).toContain("No match recorded");
    expect(response.headers.get("X-Check-Ledger-Scope")).toBe("current-catalog-page");
    expect(response.headers.get("Content-Length")).toBe(String(Buffer.byteLength(csv)));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("does not read merchant data without authentication", async () => {
    authenticateAdmin.mockRejectedValue(new Response(null, { status: 401 }));
    await expect(loader({ request: new Request(url()) } as never)).rejects.toMatchObject({ status: 401 });
    expect(paths).toEqual([]);
  });
  it("reads at most 50 check receipts, retains a cursor and does not silently search the whole catalog", async () => {
    products.push(...Array.from({ length: 51 }, (_, i) => doc(String(i).padStart(3, "0"))));
    const page = await checkLedger("own.myshopify.com", url("?checkAfter=prior&checkState=current"));
    expect(page.records).toEqual([]);
    expect(page.scanned).toBe(50);
    expect(page.nextCursor).toBe("049");
    expect(cursors).toEqual(["prior"]);
    expect(limits.filter(size => size === 1)).toHaveLength(50);
    expect(limits.filter(size => size === 51)).toHaveLength(1);
    expect(paths.filter(path => path.includes("product_safety_coverage"))).toHaveLength(50);
  });
  it("uses durable negative receipts after check-history expiry without extra check queries", async () => {
    products.push(doc("1"));
    coverages.push({ installation: "2026-11-01", sourceUpdatedAt: version, completedAt: version,
      coveredThrough: version, resultJson: '{"isSafe":true}' });
    const page = await checkLedger("own.myshopify.com", url());
    expect(page.records[0]).toMatchObject({ state: "current", evidence: "fullIndex", result: "noMatch" });
    expect(paths.filter(path => path.endsWith("/checks"))).toEqual([]);
  });
  it("localizes CSV evidence labels and clearly identifies the bounded page", async () => {
    products.push(doc("1"));
    checkRows["1"] = { checkedAt: version, sourceUpdatedAt: version, isSafe: false };
    const response = await loader({ request: new Request(url("?lang=sk-SK")) } as never);
    const csv = await response.text();
    expect(csv).toContain("Zaznamenaná možná zhoda");
    expect(csv).toContain("najviac 50");
    expect(csv).toContain("nie je certifikátom");
  });
});
