import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { EU_LANGUAGES, changeMerchantLanguage } from "../i18n";

import { LANGUAGE_STORAGE_KEY } from "../services/interface-language";

export function LanguageSwitcher() {
    const { i18n, t } = useTranslation();
    const [mounted, setMounted] = useState(false);
    const [currentLang, setCurrentLang] = useState('en');
    const [changing, setChanging] = useState(false);
    const [failed, setFailed] = useState(false);

    // Only render language state after client mount to avoid hydration mismatch
    useEffect(() => {
        const updateCurrentLanguage = (language: string) => {
            setCurrentLang(language);
        };

        setMounted(true);
        setCurrentLang(i18n.resolvedLanguage || i18n.language || "en");
        i18n.on("languageChanged", updateCurrentLanguage);

        return () => {
            i18n.off("languageChanged", updateCurrentLanguage);
        };
    }, [i18n]);

    const changeLanguage = async (lng: string) => {
        setChanging(true);
        setFailed(false);
        const previous = currentLang;
        setCurrentLang(lng);
        try {
            await changeMerchantLanguage(lng);
            try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lng); } catch { /* Keep the selection for this visit when storage is blocked. */ }
            setCurrentLang(lng);
        } catch {
            setCurrentLang(previous);
            setFailed(true);
        } finally { setChanging(false); }
    };

    return (
        <div><s-select
            label={t("common.language")}
            value={mounted ? currentLang : "en"}
            disabled={changing}
            onChange={(event: any) => changeLanguage(event.currentTarget.value)}
        >
            {EU_LANGUAGES.map((language) => (
                <s-option key={language.code} value={language.code}>
                    {language.label}
                </s-option>
            ))}
        </s-select>{failed ? <p role="alert">{t("errors.apiError")} {t("actions.retry")}</p> : null}</div>
    );
}
