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
    <s-stack direction="inline" gap="small">
      <s-button
        size="small"
        variant="secondary"
        onClick={() => onViewDetails(alertId)}
        loading={isLoading || undefined}
      >
        View
      </s-button>
      {status === 'active' && (
        <>
          <s-button
            size="small"
            variant="secondary"
            tone="critical"
            onClick={() => onDismiss?.(alertId)}
            loading={isLoading || undefined}
          >
            Dismiss
          </s-button>
          <s-button
            size="small"
            variant="primary"
            tone="success"
            onClick={() => onResolve?.(alertId)}
            loading={isLoading || undefined}
          >
            Resolve
          </s-button>
        </>
      )}
      {(status === 'dismissed' || status === 'resolved') && (
        <s-button
          size="small"
          variant="secondary"
          onClick={() => onReactivate?.(alertId)}
          loading={isLoading || undefined}
        >
          Reactivate
        </s-button>
      )}
    </s-stack>
  );
}
