import { ownerTestAccessCopy } from "./owner-test-access";
import { galleryCopy } from "./gallery";
import { experienceCopy } from "./experience";
import { barcodeMatchCopy } from "./barcode-match";
import { reviewUxCopy } from "./review-ux";
import { settingsUxCopy } from "./settings-ux";
import { checkLedgerCopy } from "./check-ledger";
import { catalogUxCopy } from "./catalog-ux";
import en from "./en";
import { EU_LANGUAGES } from "./languages";
import { loadCompleteLocale } from "./complete-loader";

const nonEnglishModules = import.meta.glob<{ default: Record<string, unknown> }>([
  "./bg.ts",
  "./cs.ts",
  "./da.ts",
  "./de.ts",
  "./el.ts",
  "./es.ts",
  "./et.ts",
  "./fi.ts",
  "./fr.ts",
  "./ga.ts",
  "./hr.ts",
  "./hu.ts",
  "./it.ts",
  "./lt.ts",
  "./lv.ts",
  "./mt.ts",
  "./nl.ts",
  "./pl.ts",
  "./pt.ts",
  "./ro.ts",
  "./sk.ts",
  "./sl.ts",
  "./sv.ts",
]);

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

function normalizePlurals(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] =
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? normalizePlurals(entry as Record<string, unknown>)
        : entry;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!key.endsWith("_plural") || typeof entry !== "string") continue;
    const base = key.slice(0, -"_plural".length);
    if (typeof value[base] === "string") output[`${base}_one`] ??= value[base];
    for (const category of ["few", "many", "other"])
      output[`${base}_${category}`] ??= entry;
  }
  return output;
}

function buildLocaleTranslation(code: string, baseTranslation: Record<string, unknown>) {
  return normalizePlurals({
    ...baseTranslation,
    barcodeMatch: barcodeMatchCopy[code],
    ownerTestAccess: ownerTestAccessCopy[code],
    gallery: galleryCopy[code as keyof typeof galleryCopy],
    experience: experienceCopy[code as keyof typeof experienceCopy],
    reviewUx: reviewUxCopy[code as keyof typeof reviewUxCopy],
    settingsUx: settingsUxCopy[code as keyof typeof settingsUxCopy],
    checkLedger: checkLedgerCopy[code as keyof typeof checkLedgerCopy],
    catalogUx: catalogUxCopy[code as keyof typeof catalogUxCopy],
  });
}

export const englishResources = {
  en: {
    translation: buildLocaleTranslation("en", en.translation as Record<string, unknown>),
  },
};

export async function loadLocaleBundle(language: string): Promise<Record<string, unknown> | null> {
  const code = language.toLowerCase().split(/[-_]/)[0];
  if (code === "en" || !supported.has(code)) return null;
  if (!pendingBundles.has(code)) {
    const promise = (async () => {
      const moduleLoader = nonEnglishModules[`./${code}.ts`];
      const [mod, completeCatalog] = await Promise.all([
        moduleLoader ? moduleLoader() : Promise.resolve(null),
        loadCompleteLocale(code),
      ]);
      const raw = mod?.default as { translation?: Record<string, unknown> } | Record<string, unknown> | undefined;
      const baseTranslation = raw && "translation" in raw && raw.translation
        ? (raw.translation as Record<string, unknown>)
        : deepMerge(en.translation as Record<string, unknown>, (raw as Record<string, unknown>) || {});
      const withShared = buildLocaleTranslation(code, baseTranslation);
      return completeCatalog ? deepMerge(withShared, completeCatalog) : withShared;
    })().catch(error => {
      pendingBundles.delete(code);
      throw error;
    });
    pendingBundles.set(code, promise);
  }
  return pendingBundles.get(code)!;
}
