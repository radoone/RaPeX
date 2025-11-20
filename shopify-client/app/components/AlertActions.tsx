import { InlineStack, Button } from "@shopify/polaris";
import {
  ViewIcon,
  HideIcon,
  CheckCircleIcon,
  RefreshIcon,
} from "@shopify/polaris-icons";

interface AlertActionsProps {
  alertId: string;
  status: string;
  onViewDetails: (alertId: string) => void;
  onDismiss?: (alertId: string) => void;
  onResolve?: (alertId: string) => void;
  onReactivate?: (alertId: string) => void;
  isLoading?: boolean;
}

export function AlertActions({
  alertId,
  status,
  onViewDetails,
  onDismiss,
  onResolve,
  onReactivate,
  isLoading = false
}: AlertActionsProps) {
  return (
    <InlineStack gap="200">
      <Button
        size="slim"
        variant="secondary"
        icon={ViewIcon}
        onClick={() => onViewDetails(alertId)}
      >
        View Details
      </Button>
      {status === 'active' && (
        <>
          <Button
            size="slim"
            variant="secondary"
            tone="critical"
            icon={HideIcon}
            onClick={() => onDismiss?.(alertId)}
            loading={isLoading}
          >
            Dismiss
          </Button>
          <Button
            size="slim"
            variant="primary"
            tone="success"
            icon={CheckCircleIcon}
            onClick={() => onResolve?.(alertId)}
            loading={isLoading}
          >
            Resolve
          </Button>
        </>
      )}
      {(status === 'dismissed' || status === 'resolved') && (
        <Button
          size="slim"
          variant="secondary"
          icon={RefreshIcon}
          onClick={() => onReactivate?.(alertId)}
          loading={isLoading}
        >
          Reactivate
        </Button>
      )}
    </InlineStack>
  );
}
