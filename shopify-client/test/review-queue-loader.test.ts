import { beforeEach, describe, expect, it, vi } from "vitest";
import { action, loader } from "../app/routes/app.alerts";

const { findMany, count, admin, recordDecisions, listDecisionEvents } = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  admin: vi.fn(),
  recordDecisions: vi.fn(),
  listDecisionEvents: vi.fn(),
}));
vi.mock("../app/shopify.server", () => ({ authenticate: { admin } }));
vi.mock("../app/merchant-db.server", () => ({
  default: { safetyAlert: { findMany, count, recordDecisions, listDecisionEvents } },
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
        id: "waiting",
        status: "active",
        reviewState: "contacted_supplier",
        productId: "3",
        productTitle: "Supplier follow-up",
        riskLevel: "Serious",
        createdAt: "2026-10-01",
      },
      {
        id: "urgent",
        status: "active",
        productId: "2",
        productTitle: "Urgent",
        riskLevel: "Serious",
        createdAt: "2026-10-31",
      },
    ];
    findMany.mockImplementation(async ({ where, skip = 0, take }: any) => {
      const matching = records.filter(record =>
        (!where.id || where.id === record.id) &&
        (!where.status || where.status === record.status) &&
        (!where.riskLevel || where.riskLevel === record.riskLevel || where.riskLevel.in?.includes(record.riskLevel)),
      );
      return matching.slice(skip, take ? skip + take : undefined);
    });
    count.mockImplementation(async ({ where }: any) =>
      records.filter(record => !where.status || where.status === record.status).length,
    );
    listDecisionEvents.mockResolvedValue([]);

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
    expect(first.stats).toMatchObject({ active: 31, waiting: 1, total: 32 });
    expect(first.nextReviewAlertId).toBe("urgent");
    expect(second.alerts).toHaveLength(6);
    expect(
      new Set([...first.alerts, ...second.alerts].map((alert) => alert.id))
        .size,
    ).toBe(31);
  });
  it("retains explicit date sorting and database pagination", async () => {
    await load("?view=all&sortBy=created&page=2");
    expect(findMany.mock.calls[0][0]).toMatchObject({
      orderBy: { createdAt: "desc" },
      skip: 25,
      take: 25,
    });
  });
  it("filters historical Safety Gate severity labels without changing the shop queue totals", async () => {
    const result = await load("?riskLevel=serious");
    expect(result.alerts.map(alert => alert.id)).toEqual(["urgent"]);
    expect(result.stats).toMatchObject({ active: 31, waiting: 1 });
    expect(findMany.mock.calls[0][0].where.riskLevel.in).toEqual(expect.arrayContaining([
      "serious", "Serious", "Serious risk",
    ]));
  });
  it("opens linked supplier follow-ups without adding them to the decision queue", async () => {
    const queue = await load("?open=waiting");
    expect(queue.alerts.some(alert => alert.id === "waiting")).toBe(false);
    expect(queue.linkedAlert.id).toBe("waiting");

    const waiting = await load("?status=waiting_for_supplier");
    expect(waiting.alerts.map(alert => alert.id)).toEqual(["waiting"]);
    expect(waiting.pagination.totalCount).toBe(1);
    expect(waiting.nextReviewAlertId).toBe("urgent");
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

  it("confirms the submitted decision after recording it", async () => {
    expect(await save()).toEqual({ success: true, reviewedAlertId: "current" });
    expect(recordDecisions).toHaveBeenCalledWith(expect.objectContaining({
      shop: "example.myshopify.com",
      alertIds: ["current"],
      resolutionType: "contacted_supplier",
    }));
  });

  it("does not confirm a failed decision", async () => {
    recordDecisions.mockRejectedValue(new Error("Could not save"));
    expect(await save()).toEqual({ success: false, error: "Could not save" });
  });
});
