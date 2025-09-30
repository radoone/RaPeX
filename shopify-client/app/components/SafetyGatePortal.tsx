import { Card, BlockStack, InlineStack, Text, Button } from "@shopify/polaris";

export function SafetyGatePortal() {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">🔍 Safety Gate Portal</Text>
            <Text as="p" variant="bodyMd">
              Access the official European Safety Gate database to search for dangerous products and view detailed safety alerts.
            </Text>
          </BlockStack>
          <InlineStack gap="300">
            <a
              href="https://ec.europa.eu/safety-gate-alerts/screen/search?resetSearch=true"
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none' }}
            >
              <Button variant="primary" size="medium">
                Search Database
              </Button>
            </a>
            <a
              href="https://ec.europa.eu/safety-gate-alerts/screen/home"
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none' }}
            >
              <Button variant="secondary" size="medium">
                Safety Gate Home
              </Button>
            </a>
          </InlineStack>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
