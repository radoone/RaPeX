import { useEffect, useState } from "react";
import { Button, ButtonGroup } from "@shopify/polaris";
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

    // During SSR and initial render, show neutral state
    if (!mounted) {
        return (
            <ButtonGroup variant="segmented">
                <Button size="micro">EN</Button>
                <Button size="micro">SK</Button>
            </ButtonGroup>
        );
    }

    return (
        <ButtonGroup variant="segmented">
            <Button
                pressed={currentLang === 'en'}
                onClick={() => changeLanguage('en')}
                size="micro"
            >
                EN
            </Button>
            <Button
                pressed={currentLang === 'sk'}
                onClick={() => changeLanguage('sk')}
                size="micro"
            >
                SK
            </Button>
        </ButtonGroup>
    );
}
