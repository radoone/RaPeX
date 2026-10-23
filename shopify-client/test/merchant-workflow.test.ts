import { describe, expect, it } from "vitest";
import { catalogCheckStates } from "../app/services/catalog-state";
import { monitoringState } from "../app/services/monitoring-state";
import {
  officialSource,
  parseEvidence,
  isWaitingForSupplier,
  decisionKey,
} from "../app/services/review-evidence";
import {
  reviewFilters,
  matchesReviewFilters,
} from "../app/services/review-records";
import { exclusionPreview } from "../app/services/exclusion-preview";
import { getAlertDecisionTransition } from "../app/services/alert-decision";
import { localizedResources } from "../app/locales";

describe("one current-version rule across the merchant catalog", () => {
  const version = "2026-10-23T08:00:00Z";
  it("partitions current, changed and never checked products without counting a stale success as current", () => {
    const products = ["1", "2", "3"].map((id) => ({
      id: `gid://shopify/Product/${id}`,
      updatedAt: version,
    }));
    const states = catalogCheckStates(products, [
      { productId: "1", sourceUpdatedAt: version, isSafe: false },
      { productId: "2", checkedAt: "2026-10-20T08:00:00Z", isSafe: true },
    ]);
    expect(
      Object.values(states).filter((item) => item.state !== "current"),
    ).toHaveLength(2);
    expect(states["2"].state).toBe("changed");
    expect(states["3"].state).toBe("unchecked");
    expect(states["1"].current?.isSafe).toBe(false);
  });
  it("normalizes Shopify IDs and excludes checks for deleted catalog products", () => {
    const states = catalogCheckStates(
      [{ id: "1", updatedAt: version }],
      [
        { productId: "gid://shopify/Product/1", sourceUpdatedAt: version },
        { productId: "deleted", sourceUpdatedAt: version },
      ],
    );
    expect(Object.keys(states)).toEqual(["1"]);
    expect(states["1"].state).toBe("current");
  });
});

describe("truthful monitoring status", () => {
  const billing = {
    developmentBypass: false,
    billingVerified: true,
    hasActivePayment: true,
  };
  it.each(["SUCCESS", "completed", "IN_PROGRESS", "FAILURE"])(
    "never announces active monitoring when billing is unverified, even after %s",
    (status) => {
      expect(
        monitoringState({ ...billing, billingVerified: false }, status),
      ).toBe("unverified");
    },
  );
  it("distinguishes development preview, expired access and queued work", () => {
    expect(
      monitoringState({ ...billing, developmentBypass: true }, "SUCCESS"),
    ).toBe("preview");
    expect(
      monitoringState(
        { ...billing, validUntil: "2026-10-20" },
        "SUCCESS",
        Date.parse("2026-10-23"),
      ),
    ).toBe("paused");
    expect(monitoringState(billing, "queued")).toBe("processing");
    expect(monitoringState(billing, "FAILURE")).toBe("failed");
    expect(monitoringState(billing, "SUCCESS")).toBe("enabled");
  });
});

describe("official source evidence", () => {
  it("does not turn internal IDs or untrusted URLs into an official reference", () => {
    expect(
      officialSource({
        alert_number: "abcdef12-1234-4567-abcd-123456789012",
        url: "https://ec.europa.eu.evil.example/alert",
        reference: "javascript:alert(1)",
      }),
    ).toEqual({ caseNumber: null, url: null });
  });
  it("uses actual case numbers and validated Commission URLs", () => {
    expect(
      officialSource({
        caseNumber: "SR/00665/26",
        url: "https://ec.europa.eu/safety-gate-alerts/screen/webReport/alertDetail/10098073",
      }).caseNumber,
    ).toBe("SR/00665/26");
    expect(officialSource({ url: "http://ec.europa.eu/alert" }).url).toBeNull();
    expect(parseEvidence("broken").caseNumber).toBeNull();
    expect(officialSource({ alert_number: "29e15f96041ca7c4614319be88a3c24c99873ea0" }).caseNumber).toBeNull();
  });
});

describe("decision history preserves meaning", () => {
  it("keeps supplier follow-up open and recognizes legacy pending records", () => {
    const transition = getAlertDecisionTransition({
      action: "resolve",
      resolutionType: "contacted_supplier",
      actorId: "test",
    });
    expect(transition.status).toBe("active");
    expect(isWaitingForSupplier(transition)).toBe(true);
    expect(
      isWaitingForSupplier({
        status: "active",
        resolutionType: "contacted_supplier",
      }),
    ).toBe(true);
    expect(
      isWaitingForSupplier({
        status: "resolved",
        resolutionType: "contacted_supplier",
      }),
    ).toBe(false);
  });
  it("distinguishes new match-not-confirmed outcomes from historical safety assertions", () => {
    expect(decisionKey("verified_safe")).toBe("resolveActions.verifiedSafe");
    expect(decisionKey("match_not_confirmed")).toBe(
      "workspace.matchNotConfirmed",
    );
    expect(
      getAlertDecisionTransition({
        action: "resolve",
        resolutionType: "match_not_confirmed",
        actorId: "test",
      }).resolutionType,
    ).toBe("match_not_confirmed");
    expect(decisionKey(null)).toBe("workspace.notRecorded");
  });
});

describe("report scope and exclusions", () => {
  it("rejects invalid dates and applies an inclusive end day to preview and export", () => {
    expect(
      reviewFilters(
        new URL("https://example.com/?from=2026-02-31&status=other"),
      ),
    ).toEqual({ from: "", to: "", status: "" });
    const filters = reviewFilters(
      new URL(
        "https://example.com/?from=2026-10-01&to=2026-10-23&status=active",
      ),
    );
    expect(
      matchesReviewFilters(
        { status: "active", createdAt: "2026-10-23T23:59:59Z" },
        filters,
      ),
    ).toBe(true);
    expect(
      matchesReviewFilters(
        { status: "resolved", createdAt: "2026-10-23T12:00:00Z" },
        filters,
      ),
    ).toBe(false);
    expect(
      matchesReviewFilters(
        { status: "active", createdAt: "2026-10-24T00:00:00Z" },
        filters,
      ),
    ).toBe(false);
  });
  it("counts each excluded product once and requires complete case-insensitive vendor/type equality", () => {
    const products = [
      { id: "1", vendor: " ACME ", productType: "Toys" },
      { id: "2", vendor: "Acme Europe", productType: "Other" },
    ];
    expect(
      exclusionPreview(products, "acme", "toys").map((item) => item.id),
    ).toEqual(["1"]);
  });
  it("keeps all 24 EU languages with translated primary workflow actions", () => {
    expect(Object.keys(localizedResources)).toHaveLength(24);
    for (const resource of Object.values(localizedResources)) {
      const workspace = resource.translation.workspace as Record<
        string,
        unknown
      >;
      expect(workspace.compare).toBeTruthy();
      expect(workspace.changed).toBeTruthy();
      expect(workspace.saveChanges).toBeTruthy();
    }
  });
});
