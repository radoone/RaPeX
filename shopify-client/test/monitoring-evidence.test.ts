import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ merchant: vi.fn(), source: vi.fn(), runs: vi.fn(), shop: vi.fn() }));
vi.mock("../app/firestore.server", () => ({ firestore: {
  collection: () => ({ doc: (shop: string) => { mocks.shop(shop); return {
    get: mocks.merchant,
    collection: () => ({ orderBy: () => ({ limit: () => ({ get: mocks.runs }) }) }),
  }; } }),
  doc: () => ({ get: mocks.source }),
} }));
import { monitoringEvidence } from "../app/services/monitoring-evidence.server";
const document = (data: any) => ({ exists: true, data: () => data });
describe("merchant monitoring evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.merchant.mockResolvedValue(document({ initialScanStatus: "completed", initialScanProductsImported: 1200, lastMonitorStatus: "SUCCESS", lastMonitorRunEnd: "2026-11-01" }));
    mocks.source.mockResolvedValue(document({ last_run_status: "SUCCESS", last_run_end: "2026-11-01" }));
    mocks.runs.mockResolvedValue({ docs: [] });
  });
  it("reads only the authenticated tenant snapshot and safe operational facts", async () => {
    const result = await monitoringEvidence("example.myshopify.com");
    expect(mocks.shop).toHaveBeenCalledWith("example.myshopify.com");
    expect(result).toMatchObject({ importedProducts: 1200, initialStatus: "completed", monitorStatus: "SUCCESS", monitorEndedAt: "2026-11-01T00:00:00.000Z" });
    expect(Object.keys(result)).toHaveLength(6);
  });
  it("shows the current queued run instead of an older success", async () => {
    mocks.runs.mockResolvedValue({ docs: [{ data: () => ({ status: "queued" }) }] });
    expect(await monitoringEvidence("a.myshopify.com")).toMatchObject({ monitorStatus: "queued", monitorEndedAt: null });
  });
  it("keeps unreadable history unknown and preserves independently available evidence", async () => {
    mocks.runs.mockRejectedValue(new Error("private backend detail"));
    mocks.source.mockRejectedValue(new Error("private source error"));
    expect(await monitoringEvidence("a.myshopify.com")).toEqual({ initialStatus: "completed", importedProducts: 1200, monitorStatus: null, monitorEndedAt: null, sourceStatus: null, sourceEndedAt: null });
  });
  it("rejects invalid counts, statuses and dates without breaking the report", async () => {
    mocks.merchant.mockResolvedValue(document({ initialScanStatus: "private_error", initialScanProductsImported: Infinity }));
    mocks.source.mockResolvedValue(document({ last_run_status: "SUCCESS", last_run_end: { toDate: () => { throw new Error("bad timestamp"); } } }));
    mocks.runs.mockResolvedValue({ docs: [{ data: () => ({ status: "processing", completedAt: "2026-11-01" }) }] });
    expect(await monitoringEvidence("a.myshopify.com")).toMatchObject({ initialStatus: null, importedProducts: null, monitorStatus: "scanning", monitorEndedAt: null, sourceEndedAt: null });
  });
});
