import { afterEach, describe, expect, it, vi } from "vitest";
import db from "../app/merchant-db.server";

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: class Timestamp {},
  FieldValue: class FieldValue {},
  FieldPath: { documentId: () => "__name__" },
}));

vi.mock("../app/firestore.server", () => {
  const failure = async () => { throw new Error("Could not load the default credentials"); };
  const collection = { get: failure, add: failure };
  return { firestore: { collection: () => ({ doc: () => ({ collection: () => collection }) }) } };
});

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("merchant data credential failures", () => {
  it("rejects production reads and writes so missing credentials cannot look like a clear queue or a saved alert", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(db.safetyAlert.findMany({ where: { shop: "example.myshopify.com" } })).rejects.toThrow("default credentials");
    await expect(db.safetyAlert.create({ data: {
      shop: "example.myshopify.com", productId: "1", productTitle: "Test",
      checkResult: "{}", status: "active", riskLevel: "high", warningsCount: 1,
    } })).rejects.toThrow("default credentials");
  });
  it("retains the explicitly logged local development fallback", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(db.safetyAlert.findMany({ where: { shop: "example.myshopify.com" } })).resolves.toEqual([]);
    expect(warning).toHaveBeenCalled();
  });
});
