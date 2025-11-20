import { Page, Layout, Card, Text, BlockStack, InlineStack, Icon } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { TitleBar } from "@shopify/app-bridge-react";
import { CheckCircleIcon, AlertDiamondIcon, ShieldCheckMarkIcon, ClipboardChecklistIcon, ChartVerticalIcon } from "@shopify/polaris-icons";

export default function QuickGuide() {
    const { t } = useTranslation();

    return (
        <Page>
            <TitleBar title={t('guide.title')} />
            <Layout>
                <Layout.Section>
                    <Card>
                        <BlockStack gap="400">
                            <Text as="h2" variant="headingMd">
                                {t('dashboard.howItWorks.title')}
                            </Text>
                            <BlockStack gap="300">
                                <InlineStack gap="300" blockAlign="start">
                                    <Icon source={CheckCircleIcon} tone="success" />
                                    <BlockStack gap="100">
                                        <Text as="h3" variant="headingSm">{t('dashboard.howItWorks.autoMonitoring.title')}</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">
                                            {t('dashboard.howItWorks.autoMonitoring.description')}
                                        </Text>
                                    </BlockStack>
                                </InlineStack>
                                <InlineStack gap="300" blockAlign="start">
                                    <Icon source={AlertDiamondIcon} tone="critical" />
                                    <BlockStack gap="100">
                                        <Text as="h3" variant="headingSm">{t('dashboard.howItWorks.alertGeneration.title')}</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">
                                            {t('dashboard.howItWorks.alertGeneration.description')}
                                        </Text>
                                    </BlockStack>
                                </InlineStack>
                            </BlockStack>
                        </BlockStack>
                    </Card>

                    <Card>
                        <BlockStack gap="400">
                            <Text as="h2" variant="headingMd">
                                {t('guide.importance.title')}
                            </Text>
                            <Text as="p">
                                {t('guide.importance.description')}
                            </Text>
                            <BlockStack gap="400">
                                <InlineStack gap="300" blockAlign="start">
                                    <Icon source={ShieldCheckMarkIcon} tone="success" />
                                    <BlockStack gap="100">
                                        <Text as="h3" variant="headingSm">{t('guide.importance.points.safety.title')}</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">{t('guide.importance.points.safety.description')}</Text>
                                    </BlockStack>
                                </InlineStack>
                                <InlineStack gap="300" blockAlign="start">
                                    <Icon source={ClipboardChecklistIcon} tone="primary" />
                                    <BlockStack gap="100">
                                        <Text as="h3" variant="headingSm">{t('guide.importance.points.compliance.title')}</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">{t('guide.importance.points.compliance.description')}</Text>
                                    </BlockStack>
                                </InlineStack>
                                <InlineStack gap="300" blockAlign="start">
                                    <Icon source={CheckCircleIcon} tone="warning" />
                                    <BlockStack gap="100">
                                        <Text as="h3" variant="headingSm">{t('guide.importance.points.reputation.title')}</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">{t('guide.importance.points.reputation.description')}</Text>
                                    </BlockStack>
                                </InlineStack>
                                <InlineStack gap="300" blockAlign="start">
                                    <Icon source={ChartVerticalIcon} tone="critical" />
                                    <BlockStack gap="100">
                                        <Text as="h3" variant="headingSm">{t('guide.importance.points.business.title')}</Text>
                                        <Text as="p" variant="bodySm" tone="subdued">{t('guide.importance.points.business.description')}</Text>
                                    </BlockStack>
                                </InlineStack>
                            </BlockStack>
                        </BlockStack>
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
