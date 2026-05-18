import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { EU_LANGUAGES } from "../i18n";

export function LanguageSwitcher() {
    const { i18n, t } = useTranslation();
    const [mounted, setMounted] = useState(false);
    const [currentLang, setCurrentLang] = useState('en');

    // Only render language state after client mount to avoid hydration mismatch
    useEffect(() => {
        setMounted(true);
        setCurrentLang(i18n.language);
    }, [i18n.language]);

    const changeLanguage = (lng: string) => {
        i18n.changeLanguage(lng);
        setCurrentLang(lng);
    };

    return (
        <s-select
            label={t("common.language")}
            value={mounted ? currentLang : "en"}
            onChange={(event: any) => changeLanguage(event.currentTarget.value)}
        >
            {EU_LANGUAGES.map((language) => (
                <s-option key={language.code} value={language.code}>
                    {language.label}
                </s-option>
            ))}
        </s-select>
    );
}
