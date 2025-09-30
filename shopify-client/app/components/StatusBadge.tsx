import { Badge } from "@shopify/polaris";
import {
  AlertDiamondIcon,
  HideIcon,
  CheckCircleIcon,
  InfoIcon,
} from "@shopify/polaris-icons";

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  switch (status) {
    case 'active':
      return <Badge tone="critical" icon={AlertDiamondIcon}>Active</Badge>;
    case 'dismissed':
      return <Badge tone="warning" icon={HideIcon}>Dismissed</Badge>;
    case 'resolved':
      return <Badge tone="success" icon={CheckCircleIcon}>Resolved</Badge>;
    default:
      return <Badge icon={InfoIcon}>{status}</Badge>;
  }
}
