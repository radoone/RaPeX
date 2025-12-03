import type { ReactNode } from "react";

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
  const hasActions = Boolean(primaryAction) || Boolean(secondaryActions?.length);

  return (
    <s-section className="page-header">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <div className="page-header__breadcrumbs">
          {breadcrumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`}>
              {crumb.href ? <s-link href={crumb.href}>{crumb.label}</s-link> : crumb.label}
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
                href={action.href}
                onClick={action.onClick}
                loading={action.loading || undefined}
              >
                {action.label}
              </s-button>
            ))}
            {primaryAction && (
              <s-button
                variant={primaryAction.variant || "primary"}
                tone={primaryAction.tone}
                href={primaryAction.href}
                onClick={primaryAction.onClick}
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
