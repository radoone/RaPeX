import { describe, expect, it, vi } from "vitest";
import type { Session } from "@shopify/shopify-api";
import { FirestoreSessionStorage } from "../app/firestore-session-storage.server";

vi.mock("@shopify/shopify-api", () => ({
  Session: class MockSession {
    constructor(private readonly data: Record<string, unknown>) { Object.assign(this, data); }
    toObject() { return this.data; }
  },
}));

class MemoryFirestore {
  private readonly collections = new Map<string, Map<string, Record<string, unknown>>>();

  collection(name: string) {
    const documents = this.collections.get(name) || new Map<string, Record<string, unknown>>();
    this.collections.set(name, documents);
    return {
      doc: (id: string) => ({
        set: async (data: Record<string, unknown>) => { documents.set(id, data); },
        get: async () => {
          const data = documents.get(id);
          return { exists: Boolean(data), data: () => data };
        },
        delete: async () => { documents.delete(id); },
      }),
      where: (field: string, _operator: string, value: unknown) => ({
        get: async () => ({
          docs: [...documents.entries()]
            .filter(([, data]) => data[field] === value)
            .map(([id, data]) => ({ id, data: () => data })),
        }),
      }),
    };
  }

  batch() {
    const deletes: Array<() => void> = [];
    return {
      delete: (ref: { delete: () => Promise<void> }) => {
        deletes.push(() => { void ref.delete(); });
      },
      commit: async () => { deletes.forEach((remove) => remove()); },
    };
  }
}

describe("FirestoreSessionStorage", () => {
  it("stores, reloads, finds, and deletes Shopify sessions", async () => {
    const storage = new FirestoreSessionStorage(new MemoryFirestore() as never);
    const expires = new Date("2026-10-01T12:00:00.000Z");
    const values = {
      id: "offline_example.myshopify.com",
      shop: "example.myshopify.com",
      state: "oauth-state",
      isOnline: false,
      scope: "read_products",
      accessToken: "token-value",
      expires,
    };
    const session = { ...values, toObject: () => values } as unknown as Session;

    await expect(storage.storeSession(session)).resolves.toBe(true);
    const loaded = await storage.loadSession(session.id);
    expect(loaded?.toObject()).toMatchObject({
      id: values.id,
      shop: values.shop,
      isOnline: false,
      accessToken: "token-value",
      expires,
    });
    expect((await storage.findSessionsByShop(session.shop))).toHaveLength(1);
    await expect(storage.deleteSessions([session.id])).resolves.toBe(true);
    await expect(storage.loadSession(session.id)).resolves.toBeUndefined();
  });
});
