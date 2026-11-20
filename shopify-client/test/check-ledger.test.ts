import { describe, expect, it } from "vitest";
import { ledgerFilters, ledgerRow } from "../app/services/check-ledger";
import { checkLedgerCopy } from "../app/locales/check-ledger";

const version = "2026-11-20T10:00:00Z";
const product = { name: "Toy", sourceUpdatedAt: version };
const merchant = { createdAt: "2026-11-01T00:00:00Z" };
const coverage = { installation: merchant.createdAt, sourceUpdatedAt: version, completedAt: "2026-11-20T11:00:00Z",
  coveredThrough: "2026-11-20T10:30:00Z", matcherPolicy: 7, resultJson: '{"isSafe":true,"warnings":[]}' };
const row = (p = product, c: any = coverage, check?: any, m = merchant) => ledgerRow("1", p, c, check, m);

describe("saved check ledger evidence", () => {
  it("includes durable negative results without a finding", () => {
    expect(row()).toMatchObject({ state: "current", result: "noMatch", evidence: "fullIndex", checkedVersion: "2026-11-20T10:00:00.000Z", matcherPolicy: "7" });
  });
  it("does not imply a changed product was checked", () => {
    expect(row({ ...product, sourceUpdatedAt: "2026-11-20T12:00:00Z" })).toMatchObject({ state: "changed", result: "noMatch" });
  });
  it("compares equivalent timezone representations as the same version", () => {
    expect(row({ ...product, sourceUpdatedAt: "2026-11-20T11:00:00+01:00" }).state).toBe("current");
  });
  it("rejects incomplete, invalid and prior-installation coverage", () => {
    for (const c of [{ ...coverage, installation: "previous" }, { ...coverage, resultJson: "{" },
      { ...coverage, completedAt: null }, { ...coverage, resultJson: '{"warnings":[]}' }, { ...coverage, coveredThrough: null }]) {
      expect(row(product, c)).toMatchObject({ state: "unchecked", evidence: "none", result: "unknown" });
    }
  });
  it("retains a real check with unknown version without fabricating coverage", () => {
    expect(row(product, null, { checkedAt: version, isSafe: true })).toMatchObject({ state: "unverified", evidence: "recordedCheck", coveredThrough: null });
  });
  it("prefers a current recorded check over stale full-index coverage", () => {
    expect(row(product, { ...coverage, sourceUpdatedAt: "2026-11-19T00:00:00Z" }, {
      checkedAt: "2026-11-20T12:00:00Z", sourceUpdatedAt: version, isSafe: false,
    })).toMatchObject({ state: "current", result: "possibleMatch", evidence: "recordedCheck", coveredThrough: null });
  });
  it("never treats imports or lastCheckedAt alone as a result", () => {
    expect(row({ ...product, lastCheckedAt: version } as any, null)).toMatchObject({ state: "unchecked", result: "unknown" });
  });
  it("rejects checks predating installation and retired-installation results", () => {
    expect(row(product, null, { checkedAt: "2026-10-01", isSafe: true, sourceUpdatedAt: version }).state).toBe("unchecked");
    expect(row(product, coverage, undefined, { ...merchant, installationRetiredAt: version } as any).state).toBe("unchecked");
  });
  it("marks deleted products explicitly", () => {
    expect(row({ ...product, deletedAt: version } as any).state).toBe("deleted");
  });
  it("validates page cursor and limits filter choices", () => {
    expect(ledgerFilters(new URL("https://app.test?shop=other&checkState=bogus"))).toEqual({ state: "", cursor: "" });
    expect(() => ledgerFilters(new URL("https://app.test?checkAfter=a%2Fb"))).toThrow();
  });
  it("provides all evidence labels and legal boundaries in all 24 locales", () => {
    expect(Object.keys(checkLedgerCopy)).toHaveLength(24);
    const keys = Object.keys(checkLedgerCopy.en).sort();
    for (const copy of Object.values(checkLedgerCopy)) {
      expect(Object.keys(copy).sort()).toEqual(keys);
      expect(Object.keys(copy.states)).toHaveLength(5);
      expect(copy.legal.length).toBeGreaterThan(70);
      expect(copy.pageScope).toContain("50");
    }
  });
});
