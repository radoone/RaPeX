import { DataTable, Link, InlineStack, BlockStack, Text, Badge, Icon } from "@shopify/polaris";
import { AlertBadge } from "./AlertBadge";
import { StatusBadge } from "./StatusBadge";
import { AlertActions } from "./AlertActions";
import {
  ProductIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
} from "@shopify/polaris-icons";

interface Alert {
  id: string;
  productId?: string;
  productTitle: string;
  riskLevel: string;
  alertType?: string;
  riskDescription?: string;
  status: string;
  warningsCount: number;
  createdAt: string;
  notes?: string | null;
}

interface AlertTableProps {
  alerts: Alert[];
  onViewDetails: (alert: Alert) => void;
  onDismiss?: (alertId: string) => void;
  onResolve?: (alertId: string) => void;
  onReactivate?: (alertId: string) => void;
  isLoading?: boolean;
  showProductLink?: boolean;
}

export function AlertTable({
  alerts,
  onViewDetails,
  onDismiss,
  onResolve,
  onReactivate,
  isLoading = false,
  showProductLink = false,
}: AlertTableProps) {
  const rows = alerts.map((alert: Alert) => {
    const adminProductId = alert.productId?.replace('gid://shopify/Product/', '') || '';
    const productUrl = adminProductId ? `shopify:admin/products/${adminProductId}` : 'shopify:admin/products';

    return [
      <InlineStack key={`product-${alert.id}`} gap="200" blockAlign="center">
        <Icon source={ProductIcon} tone="primary" />
        {showProductLink ? (
          <Link url={productUrl} removeUnderline>
            {alert.productTitle}
          </Link>
        ) : (
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {alert.productTitle}
          </Text>
        )}
      </InlineStack>,
    <BlockStack key={`risk-${alert.id}`} gap="100">
      <AlertBadge
        alertLevel={alert.riskLevel}
        alertType={alert.alertType}
        riskDescription={alert.riskDescription}
      />
      {alert.riskDescription && (
        <Text as="span" variant="bodySm" tone="subdued">
          {summarizeRisk(alert.riskDescription)}
        </Text>
      )}
    </BlockStack>,
    <StatusBadge key={`status-${alert.id}`} status={alert.status} />,
    <Badge
      key={`warnings-${alert.id}`}
      tone={alert.warningsCount > 0 ? 'critical' : 'success'}
      icon={alert.warningsCount > 0 ? AlertTriangleIcon : CheckCircleIcon}
    >
      {alert.warningsCount} {alert.warningsCount === 1 ? 'match' : 'matches'}
    </Badge>,
    <BlockStack key={`created-${alert.id}`} gap="100">
      <Text as="span" variant="bodyMd">
        {new Date(alert.createdAt).toLocaleDateString('en-GB')}
      </Text>
      <Text as="span" variant="bodySm" tone="subdued">
        {new Date(alert.createdAt).toLocaleTimeString('en-GB')}
      </Text>
    </BlockStack>,
    <AlertActions
      key={`actions-${alert.id}`}
      alertId={alert.id}
      status={alert.status}
      onViewDetails={() => onViewDetails(alert)}
      onDismiss={onDismiss}
      onResolve={onResolve}
      onReactivate={onReactivate}
      isLoading={isLoading}
    />
  ];
  });

  return (
    <DataTable
      columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text']}
      headings={['Product', 'Risk', 'Status', 'Matches', 'Created', 'Actions']}
      rows={rows}
    />
  );
}

function summarizeRisk(description: string) {
  if (description.length <= 80) {
    return description;
  }
  return `${description.slice(0, 77)}...`;
}
