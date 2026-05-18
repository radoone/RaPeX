import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { localizedResources } from "./locales";

export { EU_LANGUAGES } from "./locales";

const i18nInstance = i18n.use(initReactI18next);

// Only use language detector on the client
if (typeof window !== "undefined") {
  i18nInstance.use(LanguageDetector);
}

i18nInstance.init({
  resources: localizedResources,
  fallbackLng: "en",
  lng: typeof window === "undefined" ? "en" : undefined,
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
