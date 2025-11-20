import { Button, ButtonGroup } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

export function LanguageSwitcher() {
    const { i18n } = useTranslation();

    const changeLanguage = (lng: string) => {
        i18n.changeLanguage(lng);
    };

    return (
        <ButtonGroup variant="segmented">
            <Button
                pressed={i18n.language === 'en'}
                onClick={() => changeLanguage('en')}
                size="micro"
            >
                EN
            </Button>
            <Button
                pressed={i18n.language === 'sk'}
                onClick={() => changeLanguage('sk')}
                size="micro"
            >
                SK
            </Button>
        </ButtonGroup>
    );
}
