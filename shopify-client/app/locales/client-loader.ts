import enTranslation from "./complete/en.json";
import { EU_LANGUAGES } from "./languages";
import { loadCompleteLocale } from "./complete-loader";

const supported = new Set<string>(EU_LANGUAGES.map(language => language.code));
const pendingBundles = new Map<string, Promise<Record<string, unknown> | null>>();

function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown>,
): T {
  const output: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = output[key];
    output[key] =
      existing &&
      typeof existing === "object" &&
      !Array.isArray(existing) &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
        ? deepMerge(
            existing as Record<string, unknown>,
            value as Record<string, unknown>,
          )
        : value;
  }
  return output as T;
}

export const englishResources = {
  en: {
    translation: enTranslation as Record<string, unknown>,
  },
};

export async function loadLocaleBundle(language: string): Promise<Record<string, unknown> | null> {
  const code = language.toLowerCase().split(/[-_]/)[0];
  if (code === "en" || !supported.has(code)) return null;
  if (!pendingBundles.has(code)) {
    const promise = (async () => {
      const [{ localizedResources }, completeCatalog] = await Promise.all([
        import("./index"),
        loadCompleteLocale(code),
      ]);
      const base = (localizedResources[code]?.translation || enTranslation) as Record<string, unknown>;
      return completeCatalog ? deepMerge(base, completeCatalog) : base;
    })().catch(error => {
      pendingBundles.delete(code);
      throw error;
    });
    pendingBundles.set(code, promise);
  }
  return pendingBundles.get(code)!;
}
