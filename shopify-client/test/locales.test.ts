import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import { localizedResources } from "../app/locales";

describe("merchant workflow translations", () => {
  it("uses plural forms in English and Slovak instead of the singular legacy key", async () => {
    const i18n = createInstance();
    await i18n.init({ resources: localizedResources, lng: "en", fallbackLng: "en" });
    const key = "dashboard.admin.status.reviewNeeded.criticalTitle";
    expect(i18n.t(key, { count: 1 })).toBe("1 possible match with a serious-risk alert needs review");
    expect(i18n.t(key, { count: 2 })).toBe("2 possible matches with a serious-risk alert need review");
    await i18n.changeLanguage("sk");
    expect(i18n.t(key, { count: 2 })).not.toBe(i18n.t(key, { count: 1 }).replace("1", "2"));
  });
  it("resolves dashboard action and proof descriptions for all EU locales", async () => {
    const i18n = createInstance();
    await i18n.init({ resources: localizedResources, fallbackLng: "en" });
    for (const language of Object.keys(localizedResources)) {
      await i18n.changeLanguage(language);
      for (const key of ["actions.protectRemainingProducts", "dashboard.admin.checksCompletedDescription"]) {
        expect(i18n.exists(key)).toBe(true);
        expect(i18n.t(key, { count: 2 })).not.toBe(key);
      }
    }
  });
});
