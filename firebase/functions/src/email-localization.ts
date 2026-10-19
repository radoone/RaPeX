import { EMAIL_LOCALES } from "./email-locales.js";

export const EMAIL_LANGUAGES = Object.keys(EMAIL_LOCALES);
const supported = new Set(EMAIL_LANGUAGES);

export function normalizeEmailLanguage(value: unknown): string {
  const language = typeof value === "string" ? value.trim().toLowerCase().split(/[-_]/)[0] : "en";
  return supported.has(language) ? language : "en";
}

export function emailText(language: string, key: string, values: Record<string, unknown> = {}): string {
  const template = EMAIL_LOCALES[normalizeEmailLanguage(language)]?.[key] ?? EMAIL_LOCALES.en[key];
  if (typeof template !== "string") throw new Error(`Missing email translation: ${key}`);
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ""));
}
