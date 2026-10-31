import { beforeEach, describe, expect, it, vi } from "vitest";
const { upsert, authenticateAdmin } = vi.hoisted(() => ({
  upsert: vi.fn(),
  authenticateAdmin: vi.fn(),
}));
vi.mock("../app/merchant-db.server", () => ({
  default: { safetySetting: { upsert } },
}));
vi.mock("../app/shopify.server", () => ({
  authenticate: { admin: authenticateAdmin },
}));
vi.mock("../app/services/billing.server", () => ({
  getBillingStatus: vi.fn(),
}));
vi.mock("../app/firestore.server", () => ({ firestore: {} }));
vi.mock("../app/services/monitoring-runs.server", () => ({ getRecentMonitoringRuns: vi.fn() }));
import { action } from "../app/routes/app.settings";
function request(email: string) {
  return new Request("https://example.com/app/settings", {
    method: "POST",
    body: new URLSearchParams({
      notificationEmail: email,
      immediateAlertEmails: "true",
      weeklySummaryEmails: "true",
      notificationLanguage: "sk",
      similarityThreshold: "70",
      autoDraftHighRisk: "false",
      excludeVendors: "Example",
      excludeTypes: "Gift Card",
    }),
  });
}
describe("settings form validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateAdmin.mockResolvedValue({
      session: { shop: "example.myshopify.com" },
    });
  });
  it("does not save any preferences for an invalid notification email", async () => {
    const result: any = await action({ request: request("invalid") } as never);
    expect(result.init.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
  it("saves the authenticated shop preferences and returns a visible saved state", async () => {
    const result = await action({
      request: request("owner@example.com"),
    } as never);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shop: "example.myshopify.com" },
        update: expect.objectContaining({
          similarityThreshold: 70,
          immediateAlertEmails: true,
          weeklySummaryEmails: true,
          notificationLanguage: "sk",
          excludeVendors: "Example",
        }),
      }),
    );
    expect((result as Response).headers.get("Location")).toBe(
      "/app/settings?saved=1",
    );
  });
});
