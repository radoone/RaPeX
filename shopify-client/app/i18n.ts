import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { localizedResources } from "./locales";

export { EU_LANGUAGES } from "./locales";

const i18nInstance = i18n.use(initReactI18next);

i18nInstance.init({
  resources: localizedResources,
  fallbackLng: "en",
  lng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
