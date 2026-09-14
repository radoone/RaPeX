import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import sk from "./locales/sk.json";

const resources = {
  en: { translation: en },
  sk: { translation: sk },
};

const supportedLanguages = Object.keys(resources);

function setQueryLanguage(language) {
  const url = new URL(window.location.href);
  url.searchParams.set("lang", language);
  window.history.replaceState({}, "", url);
}

function syncDocument(language) {
  document.documentElement.lang = language;

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    const value = i18next.t(key);

    if (typeof value !== "string") {
      return;
    }

    const attribute = element.dataset.i18nAttr;
    if (attribute) {
      element.setAttribute(attribute, value);
      if (element.tagName === "TITLE") {
        document.title = value;
      }
      return;
    }

    element.textContent = value;
  });

  document.querySelectorAll("[data-locale]").forEach((button) => {
    const isActive = button.dataset.locale === language;
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function initFormHandler() {
  const form = document.getElementById("scan-form");
  const successBox = document.getElementById("scan-success");
  const submitBtn = form?.querySelector("button[type='submit']");

  if (!form || !successBox) {
    return;
  }

  form.addEventListener("submit", (e) => {
    const domainInput = document.getElementById("scan-domain");
    const emailInput = document.getElementById("scan-email");

    const domain = domainInput?.value?.trim();
    const email = emailInput?.value?.trim();

    if (!domain || !email) {
      return;
    }

    // If it's not directly submitting to an active backend endpoint, display instant success feedback
    e.preventDefault();
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.opacity = "0.7";
    }

    successBox.style.display = "flex";
    successBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

async function initI18n() {
  await i18next.use(LanguageDetector).init({
    resources,
    fallbackLng: "en",
    supportedLngs: supportedLanguages,
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["querystring", "localStorage", "navigator"],
      lookupQuerystring: "lang",
      lookupLocalStorage: "marketing-site-locale",
      caches: ["localStorage"],
    },
  });

  const activeLanguage = i18next.resolvedLanguage || i18next.language || "en";
  syncDocument(activeLanguage);
  setQueryLanguage(activeLanguage);
  initFormHandler();

  document.querySelectorAll("[data-locale]").forEach((button) => {
    button.addEventListener("click", async () => {
      const language = button.dataset.locale;

      if (!supportedLanguages.includes(language)) {
        return;
      }

      await i18next.changeLanguage(language);
    });
  });

  i18next.on("languageChanged", (language) => {
    const resolvedLanguage = supportedLanguages.includes(language)
      ? language
      : i18next.resolvedLanguage || "en";

    syncDocument(resolvedLanguage);
    setQueryLanguage(resolvedLanguage);
  });
}

initI18n().catch((error) => {
  console.error("Failed to initialize marketing site translations", error);
  syncDocument("en");
  setQueryLanguage("en");
  initFormHandler();
});
