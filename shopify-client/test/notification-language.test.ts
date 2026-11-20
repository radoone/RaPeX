import { describe, expect, it } from "vitest";
import { notificationLanguageSelection } from "../app/services/notification-language";
import { selectInterfaceLanguage } from "../app/services/interface-language";

describe("app and notification language preferences", () => {
  it("prefers Shopify language on first use and preserves an explicit app choice", () => {
    expect(selectInterfaceLanguage(null, "sk-SK", ["en-US"])).toBe("sk");
    expect(selectInterfaceLanguage("de", "sk-SK", ["en-US"])).toBe("de");
  });

  it("follows the app for unset and unmodified legacy defaults", () => {
    expect(notificationLanguageSelection({})).toBe("app");
    expect(notificationLanguageSelection({ notificationLanguage: "en", notificationEmailSource: "shopify" })).toBe("app");
    expect(notificationLanguageSelection({ notificationLanguage: "sk", notificationLanguageSource: "app" })).toBe("app");
  });

  it("preserves explicit and previously saved language preferences", () => {
    expect(notificationLanguageSelection({ notificationLanguage: "en", notificationLanguageSource: "custom" })).toBe("en");
    expect(notificationLanguageSelection({ notificationLanguage: "en", notificationEmailSource: "custom" })).toBe("en");
    expect(notificationLanguageSelection({ notificationLanguage: "sk" })).toBe("sk");
  });
});
