import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import { localizedResources } from "../app/locales";
import { workspaceCopy } from "../app/locales/workspace";

describe("merchant workflow translations", () => {
  it("has explicit UX copy in all 24 languages with the same interpolation tokens", () => {
    const keys = [
      "matchNeedsVerification",
      "matchingIdentifiers",
      "differentIdentifiers",
      "chooseOutcomeLink",
      "chooseOutcomeHelp",
      "detectedAt",
      "decisionAt",
      "reopened",
      "findingCount",
      "reviewNext",
      "viewRemainingProducts",
      "catalogScopeHelp",
      "productStatus",
      "productStatusAll",
      "productStatusActive",
      "productStatusDraft",
      "productStatusArchived",
      "productStatusUnknown",
      "monitoringUnknownHelp",
      "monitoring.unknown",
      "coverageScope",
      "priority",
      "priorityHelp",
      "groupInformation",
      "groupDifferent",
      "groupAction",
      "runScope",
      "sourceRisk",
      "reviewPrompt",
      "whyMatch",
      "matchNotConfirmed",
      "notRecorded",
      ...["removedFromSale", "modifiedProduct", "contactedSupplier", "falsePositive", "notMyProduct", "other", "verifiedSafe"].map(key => `outcomeLabels.${key}`),
      ...[
        "removed_from_sale",
        "modified_product",
        "contacted_supplier",
        "match_not_confirmed",
        "false_positive",
        "not_my_product",
        "other",
        "verified_safe",
      ].map((key) => `outcomeHelp.${key}`),
    ];
    const at = (copy: any, key: string): string =>
      key.split(".").reduce((value, part) => value?.[part], copy);
    const tokens = (value: string) => (value.match(/{{\w+}}/g) || []).sort();
    expect(Object.keys(workspaceCopy)).toHaveLength(24);
    for (const [language, copy] of Object.entries(workspaceCopy)) {
      for (const key of keys) {
        const value = at(copy, key);
        expect(value, `${language}:${key}`).toBeTruthy();
        expect(tokens(value), `${language}:${key}`).toEqual(
          tokens(at(workspaceCopy.en, key)),
        );
        if (language !== "en")
          expect(value, `${language}:${key}`).not.toBe(
            at(workspaceCopy.en, key),
          );
      }
    }
  });
  it("uses plural forms in English and Slovak instead of the singular legacy key", async () => {
    const i18n = createInstance();
    await i18n.init({
      resources: localizedResources,
      lng: "en",
      fallbackLng: "en",
    });
    const key = "dashboard.admin.status.reviewNeeded.criticalTitle";
    expect(i18n.t(key, { count: 1 })).toBe(
      "1 possible match with a serious-risk alert needs review",
    );
    expect(i18n.t(key, { count: 2 })).toBe(
      "2 possible matches with a serious-risk alert need review",
    );
    await i18n.changeLanguage("sk");
    expect(i18n.t(key, { count: 2 })).not.toBe(
      i18n.t(key, { count: 1 }).replace("1", "2"),
    );
  });
  it("resolves dashboard action and proof descriptions for all EU locales", async () => {
    const i18n = createInstance();
    await i18n.init({ resources: localizedResources, fallbackLng: "en" });
    for (const language of Object.keys(localizedResources)) {
      await i18n.changeLanguage(language);
      for (const key of [
        "actions.protectRemainingProducts",
        "dashboard.admin.checksCompletedDescription",
      ]) {
        expect(i18n.exists(key)).toBe(true);
        expect(i18n.t(key, { count: 2 })).not.toBe(key);
      }
    }
  });
});
