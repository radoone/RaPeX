import type { ReactNode } from "react";

interface SummaryCardProps {
  title: string;
  value: ReactNode;
  description?: string;
  badge?: ReactNode;
  footer?: ReactNode;
  progress?: number;
  progressTone?: "primary" | "critical" | "success" | "warning" | "info";
}

export function SummaryCard({
  title,
  value,
  description,
  badge,
  footer,
  progress,
  progressTone = "primary",
}: SummaryCardProps) {
  const hasProgress = typeof progress === "number" && progress >= 0;
  const clampedProgress = hasProgress ? Math.min(Math.max(progress ?? 0, 0), 100) : null;

  return (
    <div className="metric-card">
      <s-stack gap="small">
        <span className="metric-card__title">{title}</span>
        <s-stack direction="inline" gap="small" blockAlign="center" wrap>
          <s-heading size="large">{value}</s-heading>
          {badge}
        </s-stack>
        {description && <s-text tone="subdued">{description}</s-text>}
        {hasProgress && clampedProgress !== null && (
          <s-progress-bar progress={clampedProgress} tone={progressTone} />
        )}
        {footer && <div className="metric-card__footer">{footer}</div>}
      </s-stack>
    </div>
  );
}
