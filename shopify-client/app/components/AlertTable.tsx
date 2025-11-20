import {
  IndexTable,
  Link,
  InlineStack,
  BlockStack,
  Text,
  Badge,
  Icon,
  useIndexResourceState,
  EmptyState,
} from "@shopify/polaris";
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
  [key: string]: unknown;
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
  const resourceName = {
    singular: 'alert',
    plural: 'alerts',
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(alerts);

  const rowMarkup = alerts.map(
    (alert, index) => {
      const adminProductId = alert.productId?.replace('gid://shopify/Product/', '') || '';
      const productUrl = adminProductId ? `shopify:admin/products/${adminProductId}` : 'shopify:admin/products';

      return (
        <IndexTable.Row
          id={alert.id}
          key={alert.id}
          selected={selectedResources.includes(alert.id)}
          position={index}
        >
          <IndexTable.Cell>
            <InlineStack gap="200" blockAlign="center">
              <Icon source={ProductIcon} tone="primary" />
              {showProductLink ? (
                <Link url={productUrl} removeUnderline>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {alert.productTitle}
                  </Text>
                </Link>
              ) : (
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  {alert.productTitle}
                </Text>
              )}
            </InlineStack>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <BlockStack gap="100">
              <AlertBadge
                alertLevel={alert.riskLevel}
                alertType={alert.alertType}
                riskDescription={alert.riskDescription}
              />
            </BlockStack>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <StatusBadge status={alert.status} />
          </IndexTable.Cell>
          <IndexTable.Cell>
            <Badge
              tone={alert.warningsCount > 0 ? 'critical' : 'success'}
              icon={alert.warningsCount > 0 ? AlertTriangleIcon : CheckCircleIcon}
            >
              {`${alert.warningsCount} ${alert.warningsCount === 1 ? 'match' : 'matches'}`}
            </Badge>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <BlockStack gap="050">
              <Text as="span" variant="bodyMd">
                {new Date(alert.createdAt).toLocaleDateString('en-GB')}
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                {new Date(alert.createdAt).toLocaleTimeString('en-GB')}
              </Text>
            </BlockStack>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <div onClick={(e) => e.stopPropagation()}>
              <AlertActions
                alertId={alert.id}
                status={alert.status}
                onViewDetails={() => onViewDetails(alert)}
                onDismiss={onDismiss}
                onResolve={onResolve}
                onReactivate={onReactivate}
                isLoading={isLoading}
              />
            </div>
          </IndexTable.Cell>
        </IndexTable.Row>
      );
    },
  );

  if (alerts.length === 0) {
    return (
      <EmptyState
        heading="No safety alerts found"
        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
      >
        <p>There are no alerts matching your criteria.</p>
      </EmptyState>
    );
  }

  return (
    <IndexTable
      resourceName={resourceName}
      itemCount={alerts.length}
      selectedItemsCount={
        allResourcesSelected ? 'All' : selectedResources.length
      }
      onSelectionChange={handleSelectionChange}
      headings={[
        { title: 'Product' },
        { title: 'Risk' },
        { title: 'Status' },
        { title: 'Matches' },
        { title: 'Created' },
        { title: 'Actions' },
      ]}
      selectable={false}
    >
      {rowMarkup}
    </IndexTable>
  );
}


