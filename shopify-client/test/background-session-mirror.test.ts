import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ find: vi.fn(), readInitial: vi.fn(), readCurrent: vi.fn(), write: vi.fn() }));
vi.mock("../app/shopify.server", () => ({ sessionStorage: { findSessionsByShop: mocks.find } }));
vi.mock("../app/firestore-session-storage.server", () => ({ encryptSessionAccessToken: () => "encrypted-test-token" }));
vi.mock("../app/firestore.server", () => ({ firestore: {
  collection: (collection: string) => ({ doc: (id: string) => ({ path: `${collection}/${id}`, get: mocks.readInitial }) }),
  runTransaction: async (callback: any) => callback({ get: mocks.readCurrent, set: mocks.write }),
} }));
import { mirrorOfflineSessionForCatalogAudit } from "../app/services/catalog-audit-session.server";

const snapshot = (data?: Record<string, any>) => ({ exists: Boolean(data), get: (key: string) => data?.[key], data: () => data });
describe("background Shopify session mirroring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readInitial.mockResolvedValue(snapshot({ createdAt: "installation-1" }));
    mocks.readCurrent.mockResolvedValue(snapshot({ createdAt: "installation-1" }));
    mocks.find.mockResolvedValue([{ id: "offline_example.myshopify.com", isOnline: false, accessToken: "test-only", toObject: () => ({ shop: "example.myshopify.com", isOnline: false, accessToken: "test-only" }) }]);
  });
  it("copies only encrypted offline access into the private worker collection", async () => {
    await mirrorOfflineSessionForCatalogAudit("example.myshopify.com");
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ path: "shopify_sessions/offline_example.myshopify.com" }), expect.objectContaining({ accessToken: "encrypted-test-token", isOnline: false }));
  });
  it.each([undefined, { createdAt: "installation-1", installationRetiredAt: true }, { createdAt: "installation-2" }])("does not resurrect private access during removal or replacement: %j", async current => {
    mocks.readCurrent.mockResolvedValue(snapshot(current));
    await expect(mirrorOfflineSessionForCatalogAudit("example.myshopify.com")).rejects.toThrow("installation changed");
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
