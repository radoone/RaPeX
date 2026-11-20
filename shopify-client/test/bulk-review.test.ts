import { describe, expect, it } from "vitest";
import { prepareBulkReview } from "../app/services/bulk-review";

describe("shared review decisions", () => {
  it("excludes selections hidden by a filter and preserves the merchant's selection for retry", () => {
    const selected = ["visible", "hidden"];
    const result = prepareBulkReview([{ id: "visible" }], selected, "removed_from_sale", "  Checked stock and removed listing  ");
    expect(result).toEqual({ ids: ["visible"], action: "resolve", outcome: "removed_from_sale", notes: "Checked stock and removed listing" });
    expect(selected).toEqual(["visible", "hidden"]);
    expect(prepareBulkReview([{ id: "visible" }], selected, "removed_from_sale", "  Checked stock and removed listing  ")).toEqual(result);
  });
  it("distinguishes unconfirmed evidence from a confirmed different product without changing stored values", () => {
    const visible = [{ id: "1" }];
    expect(prepareBulkReview(visible, ["1"], "match_not_confirmed", "")?.action).toBe("resolve");
    expect(prepareBulkReview(visible, ["1"], "not_my_product", "")?.action).toBe("dismiss");
    expect(prepareBulkReview(visible, ["1"], "not_my_product", "")?.outcome).toBe("not_my_product");
  });
  it("does not submit unknown outcomes, empty selections or hidden-only selections", () => {
    expect(prepareBulkReview([{ id: "1" }], ["1"], "", "")).toBeNull();
    expect(prepareBulkReview([{ id: "1" }], [], "modified_product", "")).toBeNull();
    expect(prepareBulkReview([{ id: "1" }], ["2"], "modified_product", "")).toBeNull();
    expect(prepareBulkReview([{ id: "1" }], ["1"], "verified_safe", "")).toBeNull();
  });
});
