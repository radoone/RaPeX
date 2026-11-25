import { readFileSync } from "node:fs";
import path from "node:path";
import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import enCatalog from "../app/locales/complete/en.json";
import { POLARIS_URL } from "../app/polaris";
import { interfaceLanguageFromCookie } from "../app/services/interface-language";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("Built for Shopify & UX improvements", () => {
  it("loads Polaris 2 CDN script", () => {
    expect(POLARIS_URL).toBe("https://cdn.shopify.com/shopifycloud/polaris-2.js");
  });

  it("parses supported EU interface language from cookie and rejects invalid values", () => {
    expect(interfaceLanguageFromCookie("foo=bar; zerorecall_lang=sk; baz=1")).toBe("sk");
    expect(interfaceLanguageFromCookie("zerorecall_lang=de")).toBe("de");
    expect(interfaceLanguageFromCookie("zerorecall_lang=xx")).toBeUndefined();
    expect(interfaceLanguageFromCookie(null)).toBeUndefined();
  });

  it("uses info tone for safe state, localized title, and in-Admin navigation in BlockExtension", () => {
    const src = readFileSync(
      path.join(ROOT, "extensions/safety-gate-product-block/src/BlockExtension.jsx"),
      "utf8",
    );
    expect(src).toMatch(/status\.state\s*===\s*["']safe["']\s*\|\|\s*status\.state\s*===\s*["']unchecked["'][\s\S]*?\?\s*["']info["']/);
    expect(src).toContain('title={translate("name")}');
    expect(src).toContain("app:/alerts?open=");
    expect(src).toContain("target={status?.alertId ? undefined : \"_blank\"}");
  });

  it("uses in-Admin app:/ and shopify:admin/charges links in ActionExtension", () => {
    const src = readFileSync(
      path.join(ROOT, "extensions/safety-gate-product-action/src/ActionExtension.jsx"),
      "utf8",
    );
    expect(src).toContain("app:/alerts?open=");
    expect(src).toContain("target={alertId ? undefined : \"_blank\"}");
    expect(src).toContain("shopify:admin/charges/safety-gate-monitor-eu/pricing_plans");
    expect(src).toContain('href={pricingHref}>');
  });

  it("ships complete valid locale files for all 9 extension locales across both extensions", () => {
    const locales = ["en.default", "sk", "de", "fr", "es", "it", "nl", "pl", "cs"];
    for (const ext of ["safety-gate-product-block", "safety-gate-product-action"]) {
      const baseKeys = Object.keys(
        JSON.parse(readFileSync(path.join(ROOT, "extensions", ext, "locales/en.default.json"), "utf8")),
      ).sort();
      for (const locale of locales) {
        const parsed = JSON.parse(
          readFileSync(path.join(ROOT, "extensions", ext, "locales", `${locale}.json`), "utf8"),
        ) as Record<string, unknown>;
        expect(Object.keys(parsed).sort(), `${ext}/${locale}.json`).toEqual(baseKeys);
      }
    }
  });

  it("uses shopify:admin/products protocol links in AlertDetailModal", () => {
    const src = readFileSync(path.join(ROOT, "app/components/AlertDetailModal.tsx"), "utf8");
    expect(src).toContain("shopify:admin/products/");
    expect(src).not.toContain("/admin/products/");
  });

  it("pluralizes English singular vs plural UI strings cleanly", async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: "en",
      fallbackLng: false,
      resources: { en: { translation: enCatalog } },
    });
    expect(i18n.t("workspace.viewRemainingProducts", { count: 1 })).toBe("View 1 product needing a check");
    expect(i18n.t("workspace.viewRemainingProducts", { count: 3 })).toBe("View 3 products needing a check");
    expect(i18n.t("workspace.oldest", { count: 1 })).toBe("Open for 1 day");
    expect(i18n.t("workspace.oldest", { count: 5 })).toBe("Open for 5 days");
    expect(i18n.t("workspace.eventCount", { count: 1 })).toBe("1 decision event");
    expect(i18n.t("workspace.eventCount", { count: 2 })).toBe("2 decision events");
  });

  it("keeps shopify.app.toml and shopify.app.safety-gate-monitor-eu.toml identical with 5 declarative webhooks", () => {
    const mainToml = readFileSync(path.join(ROOT, "shopify.app.toml"), "utf8");
    const envToml = readFileSync(path.join(ROOT, "shopify.app.safety-gate-monitor-eu.toml"), "utf8");
    expect(mainToml).toBe(envToml);
    for (const topic of ["products/create", "products/update", "products/delete", "app/uninstalled", "app/scopes_update"]) {
      expect(mainToml).toContain(topic);
    }
  });

  it("places the Safety Gate disclaimer in a muted footer note instead of the green success banner on Overview", () => {
    const src = readFileSync(path.join(ROOT, "app/routes/app._index.tsx"), "utf8");
    expect(src).not.toContain("showScopeNote");
    expect(src).toContain('<p className="admin-helper">{t("catalogOverview.resultBoundary")}</p>');
  });

  it("shows active verified plan confirmation and run trigger for recently activated monitoring on Overview", () => {
    const src = readFileSync(path.join(ROOT, "app/routes/app._index.tsx"), "utf8");
    expect(src).toContain("displayShopifyPlan");
    expect(src).toContain('t("billing.planActiveDescription")');
    expect(src).toContain('automaticStatus === "starting"');
  });
});
