import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@shopify/shopify-api";
import { FirestoreSessionStorage, encryptSessionAccessToken, decryptSessionAccessToken } from "../app/firestore-session-storage.server";

vi.mock("@shopify/shopify-api", () => ({
  Session: class MockSession {
    constructor(private readonly data: Record<string, unknown>) { Object.assign(this, data); }
    toObject() { return this.data; }
  },
}));

class MemoryFirestore {
  readonly collections = new Map<string, Map<string, Record<string, unknown>>>();

  collection(name: string) {
    const documents = this.collections.get(name) || new Map<string, Record<string, unknown>>();
    this.collections.set(name, documents);
    return {
      doc: (id: string) => ({
        __col: documents,
        __id: id,
        set: async (data: Record<string, unknown>) => { documents.set(id, data); },
        update: async (values: Record<string, unknown>) => {
          const existing = documents.get(id);
          if (!existing) throw new Error("missing");
          documents.set(id, { ...existing, ...values });
        },
        get: async () => {
          const data = documents.get(id);
          return { exists: Boolean(data), data: () => data, get: (key: string) => data?.[key] };
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

  async runTransaction<T>(fn: (tx: {
    get: (ref: { get: () => Promise<any> }) => Promise<any>;
    update: (ref: { __col: Map<string, Record<string, unknown>>; __id: string }, values: Record<string, unknown>) => void;
  }) => Promise<T>): Promise<T> {
    return fn({
      get: (ref) => ref.get(),
      update: (ref, values) => {
        const existing = ref.__col.get(ref.__id);
        if (!existing) throw new Error("missing");
        ref.__col.set(ref.__id, { ...existing, ...values });
      },
    });
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
      refreshToken: "refresh-token-value",
      refreshTokenExpires: new Date("2026-12-01T12:00:00.000Z"),
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
      refreshToken: "refresh-token-value",
      refreshTokenExpires: new Date("2026-12-01T12:00:00.000Z"),
      expires,
    });
    expect((await storage.findSessionsByShop(session.shop))).toHaveLength(1);
    await expect(storage.deleteSessions([session.id])).resolves.toBe(true);
    await expect(storage.loadSession(session.id)).resolves.toBeUndefined();
  });

  it("encrypts Shopify accessToken at rest when an encryption secret is configured", async () => {
    const oldSecret = process.env.SHOPIFY_API_SECRET;
    process.env.SHOPIFY_API_SECRET = "test-session-encryption-secret-key";
    try {
      const encrypted = encryptSessionAccessToken("shpat_secret_12345");
      expect(typeof encrypted).toBe("string");
      expect(encrypted).not.toBe("shpat_secret_12345");
      expect(String(encrypted).startsWith("enc:v1:")).toBe(true);
      expect(decryptSessionAccessToken(encrypted)).toBe("shpat_secret_12345");
    } finally {
      if (oldSecret === undefined) delete process.env.SHOPIFY_API_SECRET;
      else process.env.SHOPIFY_API_SECRET = oldSecret;
    }
  });

  describe("rotating offline loadSession recovery", () => {
    beforeEach(() => {
      vi.stubEnv("SHOPIFY_API_KEY", "test-client");
      vi.stubEnv("SHOPIFY_API_SECRET", "test-secret");
      vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it("returns undefined on HTTP 401 so Shopify SDK can re-exchange an embedded token", async () => {
      const db = new MemoryFirestore();
      const storage = new FirestoreSessionStorage(db as never, true);
      await storage.storeSession({
        toObject: () => ({
          id: "offline_example.myshopify.com",
          shop: "example.myshopify.com",
          state: "",
          isOnline: false,
          scope: "read_products",
          accessToken: "stale-access",
          refreshToken: "stale-refresh",
          expires: new Date(0),
          refreshTokenExpires: new Date(Date.now() + 86400_000),
        }),
        id: "offline_example.myshopify.com",
      } as unknown as Session);

      vi.stubGlobal("fetch", vi.fn(async () => new Response("invalid_token", { status: 401 })));
      await expect(storage.loadSession("offline_example.myshopify.com")).resolves.toBeUndefined();
    });

    it("returns undefined when the refresh token itself has expired", async () => {
      const db = new MemoryFirestore();
      const storage = new FirestoreSessionStorage(db as never, true);
      await storage.storeSession({
        toObject: () => ({
          id: "offline_example.myshopify.com",
          shop: "example.myshopify.com",
          state: "",
          isOnline: false,
          scope: "read_products",
          accessToken: "stale-access",
          refreshToken: "expired-refresh",
          expires: new Date(0),
          refreshTokenExpires: new Date(0),
        }),
        id: "offline_example.myshopify.com",
      } as unknown as Session);

      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await expect(storage.loadSession("offline_example.myshopify.com")).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("still throws on transient HTTP 500 failures without dropping the session", async () => {
      const db = new MemoryFirestore();
      const storage = new FirestoreSessionStorage(db as never, true);
      await storage.storeSession({
        toObject: () => ({
          id: "offline_example.myshopify.com",
          shop: "example.myshopify.com",
          state: "",
          isOnline: false,
          scope: "read_products",
          accessToken: "valid-access",
          refreshToken: "valid-refresh",
          expires: new Date(0),
          refreshTokenExpires: new Date(Date.now() + 86400_000),
        }),
        id: "offline_example.myshopify.com",
      } as unknown as Session);

      vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream error", { status: 500 })));
      await expect(storage.loadSession("offline_example.myshopify.com")).rejects.toThrow("failed (500)");
    });
  });
});
