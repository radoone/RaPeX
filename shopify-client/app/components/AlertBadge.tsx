interface AlertBadgeProps {
  alertLevel?: string;
  alertType?: string;
  riskDescription?: string;
}

export function AlertBadge({ alertLevel, alertType, riskDescription }: AlertBadgeProps) {
  let displayText = alertType || alertLevel || 'Unknown';

  if (!alertType && alertLevel && alertLevel !== 'Unknown') {
    const normalized = alertLevel.toLowerCase();
    if (normalized.includes('chemical')) {
      displayText = 'Chemical';
    } else if (normalized.includes('injuries')) {
      displayText = 'Injuries';
    } else if (normalized.includes('fire')) {
      displayText = 'Fire';
    } else if (normalized.includes('electric')) {
      displayText = 'Electric shock';
    } else {
      displayText = alertLevel;
    }
  }

  const tone = getAlertTone(alertLevel);

  return (
    <s-badge tone={tone} title={riskDescription || undefined}>
      {displayText}
    </s-badge>
  );
}

function getAlertTone(alertLevel?: string): "critical" | "warning" | "success" | "info" | undefined {
  if (!alertLevel) return "warning";

  const normalized = alertLevel.toLowerCase();
  if (normalized.includes('serious')) return "critical";
  if (normalized.includes('high') || normalized.includes('other risk')) return "warning";
  if (normalized.includes('low')) return "success";
  return "info";
}
