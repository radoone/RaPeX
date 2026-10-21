import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import languages from "../localization/languages.json";
import authorities from "../localization/authorities.json";
import en from "./locales/en.json";

const catalogs = import.meta.glob(["./locales/??.json", "!./locales/en.json"], { import: "default" });
const resources = { en: { translation: en } };
const translationBackend = {
  type: "backend",
  read(language, _namespace, callback) {
    if (language === "en") { callback(null, en); return; }
    const load = catalogs[`./locales/${language}.json`];
    if (!load) { callback(new Error("Unsupported language"), false); return; }
    load().then(data => callback(null, data)).catch(error => callback(error, false));
  },
};

const supportedLanguages = languages.map(language => language.code);

function setQueryLanguage(language) {
  const url = new URL(window.location.href);
  url.searchParams.set("lang", language);
  window.history.replaceState({}, "", url);
}

function syncDocument(language) {
  document.documentElement.lang = language;

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    const variables = element.dataset.i18nVariables
      ? JSON.parse(element.dataset.i18nVariables)
      : {};
    const authority = authorities[language];
    const value = i18next.t(key, authority ? { ...variables, country: authority.country, authority: authority.name } : variables);

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

    if (element.dataset.i18nHtml === "true") {
      element.innerHTML = value;
    } else {
      element.textContent = value;
    }
  });

  document.querySelectorAll("[data-locale]").forEach((button) => {
    const isActive = button.dataset.locale === language;
    button.setAttribute("aria-pressed", String(isActive));
  });
  document.querySelectorAll("[data-language-select]").forEach(select => { select.value = language; });
  document.querySelectorAll("[data-authority-link]").forEach(link => {
    link.href = authorities[language]?.url || "https://single-market-economy.ec.europa.eu/single-market/goods/building-blocks/market-surveillance/organisation_en";
  });
  document.querySelectorAll("a[href]").forEach(link => {
    const href = link.getAttribute("href");
    if (!href || href.startsWith("#")) return;
    const target = new URL(href, window.location.href);
    if (target.origin === window.location.origin && /\/(index|about|privacy)\.html$/.test(target.pathname)) {
      target.searchParams.set("lang", language);
      link.href = target.pathname + target.search + target.hash;
    }
  });
}

function initLanguageSelectors() {
  document.querySelectorAll(".lang-switch").forEach(container => {
    const select = document.createElement("select");
    select.className = "language-select";
    select.dataset.languageSelect = "true";
    select.dataset.i18n = "nav.language";
    select.dataset.i18nAttr = "aria-label";
    select.setAttribute("aria-label", "Language");
    for (const {code, label} of languages) {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = label;
      option.lang = code;
      select.append(option);
    }
    select.addEventListener("change", () => i18next.changeLanguage(select.value));
    container.replaceChildren(select);
  });
}

function initMenu() {
  const button = document.querySelector(".menu-toggle");
  const menu = document.getElementById("primary-nav");
  if (!button || !menu) return;

  button.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open));
    menu.dataset.open = String(open);
  });
  menu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      button.setAttribute("aria-expanded", "false");
      menu.dataset.open = "false";
    });
  });
}

