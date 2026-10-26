import { describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
const { login } = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock("../app/shopify.server", () => ({ login }));
import { action, loader } from "../app/routes/auth.login/route";

describe("Shopify login navigation", () => {
  it.each(["loader", "action"] as const)(
    "preserves the successful OAuth redirect from the %s",
    async (kind) => {
      const redirect = new Response(null, {
        status: 302,
        headers: {
          Location: "https://admin.shopify.com/store/example/oauth/install",
        },
      });
      login.mockRejectedValueOnce(redirect);
      const args = { request: new Request("https://example.test/auth/login") };
      const run =
        kind === "loader"
          ? loader(args as LoaderFunctionArgs)
          : action(args as ActionFunctionArgs);
      await expect(run).rejects.toBe(redirect);
    },
  );
  it("keeps an actionable login error for an actual service failure", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    login.mockRejectedValueOnce(new Error("network unavailable"));
    try {
      const result = await action({
        request: new Request("https://example.test/auth/login"),
      } as ActionFunctionArgs);
      expect(result.errors.shop).toBeTruthy();
      expect(result.errors.shop).not.toContain("network unavailable");
    } finally {
      logged.mockRestore();
    }
  });
});
