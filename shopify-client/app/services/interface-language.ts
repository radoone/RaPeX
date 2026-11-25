import { EU_LANGUAGES } from "../locales/languages";

export const LANGUAGE_STORAGE_KEY = "safety-gate-language";
export const LANGUAGE_COOKIE_NAME = "zerorecall_lang";
const supported = new Set<string>(EU_LANGUAGES.map(({ code }) => code));
export const normalizeInterfaceLanguage = (value?: string | null) => {
  const code = value?.trim().toLowerCase().split(/[-_]/)[0];
  return code && supported.has(code) ? code : undefined;
};

export function interfaceLanguageFromCookie(cookieHeader?: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === LANGUAGE_COOKIE_NAME) {
      try {
        return normalizeInterfaceLanguage(decodeURIComponent(rest.join("=")));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function selectInterfaceLanguage(saved?: string | null, adminLocale?: string, browserLanguages: readonly string[] = []) {
  return normalizeInterfaceLanguage(saved) || normalizeInterfaceLanguage(adminLocale) || browserLanguages.map(normalizeInterfaceLanguage).find(Boolean) || "en";
}

export function preferredInterfaceLanguage(shopifyLocale?: string) {
  let saved: string | null = null;
  try { saved = localStorage.getItem(LANGUAGE_STORAGE_KEY) || localStorage.getItem("i18nextLng"); } catch { /* Storage may be unavailable in an embedded browser. */ }
  const admin = (window as Window & { shopify?: { config?: { locale?: string } } }).shopify?.config?.locale;
  return selectInterfaceLanguage(saved, admin || shopifyLocale, navigator.languages?.length ? navigator.languages : [navigator.language]);
}
