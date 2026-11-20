import { describe, expect, it } from "vitest";
import { EU_LANGUAGES } from "../app/locales/languages";
import { reviewUxCopy } from "../app/locales/review-ux";

describe("localized review interactions", () => {
  it("provides every new review message in all 24 EU interface languages", () => {
    expect(Object.keys(reviewUxCopy).sort()).toEqual(EU_LANGUAGES.map(language => language.code).sort());
    for (const { code } of EU_LANGUAGES) {
      expect(Object.keys(reviewUxCopy[code]).sort()).toEqual(Object.keys(reviewUxCopy.en).sort());
      for (const [key, value] of Object.entries(reviewUxCopy[code])) {
        expect(value.trim(), `${code}.${key}`).not.toBe("");
        if (code !== "en") expect(value, `${code}.${key}`).not.toBe(reviewUxCopy.en[key as keyof typeof reviewUxCopy.en]);
      }
      expect(reviewUxCopy[code].imageDialog).toContain("{{title}}");
    }
  });
});
