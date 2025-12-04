import type { ReactNode } from "react";
import { useNavigate } from "@remix-run/react";

type HeaderAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "tertiary";
  tone?: "critical" | "success" | "warning" | "info";
  loading?: boolean;
};

type Breadcrumb = {
  label: string;
  href?: string;
};

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: Breadcrumb[];
  meta?: ReactNode;
  primaryAction?: HeaderAction;
  secondaryActions?: HeaderAction[];
}

export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  meta,
  primaryAction,
  secondaryActions,
}: PageHeaderProps) {
  const navigate = useNavigate();
  const hasActions = Boolean(primaryAction) || Boolean(secondaryActions?.length);

  // Handle action click - use Remix navigate for internal links
  const handleActionClick = (action: HeaderAction) => {
    if (action.onClick) {
      action.onClick();
    } else if (action.href) {
      navigate(action.href);
    }
  };

  return (
    <s-section className="page-header">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <div className="page-header__breadcrumbs">
          {breadcrumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`}>
              {crumb.href ? (
                <s-clickable onClick={() => navigate(crumb.href!)}>{crumb.label}</s-clickable>
              ) : (
                crumb.label
              )}
              {index < breadcrumbs.length - 1 && <span aria-hidden="true">/</span>}
            </span>
          ))}
        </div>
      )}

      <div className="page-header__top">
        <s-stack gap="small">
          <s-heading size="large">{title}</s-heading>
          {subtitle && <s-text tone="subdued">{subtitle}</s-text>}
          {meta && <div className="page-header__meta">{meta}</div>}
        </s-stack>

        {hasActions && (
          <div className="page-header__actions">
            {secondaryActions?.map((action, index) => (
              <s-button
                key={`${action.label}-${index}`}
                variant={action.variant || "secondary"}
                tone={action.tone}
                onClick={() => handleActionClick(action)}
                loading={action.loading || undefined}
              >
                {action.label}
              </s-button>
            ))}
            {primaryAction && (
              <s-button
                variant={primaryAction.variant || "primary"}
                tone={primaryAction.tone}
                onClick={() => handleActionClick(primaryAction)}
                loading={primaryAction.loading || undefined}
              >
                {primaryAction.label}
              </s-button>
            )}
          </div>
        )}
      </div>
    </s-section>
  );
}
