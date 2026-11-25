import { HydratedRouter } from "react-router/dom";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import i18n, { changeMerchantLanguage } from "./i18n";
import { I18nextProvider } from "react-i18next";
import { normalizeInterfaceLanguage } from "./services/interface-language";

async function hydrate() {
  const initialLang = normalizeInterfaceLanguage(document.documentElement.lang) || "en";
  if (initialLang !== "en") {
    await changeMerchantLanguage(initialLang).catch(() => {});
  }
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <I18nextProvider i18n={i18n}>
          <HydratedRouter />
        </I18nextProvider>
      </StrictMode>
    );
  });
}

void hydrate();
