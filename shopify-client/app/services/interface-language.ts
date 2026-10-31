import { EU_LANGUAGES } from "../locales/languages";

export const LANGUAGE_STORAGE_KEY = "safety-gate-language";
const supported = new Set<string>(EU_LANGUAGES.map(({ code }) => code));
const normalize = (value?: string | null) => {
  const code = value?.trim().toLowerCase().split(/[-_]/)[0];
  return code && supported.has(code) ? code : undefined;
};

export function selectInterfaceLanguage(saved?: string | null, adminLocale?: string, browserLanguages: readonly string[] = []) {
  return normalize(saved) || normalize(adminLocale) || browserLanguages.map(normalize).find(Boolean) || "en";
}

export function preferredInterfaceLanguage() {
  let saved: string | null = null;
  try { saved = localStorage.getItem(LANGUAGE_STORAGE_KEY) || localStorage.getItem("i18nextLng"); } catch { /* Storage may be unavailable in an embedded browser. */ }
  const admin = (window as Window & { shopify?: { config?: { locale?: string } } }).shopify?.config?.locale;
  return selectInterfaceLanguage(saved, admin, navigator.languages?.length ? navigator.languages : [navigator.language]);
}