function initFormHandler() {
  const form = document.getElementById("scan-form");
  const feedback = document.getElementById("scan-feedback");
  const submitBtn = form?.querySelector("button[type='submit']");
  const confirmation = document.getElementById("scan-confirmation");
  const confirmBtn = document.getElementById("scan-confirm-button");
  if (!form || !feedback || !submitBtn) return;
  const title = document.getElementById("scan-feedback-title");
  const body = document.getElementById("scan-feedback-body");
  if (!title || !body) return;
  let turnstileToken = "";
  let widgetId = null;
  let requestSubmitted = false;

  function showFeedback(state, titleKey, bodyKey, variables = {}) {
    feedback.hidden = false;
    feedback.dataset.state = state;
    title.dataset.i18n = titleKey;
    body.dataset.i18n = bodyKey;
    body.dataset.i18nVariables = JSON.stringify(variables);
    title.textContent = i18next.t(titleKey);
    body.textContent = i18next.t(bodyKey, variables);
  }

  function resetChallenge() {
    turnstileToken = "";
    if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
  }

  async function loadChallenge() {
    submitBtn.disabled = true;
    const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY || (import.meta.env.DEV ? "1x00000000000000000000AA" : "");
    if (!sitekey || (import.meta.env.PROD && sitekey === "1x00000000000000000000AA")) {
      submitBtn.disabled = true;
      form.hidden = true;
      const alternatives = document.getElementById("scan-unavailable-actions");
      if (alternatives) alternatives.hidden = false;
      showFeedback("error", "scan.unavailableTitle", "scan.unavailableBody");
      return;
    }
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      widgetId = window.turnstile.render("#scan-turnstile", {
        sitekey,
        action: "free_scan",
        language: i18next.resolvedLanguage === "sk" ? "sk" : "en",
        callback: (token) => {
          turnstileToken = token;
          if (!requestSubmitted) submitBtn.disabled = false;
          if (feedback.dataset.state === "error") feedback.hidden = true;
        },
        "expired-callback": () => { turnstileToken = ""; submitBtn.disabled = true; },
        "error-callback": () => {
          turnstileToken = "";
          if (requestSubmitted) return;
          submitBtn.disabled = true;
          showFeedback("error", "scan.requestErrorTitle", "scan.challengeUnavailable");
        },
      });
    } catch (error) {
      console.warn("Turnstile could not load", error);
      submitBtn.disabled = true;
      showFeedback("error", "scan.requestErrorTitle", "scan.challengeUnavailable");
    }
  }

  function startPolling(requestId) {
    let attempts = 0;
    const poll = async () => {
      try {
        const statusResponse = await fetch(`/api/free-scan?id=${encodeURIComponent(requestId)}`, { cache: "no-store" });
        if (!statusResponse.ok) throw new Error("Could not read scan status");
        const status = await statusResponse.json();
        if (status.status === "completed") {
          showFeedback("completed", "scan.completedTitle", "scan.completedBody", {
            checked: status.checkedProducts,
            matches: status.possibleMatches,
          });
          return;
        }
        if (status.status === "failed") {
          showFeedback("error", "scan.failedTitle", "scan.failedBody");
          return;
        }
        if (status.status === "queued") showFeedback("queued", "scan.queuedTitle", "scan.queuedBody");
        if (["running", "reporting"].includes(status.status)) showFeedback("running", "scan.runningTitle", "scan.runningBody");
      } catch (error) {
        console.warn("Scan status temporarily unavailable", error);
      }
      attempts += 1;
      if (attempts < 150) {
        window.setTimeout(poll, 4000);
      } else {
        showFeedback("queued", "scan.delayedTitle", "scan.delayedBody");
      }
    };
    window.setTimeout(poll, 4000);
  }

  const confirmationToken = window.location.hash.startsWith("#verify=")
    ? window.location.hash.slice("#verify=".length)
    : "";
  if (confirmationToken && confirmation && confirmBtn) {
    form.hidden = true;
    confirmation.hidden = false;
    document.getElementById("scan-title")?.scrollIntoView();
    confirmBtn.addEventListener("click", async () => {
      confirmBtn.disabled = true;
      showFeedback("pending", "scan.confirmingTitle", "scan.confirmingBody");
      try {
        const response = await fetch("/api/free-scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmationToken }),
        });
        if (!response.ok) {
          showFeedback("error", "scan.confirmErrorTitle", response.status === 422 ? "scan.noCatalogBody" : "scan.confirmErrorBody");
          confirmBtn.disabled = false;
          return;
        }
        const request = await response.json();
        confirmation.hidden = true;
        window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}#scan-form`);
        showFeedback("queued", "scan.queuedTitle", "scan.queuedBody");
        startPolling(request.id);
      } catch (error) {
        console.error("Could not confirm free scan", error);
        showFeedback("error", "scan.confirmErrorTitle", "scan.requestErrorBody");
        confirmBtn.disabled = false;
      }
    });
    return;
  }

  loadChallenge();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const domain = document.getElementById("scan-domain").value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
    const emailInput = document.getElementById("scan-email");
    const email = emailInput.value.trim();
    if (!/^[a-z0-9][a-z0-9-]{1,60}\.myshopify\.com$/.test(domain)) {
      showFeedback("error", "scan.requestErrorTitle", "scan.invalidDomain");
      return;
    }
    if (!emailInput.checkValidity()) {
      showFeedback("error", "scan.requestErrorTitle", "scan.invalidEmail");
      return;
    }
    if (!turnstileToken) {
      showFeedback("error", "scan.requestErrorTitle", "scan.challengeRequired");
      return;
    }

    submitBtn.disabled = true;
    showFeedback("pending", "scan.submittingTitle", "scan.submittingBody");
    try {
      const response = await fetch("/api/free-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, email, locale: i18next.resolvedLanguage || "en", turnstileToken }),
      });
      if (!response.ok) {
        if (response.status === 429) {
          showFeedback("error", "scan.requestErrorTitle", "scan.rateLimitBody");
        } else {
          showFeedback("error", "scan.requestErrorTitle", "scan.requestErrorBody");
        }
        resetChallenge();
        submitBtn.disabled = true;
        return;
      }
      const request = await response.json();
      if (!/^[A-Za-z0-9]{20}$/.test(request.id || "")) throw new Error("Invalid scan request ID");
      requestSubmitted = true;
      showFeedback("awaiting_verification", "scan.verifyEmailTitle", "scan.verifyEmailBody");
    } catch (error) {
      console.error("Could not request free scan", error);
      showFeedback("error", "scan.requestErrorTitle", "scan.requestErrorBody");
      resetChallenge();
      submitBtn.disabled = true;
    }
  });
}

async function initI18n() {
  initLanguageSelectors();
  await i18next.use(translationBackend).use(LanguageDetector).init({
    resources,
    partialBundledLanguages: true,
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
  initMenu();

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
  initMenu();
});
