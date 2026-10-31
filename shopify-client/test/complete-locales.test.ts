import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import { localizedResources } from "../app/locales";
import { loadCompleteLocale } from "../app/locales/complete-loader";

function flatten(value: Record<string, any>, prefix = ""): Record<string, string> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof item === "string" ? [[path, item]] : Object.entries(flatten(item, path));
  }));
}
const tokens = (text: string) => (text.match(/{{[^}]+}}/g) || []).sort();

describe("complete merchant UI catalogs", () => {
  it("covers every source key, interpolation and required plural form in all 24 languages without English fallback", async () => {
    const source = flatten(localizedResources.en.translation);
    const i18n = createInstance();
    await i18n.init({ resources: structuredClone(localizedResources), fallbackLng: false });
    expect(Object.keys(source).length).toBeGreaterThan(1100);
    for (const language of Object.keys(localizedResources)) {
      const complete = await loadCompleteLocale(language);
      if (complete) i18n.addResourceBundle(language, "translation", complete, true, true);
      for (const [key, english] of Object.entries(source)) {
        const value = i18n.getResource(language, "translation", key);
        expect(typeof value, `${language}:${key}`).toBe("string");
        expect(value.trim(), `${language}:${key}`).not.toBe("");
        expect(tokens(value), `${language}:${key}`).toEqual(tokens(english));
        if (key.endsWith("_other")) {
          for (const category of new Intl.PluralRules(language).resolvedOptions().pluralCategories) {
            expect(typeof i18n.getResource(language, "translation", `${key.slice(0, -6)}_${category}`), `${language}:${key}:${category}`).toBe("string");
          }
        }
      }
      if (language !== "en") {
        for (const key of ["workspace.decisionFrom", "workspace.noFilteredDecisions", "workspace.reviewNext", "dashboard.admin.status.reviewNeeded.description"]) {
          expect(i18n.getResource(language, "translation", key), `${language}:${key}`).not.toBe(source[key]);
        }
      }
    }
  });
  it("records the exact current English source so copy changes cannot silently leave stale translations", async () => {
    const source = Object.fromEntries(Object.entries(flatten(localizedResources.en.translation)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    const manifest = JSON.parse(await readFile(new URL("../app/locales/complete/manifest.json", import.meta.url), "utf8"));
    expect(manifest.sourceSha256).toBe(createHash("sha256").update(JSON.stringify(source)).digest("hex"));
    expect(Object.keys(manifest.locales)).toHaveLength(23);
  });
});
