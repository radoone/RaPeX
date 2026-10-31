import { describe, expect, it, vi } from "vitest";
import { loader } from "../app/routes/app.audit-report[.]csv";

const { findMany, authenticateAdmin } = vi.hoisted(() => ({
  findMany: vi.fn(),
  authenticateAdmin: vi.fn(),
}));
vi.mock("../app/merchant-db.server", () => ({ default: { safetyAlert: { findMany } } }));
vi.mock("../app/firestore.server", () => {
  const ref: any = {};
  ref.collection = vi.fn(() => ref);
  ref.doc = vi.fn(() => ref);
  ref.orderBy = vi.fn(() => ref);
  ref.get = vi.fn(async () => ({ docs: [] }));
  return { firestore: ref };
});
vi.mock("../app/shopify.server", () => ({ authenticate: { admin: authenticateAdmin } }));

describe("authenticated audit export", () => {
  it("returns a complete CSV scoped to the authenticated shop with inert product text", async () => {
    authenticateAdmin.mockResolvedValue({ session: { shop: "example.myshopify.com" } });
    findMany.mockResolvedValue([{
      id: "finding-1", productTitle: '=HYPERLINK("https://example.com")', productId: "1", status: "active",
      createdAt: new Date("2026-10-15T08:00:00Z"), checkResult: "{}",
    }]);
    const response = await loader({ request: new Request("https://example.com/app/audit-report.csv"), url: new URL("https://example.com/app/audit-report.csv") } as never);
    const content = Buffer.from(await response.arrayBuffer()).toString("utf8");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { shop: "example.myshopify.com" } }));
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Length")).toBe(String(Buffer.byteLength(content)));
    expect(response.headers.get("Content-Disposition")).toContain("attachment;");
    expect(content).toContain('"Shopify product ID"');
    expect(content).toContain('"\'=HYPERLINK(""https://example.com"")"');
    expect(content.split("\r\n")).toHaveLength(2);
  });
  it("does not read merchant data when authentication fails", async () => {
    findMany.mockClear();
    authenticateAdmin.mockRejectedValue(new Response(null, { status: 401 }));
    await expect(loader({ request: new Request("https://example.com/app/audit-report.csv"), url: new URL("https://example.com/app/audit-report.csv") } as never)).rejects.toMatchObject({ status: 401 });
    expect(findMany).not.toHaveBeenCalled();
  });
  it("does not export unverified matcher claims from existing findings", async () => {
    authenticateAdmin.mockResolvedValue({ session: { shop: "example.myshopify.com" } });
    findMany.mockResolvedValue([{
      id: "finding-2", productTitle: "Doll", productId: "2", status: "active",
      createdAt: new Date("2026-10-15T08:00:00Z"),
      checkResult: JSON.stringify({ warnings: [{ reason: "Both products contain toxic chemicals", alertDetails: { fields: { danger: "Official alert describes a chemical risk" } } }] }),
    }]);
    const response = await loader({ request: new Request("https://example.com/app/audit-report.csv"), url: new URL("https://example.com/app/audit-report.csv") } as never);
    const content = await response.text();
    expect(content).not.toContain("Both products contain toxic chemicals");
    expect(content).toContain("Possible match. Compare the product identifiers");
    expect(content).toContain("Official alert describes a chemical risk");
  });
});
