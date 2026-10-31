import { describe, expect, it } from "vitest";
import { compareReviewPriority } from "../app/services/review-priority";

describe("global review priority before pagination", () => {
  const alert = (
    id: string,
    riskLevel: string,
    createdAt = "2026-10-01",
    extra = {},
  ) => ({ id, riskLevel, createdAt, status: "active", ...extra });
  it("orders required decisions by official severity then age, with supplier waiting afterwards", () => {
    const records = [
      alert("waiting", "Serious", "2020-01-01", {
        reviewState: "waiting_for_supplier",
      }),
      alert("low", "Low", "2020-01-01"),
      alert("new", "Serious", "2026-10-20"),
      alert("old", "High", "2026-10-01"),
      alert("resolved", "High", "2020-01-01", { status: "resolved" }),
      alert("official", "Low", "2026-09-01", {
        checkResult: JSON.stringify({
          warnings: [{ alertDetails: { fields: { level: "Serious" } } }],
        }),
      }),
    ];
    expect(records.sort(compareReviewPriority).map((r) => r.id)).toEqual([
      "official",
      "old",
      "new",
      "low",
      "waiting",
      "resolved",
    ]);
  });
  it("keeps priority global across more than one page and handles malformed legacy evidence", () => {
    const records = Array.from({ length: 30 }, (_, i) =>
      alert(`low-${i}`, "Low"),
    );
    records.push(
      alert("urgent", "Serious", "invalid", { checkResult: "broken" }),
    );
    expect(records.sort(compareReviewPriority).slice(0, 25)[0].id).toBe(
      "urgent",
    );
    expect(
      [alert("b", "unknown", "invalid"), alert("a", "unknown", "invalid")]
        .sort(compareReviewPriority)
        .map((r) => r.id),
    ).toEqual(["a", "b"]);
  });
});
