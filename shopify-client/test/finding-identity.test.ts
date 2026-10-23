import { beforeEach, describe, expect, it, vi } from "vitest";
import { database, Timestamp, FieldValue } from "../../firebase/functions/test/helpers/isolated-source.mjs";

const state = vi.hoisted(() => ({ firestore: null as any }));
vi.mock("../app/firestore.server", () => ({
  firestore: new Proxy({}, { get: (_target, key) => state.firestore[key] }),
}));
vi.mock("firebase-admin/firestore", async () => {
  const fixtures = await import("../../firebase/functions/test/helpers/isolated-source.mjs");
  class FirestoreFieldValue {}
  Object.assign(FirestoreFieldValue, fixtures.FieldValue);
  return { Timestamp: fixtures.Timestamp, FieldValue: FirestoreFieldValue, FieldPath: { documentId: () => "__name__" } };
});
const { default: db } = await import("../app/merchant-db.server");
const shop = "example.myshopify.com";
const input = { shop, productId: "1", productTitle: "Example", sourceUpdatedAt: "2026-10-23T10:00:00Z", checkResult: JSON.stringify({ warnings: [{ alertId: "A", overallSimilarity: 90 }], checkedAt: "2026-10-23T10:00:00Z" }) };

beforeEach(() => {
  state.firestore = database();
  state.firestore.rows.set(`merchants/${shop}`, { shop, createdAt: Timestamp.now() });
  state.firestore.rows.set(`merchants/${shop}/products/1`, { productId: "1", sourceUpdatedAt: input.sourceUpdatedAt, vector_text: FieldValue.vector([1]) });
});

describe("manual/background finding identity", () => {
  it("uses the same stable identity, deduplicates concurrent checks and preserves merchant decisions", async () => {
    const [first, repeated] = await Promise.all([db.safetyAlert.recordMatches(input), db.safetyAlert.recordMatches(input)]);
    expect(first[0].id).toBe(repeated[0].id);
    expect([first[0].created, repeated[0].created].filter(Boolean)).toHaveLength(1);
    const record = state.firestore.rows.get(`merchants/${shop}/alerts/${first[0].id}`);
    record.status = "dismissed"; record.notes = "Supplier evidence";
    const checkedAgain = await db.safetyAlert.recordMatches(input);
    expect(checkedAgain[0].status).toBe("dismissed");
    expect(checkedAgain[0].notes).toBe("Supplier evidence");
    const newSource = await db.safetyAlert.recordMatches({ ...input, checkResult: JSON.stringify({ warnings: [{ alertId: "B" }] }) });
    expect(newSource[0].created).toBe(true);
    expect(newSource[0].id).not.toBe(first[0].id);
  });
  it("rejects stale checks after product deletion or a newer product version", async () => {
    state.firestore.rows.get(`merchants/${shop}/products/1`).deletedAt = Timestamp.now();
    await expect(db.safetyAlert.recordMatches(input)).rejects.toThrow("Product changed");
    state.firestore.rows.delete(`merchants/${shop}`);
    await expect(db.safetyAlert.recordMatches(input)).rejects.toThrow("Product changed");
  });
});
