import { RemixBrowser } from "@remix-run/react";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import i18n from "./i18n";
import { I18nextProvider } from "react-i18next";

startTransition(() => {
    hydrateRoot(
        document,
        <StrictMode>
            <I18nextProvider i18n={i18n}>
                <RemixBrowser />
            </I18nextProvider>
        </StrictMode>
    );
});
