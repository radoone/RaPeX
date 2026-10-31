import { beforeEach, describe, expect, it, vi } from "vitest";
import { loader } from "../app/routes/app.alerts";

const { findMany, count, admin } = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  admin: vi.fn(),
}));
vi.mock("../app/shopify.server", () => ({ authenticate: { admin } }));
vi.mock("../app/merchant-db.server", () => ({
  default: { safetyAlert: { findMany, count } },
}));
vi.mock("../app/services/review-evidence.server", () => ({
  withOfficialReferences: async (records: any[]) => records,
}));
vi.mock("../app/components", () => ({
  AlertTable: () => null,
  AlertDetailModal: () => null,
}));

describe("review queue pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    admin.mockResolvedValue({
      session: { shop: "example.myshopify.com" },
      admin: {
        graphql: async () => ({ json: async () => ({ data: { nodes: [] } }) }),
      },
    });
    const records = [
      ...Array.from({ length: 30 }, (_, i) => ({
        id: `low-${String(i).padStart(2, "0")}`,
        status: "active",
        productId: "1",
        productTitle: "Product",
        riskLevel: "Low",
        createdAt: "2026-10-01",
      })),
      {
        id: "urgent",
        status: "active",
        productId: "2",
        productTitle: "Urgent",
        riskLevel: "Serious",
        createdAt: "2026-10-31",
      },
    ];
    findMany.mockImplementation(async (options: any) =>
      options.select
        ? []
        : records.slice(
            options.skip || 0,
            options.take ? (options.skip || 0) + options.take : undefined,
          ),
    );
    count.mockResolvedValue(records.length);
  });
  const load = async (query = "") => {
    const url = new URL(`https://example.com/app/alerts${query}`);
    return (await loader({ request: new Request(url), url } as never)).data;
  };
  it("prioritizes the complete shop queue before slicing pages, without duplicates", async () => {
    const first = await load();
    const second = await load("?page=2");
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { shop: "example.myshopify.com", status: "active" },
    });
    expect(findMany.mock.calls[0][0]).not.toHaveProperty("take");
    expect(first.alerts[0].id).toBe("urgent");
    expect(first.alerts).toHaveLength(25);
    expect(second.alerts).toHaveLength(6);
    expect(
      new Set([...first.alerts, ...second.alerts].map((alert) => alert.id))
        .size,
    ).toBe(31);
  });
  it("retains explicit date sorting and database pagination", async () => {
    await load("?sortBy=created&page=2");
    expect(findMany.mock.calls[0][0]).toMatchObject({
      orderBy: { createdAt: "desc" },
      skip: 25,
      take: 25,
    });
  });
});
