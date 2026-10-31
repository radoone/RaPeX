import { beforeEach, describe, expect, it, vi } from "vitest";
import { reviewRecords } from "../app/services/review-records.server";
import { matchesReviewDate, selectedDecisionEvents } from "../app/services/review-records";

const { findMany, eventsByAlert, paths } = vi.hoisted(() => ({ findMany: vi.fn(), eventsByAlert: {} as Record<string, any[]>, paths: [] as string[][] }));
vi.mock("../app/merchant-db.server", () => ({ default: { safetyAlert: { findMany } } }));
vi.mock("../app/services/review-evidence.server", () => ({ withOfficialReferences: async (records: any[]) => records }));
vi.mock("../app/firestore.server", () => {
  const ref = (path: string[] = []): any => ({
    collection: (name: string) => ref([...path, name]),
    doc: (id: string) => ref([...path, id]),
    orderBy: () => ref(path),
    get: async () => {
      paths.push(path);
      const id = path[path.indexOf("alerts") + 1];
      return { docs: (eventsByAlert[id] || []).map((data, index) => ({ id: String(index), data: () => data })) };
    },
  });
  return { firestore: ref() };
});

describe("decision history uses event dates before preview limits", () => {
  const filters = { from: "2026-10-31", to: "2026-10-31", status: "", dateBasis: "decisions" as const, timeZone: "Europe/Bratislava" };
  const old = { id: "old", productId: "1", productTitle: "Older product", status: "active", createdAt: "2026-10-20T08:00:00Z", checkResult: "{}" };
  beforeEach(() => { vi.clearAllMocks(); paths.length = 0; for (const key of Object.keys(eventsByAlert)) delete eventsByAlert[key]; });
  it("finds today's decision on an older finding and excludes out-of-period events", async () => {
    findMany.mockResolvedValue([old]);
    eventsByAlert.old = [
      { action: "reactivate", reviewState: "needs_review", createdAt: "2026-10-31T10:00:00Z" },
      { action: "resolve", resolutionType: "other", reviewState: "resolved", createdAt: "2026-10-30T10:00:00Z" },
    ];
    const result = await reviewRecords("test.myshopify.com", filters, 100);
    expect(result.total).toBe(1);
    expect(result.records[0].decisions).toHaveLength(1);
    expect(result.records[0].decisions[0].action).toBe("reactivate");
    expect(result.summary).toEqual({ active: 1, documented: 0 });
    expect(paths[0]).toEqual(["merchants", "test.myshopify.com", "alerts", "old", "decision_events"]);
    expect((await reviewRecords("test.myshopify.com", { ...filters, dateBasis: "findings" })).total).toBe(0);
  });
  it("does not lose an older finding behind the first 100 newer findings", async () => {
    findMany.mockResolvedValue([...Array.from({ length: 101 }, (_, i) => ({ ...old, id: `new-${i}`, createdAt: "2026-10-30" })), old]);
    eventsByAlert.old = [{ action: "resolve", reviewState: "resolved", createdAt: "2026-10-31T09:00:00Z" }];
    const result = await reviewRecords("test.myshopify.com", filters, 1);
    expect(result.total).toBe(1);
    expect(result.records[0].id).toBe("old");
  });
  it("searches immutable event notes after the current finding has been reopened", () => {
    const record = { productTitle: "Toy", notes: null, decisions: [{ notes: "Supplier batch reference", createdAt: "2026-10-31T09:00:00Z" }] };
    expect(selectedDecisionEvents(record, { ...filters, query: "batch reference" })).toHaveLength(1);
    expect(selectedDecisionEvents(record, { ...filters, query: "missing" })).toHaveLength(0);
  });
  it("uses the displayed calendar time zone, including midnight boundaries", () => {
    expect(matchesReviewDate("2026-10-30T23:30:00Z", filters)).toBe(true);
    expect(matchesReviewDate("2026-10-31T23:30:00Z", filters)).toBe(false);
    expect(matchesReviewDate("2026-10-30T23:30:00Z", { ...filters, timeZone: "UTC" })).toBe(false);
  });
});
