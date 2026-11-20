import { normalizeInterfaceLanguage } from "./interface-language";

type NotificationLanguageSettings = {
  notificationLanguage?: unknown;
  notificationLanguageSource?: unknown;
  notificationEmailSource?: unknown;
};

export function notificationLanguageSelection(settings: NotificationLanguageSettings): string {
  if (settings.notificationLanguageSource === "app") return "app";
  const language = typeof settings.notificationLanguage === "string"
    ? normalizeInterfaceLanguage(settings.notificationLanguage)
    : undefined;
  if (language && (settings.notificationLanguageSource === "custom" ||
      language !== "en" || settings.notificationEmailSource === "custom")) {
    return language;
  }
  return "app";
}
