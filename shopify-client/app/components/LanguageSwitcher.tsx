import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function LanguageSwitcher() {
    const { i18n } = useTranslation();
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

    const buttonVariant = (lng: string) =>
        mounted && currentLang === lng ? "primary" : "tertiary";

    return (
        <s-stack direction="inline" gap="small" blockAlign="center">
            <s-button
                type="button"
                variant={buttonVariant('en')}
                size="small"
                aria-pressed={mounted && currentLang === 'en'}
                onClick={() => changeLanguage('en')}
            >
                EN
            </s-button>
            <s-button
                type="button"
                variant={buttonVariant('sk')}
                size="small"
                aria-pressed={mounted && currentLang === 'sk'}
                onClick={() => changeLanguage('sk')}
            >
                SK
            </s-button>
        </s-stack>
    );
}
