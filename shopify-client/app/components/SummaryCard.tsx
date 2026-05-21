import type { ReactNode } from "react";

interface SummaryCardProps {
  title: string;
  value: ReactNode;
  description?: string;
  badge?: ReactNode;
  footer?: ReactNode;
  progress?: number;
  progressTone?: "primary" | "critical" | "success" | "warning" | "info";
  onClick?: () => void;
  isActive?: boolean;
}

export function SummaryCard({
  title,
  value,
  description,
  badge,
  footer,
  progress,
  progressTone = "primary",
  onClick,
  isActive,
}: SummaryCardProps) {
  const hasProgress = typeof progress === "number" && progress >= 0;
  const clampedProgress = hasProgress ? Math.min(Math.max(progress ?? 0, 0), 100) : null;

  const cardClassName = [
    "metric-card",
    onClick ? "metric-card--interactive" : "",
    isActive ? "metric-card--active" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={cardClassName}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      } : undefined}
    >
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
