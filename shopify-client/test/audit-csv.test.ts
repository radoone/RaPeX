import { describe, expect, it } from "vitest";
import { csvCell } from "../app/services/audit-csv";

describe("audit CSV", () => {
  it.each(["=HYPERLINK(\"https://example.com\")", "+1+1", "-1+1", "@SUM(1)", "  =1+1", "\tformula", "\rformula", "\nformula"])("keeps untrusted text inert: %j", (value) => {
    expect(csvCell(value)).toBe(`"'${value.replace(/"/g, '""')}"`);
  });
  it("preserves ordinary values, delimiters, quotes and numeric scores", () => {
    expect(csvCell('Product, "blue"')).toBe('"Product, ""blue"""');
    expect(csvCell(-1)).toBe('"-1"');
    expect(csvCell(null)).toBe('""');
  });
});
