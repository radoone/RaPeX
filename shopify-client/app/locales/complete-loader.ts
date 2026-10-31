import { EU_LANGUAGES } from "./languages";

// One language per chunk; the complete EU catalogs do not inflate the initial app bundle.
const catalogs = import.meta.glob<Record<string, unknown>>(["./complete/*.json", "!./complete/manifest.json"], { import: "default" });
const supported = new Set<string>(EU_LANGUAGES.map(language => language.code));
const pending = new Map<string, Promise<Record<string, unknown>>>();

export async function loadCompleteLocale(language: string) {
  const code = language.toLowerCase().split(/[-_]/)[0];
  if (code === "en" || !supported.has(code)) return null;
  const loader = catalogs[`./complete/${code}.json`];
  if (!loader) throw new Error(`Missing merchant locale: ${code}`);
  if (!pending.has(code)) pending.set(code, loader().catch(error => { pending.delete(code); throw error; }));
  return pending.get(code)!;
}
