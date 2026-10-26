import type { HTMLAttributes } from "react";

/** Let Polaris own the card surface; keep only the content layout in app CSS. */
export function AdminCard({
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <s-section padding="none">
      <div {...props} className={`native-admin-card__content ${className}`}>
        {children}
      </div>
    </s-section>
  );
}
