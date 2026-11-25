import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createServerI18n } from "../app/i18n";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("SSR i18n and hydration consistency", () => {
  it("initializes an isolated server i18n instance for Slovak with complete translations", async () => {
    const serverI18n = await createServerI18n("sk");
    expect(serverI18n.resolvedLanguage).toBe("sk");
    expect(serverI18n.t("redesign.overview")).toBe("Prehľad");
    expect(serverI18n.t("dashboard.admin.status.noActionNeeded.title")).toBe("Akcia nie je potrebná");
  });

  it("keeps concurrent server i18n instances isolated per request without language leakage", async () => {
    const [sk, de, en] = await Promise.all([
      createServerI18n("sk"),
      createServerI18n("de"),
      createServerI18n("en"),
    ]);
    expect(sk.resolvedLanguage).toBe("sk");
    expect(de.resolvedLanguage).toBe("de");
    expect(en.resolvedLanguage).toBe("en");
    expect(sk.t("redesign.overview")).toBe("Prehľad");
    expect(de.t("redesign.overview")).toBe("Übersicht");
    expect(en.t("redesign.overview")).toBe("Overview");
  });

  it("wires I18nextProvider in entry.server and preloads initial lang before hydrateRoot in entry.client", () => {
    const entryServer = readFileSync(path.join(ROOT, "app/entry.server.tsx"), "utf8");
    expect(entryServer).toContain("I18nextProvider");
    expect(entryServer).toContain("createServerI18n");
    expect(entryServer).toContain("<I18nextProvider i18n={serverI18n}>");

    const entryClient = readFileSync(path.join(ROOT, "app/entry.client.tsx"), "utf8");
    expect(entryClient).toContain("document.documentElement.lang");
    expect(entryClient).toContain("await changeMerchantLanguage(initialLang)");
    expect(entryClient).toContain("hydrateRoot");
  });

  it("guards SSR date formatting on Overview and Audit Report routes", () => {
    const indexSrc = readFileSync(path.join(ROOT, "app/routes/app._index.tsx"), "utf8");
    expect(indexSrc).toContain("<LocalDateTime");
    expect(indexSrc).toContain("value={lastCatalogCheckAt}");

    const reportSrc = readFileSync(path.join(ROOT, "app/routes/app.audit-report.tsx"), "utf8");
    expect(reportSrc).toContain("useHydrated()");
  });
});
