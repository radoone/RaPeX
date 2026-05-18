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

function deepMerge<T extends Record<string, unknown>>(base: T, override: Record<string, unknown>): T {
  const output: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = output[key];
    output[key] =
      existing && typeof existing === "object" && !Array.isArray(existing) && value && typeof value === "object" && !Array.isArray(value)
        ? deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return output as T;
}

export const localizedResources = {
  ...resources,
  ...Object.fromEntries(
    Object.entries(coreLocales).map(([code, translation]) => [
      code,
      { translation: deepMerge(en.translation, translation) },
    ]),
  ),
};
