import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loadSession: vi.fn(), readInitial: vi.fn(), readCurrent: vi.fn(), write: vi.fn() }));
vi.mock("../app/shopify.server", () => ({ sessionStorage: { loadSession: mocks.loadSession } }));
vi.mock("../app/firestore.server", () => ({
  firestore: {
    collection: (collection: string) => ({ doc: (id: string) => ({ path: `${collection}/${id}`, get: mocks.readInitial }) }),
    runTransaction: async (callback: any) => callback({ get: mocks.readCurrent, set: mocks.write, update: mocks.write }),
  },
}));
import { mirrorOfflineSessionForCatalogAudit } from "../app/services/catalog-audit-session.server";

const snapshot = (data?: Record<string, any>) => ({ exists: Boolean(data), get: (key: string) => data?.[key], data: () => data });
describe("canonical Firestore offline session validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readInitial.mockResolvedValue(snapshot({ createdAt: "installation-1" }));
    mocks.readCurrent.mockResolvedValue(snapshot({ createdAt: "installation-1" }));
    mocks.loadSession.mockResolvedValue({ id: "offline_example.myshopify.com", isOnline: false, accessToken: "test-only" });
  });

  it("validates canonical offline access without overwriting rotated credentials", async () => {
    await expect(mirrorOfflineSessionForCatalogAudit("example.myshopify.com")).resolves.toBeUndefined();
    expect(mocks.loadSession).toHaveBeenCalledWith("offline_example.myshopify.com");
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each([undefined, { createdAt: "installation-1", installationRetiredAt: true }])(
    "rejects when initial installation is missing or retired: %j",
    async (initial) => {
      mocks.readInitial.mockResolvedValue(snapshot(initial));
      await expect(mirrorOfflineSessionForCatalogAudit("example.myshopify.com")).rejects.toThrow("missing or retired");
      expect(mocks.loadSession).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, { id: "offline_example.myshopify.com", isOnline: false }])(
    "rejects when offline session is missing or lacks an accessToken: %j",
    async (session) => {
      mocks.loadSession.mockResolvedValue(session);
      await expect(mirrorOfflineSessionForCatalogAudit("example.myshopify.com")).rejects.toThrow("not available");
    },
  );

  it.each([undefined, { createdAt: "installation-1", installationRetiredAt: true }, { createdAt: "installation-2" }])(
    "fails if installation changes or retires during validation: %j",
    async (current) => {
      mocks.readCurrent.mockResolvedValue(snapshot(current));
      await expect(mirrorOfflineSessionForCatalogAudit("example.myshopify.com")).rejects.toThrow("installation changed");
      expect(mocks.write).not.toHaveBeenCalled();
    },
  );
});
