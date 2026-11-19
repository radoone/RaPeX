import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptShopifyToken, encryptShopifyToken, ensureOfflineSession, isShopifyOfflineReauthError, loadOfflineAccessToken, ShopifyOfflineReauthError } from "../../firebase/functions/src/shopify-offline-session";

const shop = "example.myshopify.com", id = `offline_${shop}`;
class MemoryStore {
  data: Record<string, any> | undefined;
  tail = Promise.resolve();
  constructor(data?: Record<string, any>) { this.data = data; }
  collection() { return { doc: () => ({}) }; }
  async runTransaction(fn: any) {
    const previous = this.tail;
    let unlock!: () => void;
    this.tail = new Promise<void>(resolve => { unlock = resolve; });
    await previous;
    try { return await fn({
      get: async () => ({ exists: Boolean(this.data), data: () => this.data && { ...this.data }, get: (key: string) => this.data?.[key] }),
      update: (_ref: unknown, values: any) => { if (!this.data) throw new Error("missing"); this.data = { ...this.data, ...values }; },
    }); } finally { unlock(); }
  }
}
const session = (extra = {}) => ({ id, shop, isOnline: false, accessToken: "legacy-access", ...extra });
const response = () => Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, refresh_token_expires_in: 86400, scope: "read_products" });

describe("shared offline token rotation", () => {
  beforeEach(() => {
    vi.stubEnv("SHOPIFY_API_KEY", "test-client"); vi.stubEnv("SHOPIFY_API_SECRET", "test-secret");
    vi.stubGlobal("fetch", vi.fn(async () => response()));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it("migrates legacy tokens and encrypts both credentials", async () => {
    const db = new MemoryStore(session());
    expect(await loadOfflineAccessToken(db as never, shop)).toBe("new-access");
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({ expiring: 1, subject_token: "legacy-access", grant_type: "urn:ietf:params:oauth:grant-type:token-exchange" });
    expect(db.data?.accessToken).toMatch(/^enc:v1:/); expect(db.data?.refreshToken).toMatch(/^enc:v1:/);
    expect(decryptShopifyToken(db.data?.refreshToken)).toBe("new-refresh");
  });
  it("reuses a valid token without contacting Shopify", async () => {
    const db = new MemoryStore(session({ expires: new Date(Date.now() + 3600_000) }));
    expect(await loadOfflineAccessToken(db as never, shop)).toBe("legacy-access");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("refreshes an expiring token using the encrypted refresh credential", async () => {
    const db = new MemoryStore(session({ expires: new Date(0), refreshToken: encryptShopifyToken("old-refresh"), refreshTokenExpires: new Date(Date.now() + 86400_000) }));
    await loadOfflineAccessToken(db as never, shop);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toMatchObject({ grant_type: "refresh_token", refresh_token: "old-refresh" });
  });
  it("coordinates concurrent callers across processes through the session lease", async () => {
    const db = new MemoryStore(session());
    expect(await Promise.all([loadOfflineAccessToken(db as never, shop), loadOfflineAccessToken(db as never, shop)])).toEqual(["new-access", "new-access"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not resurrect a deleted session after an exchange", async () => {
    const db = new MemoryStore(session());
    vi.mocked(fetch).mockImplementationOnce(async () => { db.data = undefined; return response(); });
    await expect(ensureOfflineSession(db as never, id)).rejects.toThrow("session changed");
    expect(db.data).toBeUndefined();
  });
  it.each([{}, { access_token: "access", refresh_token: "refresh", expires_in: -1, refresh_token_expires_in: 86400 }])("rejects incomplete responses without replacing the saved token: %j", async result => {
    const db = new MemoryStore(session()); vi.mocked(fetch).mockResolvedValueOnce(Response.json(result));
    await expect(loadOfflineAccessToken(db as never, shop)).rejects.toThrow("incomplete");
    expect(db.data?.accessToken).toBe("legacy-access");
  });
  it("fails closed with ShopifyOfflineReauthError when refresh access expired", async () => {
    const db = new MemoryStore(session({ expires: new Date(0), refreshToken: "expired", refreshTokenExpires: new Date(0) }));
    const err = await loadOfflineAccessToken(db as never, shop).catch(e => e);
    expect(err).toBeInstanceOf(ShopifyOfflineReauthError);
    expect(isShopifyOfflineReauthError(err)).toBe(true);
    expect(err.message).toContain("reauthorization");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403])("throws ShopifyOfflineReauthError on permanent rotation HTTP %i", async status => {
    const db = new MemoryStore(session({ expires: new Date(0), refreshToken: encryptShopifyToken("old-refresh"), refreshTokenExpires: new Date(Date.now() + 86400_000) }));
    vi.mocked(fetch).mockResolvedValueOnce(new Response("unauthorized", { status }));
    const err = await loadOfflineAccessToken(db as never, shop).catch(e => e);
    expect(err).toBeInstanceOf(ShopifyOfflineReauthError);
    expect(isShopifyOfflineReauthError(err)).toBe(true);
    expect(err.message).toContain(`(${status})`);
  });
  it.each([429, 500, 503])("throws transient non-reauth Error on rotation HTTP %i", async status => {
    const db = new MemoryStore(session({ expires: new Date(0), refreshToken: encryptShopifyToken("old-refresh"), refreshTokenExpires: new Date(Date.now() + 86400_000) }));
    vi.mocked(fetch).mockResolvedValueOnce(new Response("retry", { status }));
    const err = await loadOfflineAccessToken(db as never, shop).catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ShopifyOfflineReauthError);
    expect(isShopifyOfflineReauthError(err)).toBe(false);
    expect(err.message).toContain(`(${status})`);
  });
  it("rejects arbitrary domains before network access", async () => {
    await expect(loadOfflineAccessToken(new MemoryStore() as never, "example.com")).rejects.toThrow("Invalid");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("leaves missing sessions absent", async () => {
    expect(await ensureOfflineSession(new MemoryStore() as never, id)).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
