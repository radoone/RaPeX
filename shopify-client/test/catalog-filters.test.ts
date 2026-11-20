import { describe, expect, it } from "vitest";
import { matchesCatalogFilters } from "../app/services/catalog-filters";

describe("independent catalog check and finding filters", () => {
  it("includes a changed product in pending checks while retaining its open finding", () => {
    const finding = { status: "active", reviewState: "needs_review" };
    expect(matchesCatalogFilters("changed", finding, "pending", "active")).toBe(true);
    expect(matchesCatalogFilters("changed", finding, "current", "active")).toBe(false);
  });
  it("does not mistake a clean current result for an open finding", () => {
    expect(matchesCatalogFilters("current", undefined, "current", "all")).toBe(true);
    expect(matchesCatalogFilters("current", undefined, "current", "active")).toBe(false);
  });
  it("separates supplier waiting from decisions requiring review", () => {
    const waiting = { status: "active", reviewState: "waiting_for_supplier", resolutionType: "contacted_supplier" };
    expect(matchesCatalogFilters("current", waiting, "all", "active")).toBe(false);
    expect(matchesCatalogFilters("current", waiting, "all", "waiting")).toBe(true);
  });
  it("keeps historical closed findings independent of a later product edit", () => {
    for (const status of ["resolved", "dismissed"]) {
      expect(matchesCatalogFilters("changed", { status }, "pending", "closed")).toBe(true);
      expect(matchesCatalogFilters("changed", { status }, "pending", "active")).toBe(false);
    }
  });
  it("partitions every catalog product into current or pending regardless of findings", () => {
    const states = ["current", "current", "changed", "unchecked", undefined];
    const count = (filter: "current" | "pending") => states.filter(state => matchesCatalogFilters(state, undefined, filter, "all")).length;
    expect(count("current") + count("pending")).toBe(states.length);
  });
});
