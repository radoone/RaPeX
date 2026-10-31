import { describe, expect, it } from "vitest";
import { selectInterfaceLanguage } from "../app/services/interface-language";

describe("interface language preference", () => {
  it("uses the Shopify user's Admin language ahead of browser languages", () => {
    expect(selectInterfaceLanguage(null, "de-DE", ["sk-SK"])).toBe("de");
  });
  it("keeps a manual choice ahead of Admin and browser settings", () => {
    expect(selectInterfaceLanguage("sk", "de-DE", ["en-US"])).toBe("sk");
  });
  it("finds the first supported browser preference and normalizes regional tags", () => {
    expect(selectInterfaceLanguage(null, "ja", ["ja-JP", "FR-ca", "de"])).toBe("fr");
    expect(selectInterfaceLanguage("invalid", undefined, ["pt_BR"])).toBe("pt");
  });
  it("falls back to English when no preference is supported", () => {
    expect(selectInterfaceLanguage(null, "ja", ["zh"])).toBe("en");
  });
});
