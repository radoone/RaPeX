import { Page, Layout, Card, Text, BlockStack } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { TitleBar } from "@shopify/app-bridge-react";

export default function Settings() {
    const { t } = useTranslation();

    return (
        <Page>
            <TitleBar title={t('settings.title')} />
            <Layout>
                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text as="h2" variant="headingMd">
                                {t('settings.title')}
                            </Text>
                            <Text as="p">
                                Settings configuration will appear here.
                            </Text>
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
