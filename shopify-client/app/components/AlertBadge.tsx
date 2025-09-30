import { Badge, Tooltip } from "@shopify/polaris";
import {
  AlertDiamondIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  InfoIcon,
} from "@shopify/polaris-icons";

interface AlertBadgeProps {
  alertLevel?: string;
  alertType?: string;
  riskDescription?: string;
}

export function AlertBadge({ alertLevel, alertType, riskDescription }: AlertBadgeProps) {
  // Extract display text from alertType or alertLevel
  let displayText = alertType || alertLevel || 'Unknown';

  // If alertType is empty but alertLevel contains useful info, extract it
  if (!alertType && alertLevel && alertLevel !== 'Unknown') {
    // For example: "Serious risk" -> "Serious risk"
    // Or if it contains type info: "Chemical risk" -> "Chemical"
    if (alertLevel.toLowerCase().includes('chemical')) {
      displayText = 'Chemical';
    } else if (alertLevel.toLowerCase().includes('injuries')) {
      displayText = 'Injuries';
    } else if (alertLevel.toLowerCase().includes('fire')) {
      displayText = 'Fire';
    } else if (alertLevel.toLowerCase().includes('electric')) {
      displayText = 'Electric shock';
    } else {
      displayText = alertLevel; // Use the full alert level as fallback
    }
  }

  const { tone: badgeTone, icon } = getAlertVisuals(alertLevel);

  const badge = (
    <Badge tone={badgeTone} icon={icon}>
      {displayText}
    </Badge>
  );

  if (riskDescription) {
    return (
      <Tooltip content={riskDescription}>
        {badge}
      </Tooltip>
    );
  }

  return badge;
}

function getAlertVisuals(alertLevel?: string) {
  if (!alertLevel) {
    return { tone: "warning" as const, icon: AlertTriangleIcon };
  }

  const normalized = alertLevel.toLowerCase();
  if (normalized.includes('serious')) {
    return { tone: "critical" as const, icon: AlertDiamondIcon };
  }
  if (normalized.includes('high') || normalized.includes('other risk')) {
    return { tone: "warning" as const, icon: AlertTriangleIcon };
  }
  if (normalized.includes('low')) {
    return { tone: "success" as const, icon: CheckCircleIcon };
  }
  // Default to info to flag unknown risk levels without alarming the merchant
  return { tone: "info" as const, icon: InfoIcon };
}
