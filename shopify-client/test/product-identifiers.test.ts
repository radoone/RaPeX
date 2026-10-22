import { describe, expect, it } from "vitest";
import { compareProductIdentifiers } from "../app/services/product-identifiers";

describe("product identifier comparison", () => {
  it("does not claim equality for model prefixes or partial barcodes", () => {
    expect(compareProductIdentifiers("AB-12", "AB-123")).toBe("mismatch");
    expect(compareProductIdentifiers("12345", "0012345")).toBe("mismatch");
    expect(compareProductIdentifiers("Brand", "Other Brand")).toBe("mismatch");
  });
  it("allows case and surrounding whitespace differences but requires both identifiers", () => {
    expect(compareProductIdentifiers(" AB-12 ", "ab-12")).toBe("match");
    for (const missing of [null, undefined, "", "  ", {}, 123]) {
      expect(compareProductIdentifiers(missing, "AB-12")).toBe("unspecified");
    }
  });
});
