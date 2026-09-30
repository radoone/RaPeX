import { describe, expect, it } from "vitest";
import { checkCoversCurrentProductVersion } from "../app/services/catalog-coverage.server";

describe("catalog check coverage", () => {
  const currentVersion = "2026-09-30T08:00:00.000Z";

  it("counts a result recorded for the current Shopify product version", () => {
    expect(checkCoversCurrentProductVersion({ sourceUpdatedAt: currentVersion }, currentVersion)).toBe(true);
  });

  it("does not count a saved result after the Shopify product has changed", () => {
    expect(checkCoversCurrentProductVersion(
      { sourceUpdatedAt: "2026-09-29T08:00:00.000Z" },
      currentVersion,
    )).toBe(false);
  });

  it("uses check time conservatively for legacy records without a product version", () => {
    expect(checkCoversCurrentProductVersion(
      { checkedAt: new Date("2026-09-30T08:00:01.000Z") },
      currentVersion,
    )).toBe(true);
    expect(checkCoversCurrentProductVersion(
      { checkedAt: new Date("2026-09-29T08:00:01.000Z") },
      currentVersion,
    )).toBe(false);
  });

  it("does not claim coverage when Shopify has no version timestamp", () => {
    expect(checkCoversCurrentProductVersion({ sourceUpdatedAt: currentVersion }, null)).toBe(false);
  });
});
