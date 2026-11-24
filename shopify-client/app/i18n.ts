import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { englishResources, loadLocaleBundle } from "./locales/client-loader";

export { EU_LANGUAGES } from "./locales/languages";

const i18nInstance = i18n.use(initReactI18next);

i18nInstance.init({
  resources: englishResources,
  fallbackLng: "en",
  lng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;

let languageRequest = 0;
export async function changeMerchantLanguage(language: string) {
  const request = ++languageRequest;
  const code = language.toLowerCase().split(/[-_]/)[0];
  const catalog = await loadLocaleBundle(code);
  if (request !== languageRequest) return;
  if (catalog) i18n.addResourceBundle(code, "translation", catalog, true, true);
  await i18n.changeLanguage(code);
}
