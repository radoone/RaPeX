import { beforeEach, describe, expect, it, vi } from "vitest";
import { action, loader } from "../app/routes/app.alerts";

const { findMany, count, admin, recordDecisions } = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  admin: vi.fn(),
  recordDecisions: vi.fn(),
}));
vi.mock("../app/shopify.server", () => ({ authenticate: { admin } }));
vi.mock("../app/merchant-db.server", () => ({
  default: { safetyAlert: { findMany, count, recordDecisions } },
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

describe("saving a review decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    admin.mockResolvedValue({ session: { shop: "example.myshopify.com", id: "actor" } });
    recordDecisions.mockResolvedValue({ count: 1 });
  });

  const save = async () => {
    const request = new Request("https://example.com/app/alerts", {
      method: "POST",
      body: new URLSearchParams({ action: "resolve", alertId: "current", resolutionType: "contacted_supplier" }),
    });
    return (await action({ request } as never)).data;
  };

  it("offers the highest-priority eligible match only after saving", async () => {
    findMany.mockResolvedValue([
      { id: "current", status: "active", riskLevel: "Serious" },
      { id: "waiting", status: "active", reviewState: "waiting_for_supplier", riskLevel: "Serious" },
      { id: "low", status: "active", riskLevel: "Low" },
      { id: "next", status: "active", riskLevel: "High" },
    ]);
    expect(await save()).toEqual({ success: true, reviewedAlertId: "current", nextMatchId: "next" });
    expect(recordDecisions).toHaveBeenCalledBefore(findMany);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { shop: "example.myshopify.com", status: "active" },
    }));
  });

  it("confirms the decision without a next button if only the saved match remains", async () => {
    findMany.mockResolvedValue([{ id: "current", status: "active" }]);
    expect(await save()).toEqual({ success: true, reviewedAlertId: "current", nextMatchId: null });
  });
});
