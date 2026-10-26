import { experienceCopy } from "./experience";
import bg from "./bg";
import cs from "./cs";
import da from "./da";
import de from "./de";
import el from "./el";
import en from "./en";
import es from "./es";
import et from "./et";
import fi from "./fi";
import fr from "./fr";
import ga from "./ga";
import hr from "./hr";
import hu from "./hu";
import it from "./it";
import lt from "./lt";
import lv from "./lv";
import mt from "./mt";
import nl from "./nl";
import pl from "./pl";
import pt from "./pt";
import ro from "./ro";
import sk from "./sk";
import sl from "./sl";
import sv from "./sv";

export { EU_LANGUAGES } from "./languages";

const resources = {
  en,
  sk,
} as const;

const coreLocales = {
  bg,
  cs,
  da,
  de,
  el,
  es,
  et,
  fi,
  fr,
  ga,
  hr,
  hu,
  it,
  lt,
  lv,
  mt,
  nl,
  pl,
  pt,
  ro,
  sl,
  sv,
} as const;

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

// Retain the existing translations while adapting legacy `_plural` keys to
// i18next's current Intl plural categories (including Slovak few/many).
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

const mergedResources = {
  ...resources,
  ...Object.fromEntries(
    Object.entries(coreLocales).map(([code, translation]) => [
      code,
      { translation: deepMerge(en.translation, translation) },
    ]),
  ),
};

export const localizedResources = Object.fromEntries(
  Object.entries(mergedResources).map(([code, resource]) => [
    code,
    {
      translation: normalizePlurals({
        ...resource.translation,
        experience: experienceCopy[code as keyof typeof experienceCopy],
      }),
    },
  ]),
);
