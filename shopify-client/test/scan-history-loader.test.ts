import { beforeEach, describe, expect, it, vi } from "vitest";

const { authenticateAdmin, readMerchant, readAudit, monitoringRuns, reviewRecords } = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  readMerchant: vi.fn(),
  readAudit: vi.fn(),
  monitoringRuns: vi.fn(),
  reviewRecords: vi.fn(),
}));

vi.mock("../app/shopify.server", () => ({ authenticate: { admin: authenticateAdmin } }));
vi.mock("../app/firestore.server", () => ({
  firestore: {
    collection: () => ({
      doc: (shop: string) => ({
        get: () => readMerchant(shop),
        collection: () => ({ doc: (id: string) => ({ get: () => readAudit(shop, id) }) }),
      }),
    }),
  },
}));
vi.mock("../app/services/monitoring-runs.server", () => ({ getRecentMonitoringRuns: monitoringRuns }));
vi.mock("../app/services/review-records.server", () => ({
  reviewRecords,
  reviewFilters: () => ({}),
}));

import { loader } from "../app/routes/app.evidence";

const shop = "authenticated-shop.myshopify.com";
const load = (view: string) => {
  const url = new URL("https://example.test/app/evidence?shop=untrusted.myshopify.com&view=" + view);
  return loader({ request: new Request(url), url } as Parameters<typeof loader>[0]);
};

describe("scan history", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authenticateAdmin.mockResolvedValue({ session: { shop } });
    readMerchant.mockResolvedValue({ get: () => "audit-1" });
    readAudit.mockResolvedValue({
      data: () => ({
        status: "completed",
        completedAt: "2026-11-19T08:00:00Z",
        productsScanned: 0,
        alertsCreated: 0,
        lastError: "private diagnostic",
      }),
    });
    monitoringRuns.mockResolvedValue([
      { id: "monitoring-1", status: "queued", updatedAt: "2026-11-20T08:00:00.000Z" },
    ]);
  });

  it("merges the authenticated shop's recorded initial audit and monitoring runs", async () => {
    const result = await (await load("scans")).data;
    expect(result).toMatchObject({
      failed: false,
      runs: [
        { id: "monitoring-1", type: "monitoring", status: "queued" },
        { id: "audit-1", type: "initial", status: "completed", productsScanned: 0, alertsCreated: 0 },
      ],
    });
    expect(monitoringRuns).toHaveBeenCalledWith(shop, 5);
    expect(readAudit).toHaveBeenCalledWith(shop, "audit-1");
    expect(JSON.stringify(result)).not.toContain("private diagnostic");
  });

  it("renders an explicit read failure and leaves decision history available", async () => {
    monitoringRuns.mockRejectedValue(new Error("private diagnostic"));
    reviewRecords.mockResolvedValue({ records: [] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await (await load("scans")).data).toEqual({ view: "scans", runs: [], failed: true });
      expect(await (await load("decisions")).data).toMatchObject({ view: "decisions", records: [] });
      expect(reviewRecords).toHaveBeenCalledWith(shop, { dateBasis: "decisions" }, 100);
    } finally {
      warn.mockRestore();
    }
  });
});
