import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { AlertBadge } from "./AlertBadge";
import { RiskMeter } from "./RiskMeter";
import { StatusBadge } from "./StatusBadge";

interface AlertDetailModalProps {
  alert: any;
  modalId: string;
  onDismiss?: (alertId: string, notes?: string) => void;
  onResolve?: (alertId: string, notes?: string) => void;
  onReactivate?: (alertId: string) => void;
  isLoading?: boolean;
}

export function AlertDetailModal({
  alert,
  modalId,
  onDismiss,
  onResolve,
  onReactivate,
  isLoading = false,
}: AlertDetailModalProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const dismissBtnRef = useRef<HTMLElement>(null);
  const resolveBtnRef = useRef<HTMLElement>(null);
  const reactivateBtnRef = useRef<HTMLElement>(null);

  // Close lightbox
  const closeLightbox = useCallback(() => {
    setSelectedImage(null);
  }, []);

  const parsed = useMemo(() => {
    if (!alert) return null;
    try {
      return alert.checkResult ? JSON.parse(alert.checkResult) : null;
    } catch (error) {
      console.error("Unable to parse checkResult", error);
      return null;
    }
  }, [alert]);

  // Handle dismiss button click
  useEffect(() => {
    const btn = dismissBtnRef.current;
    if (!btn || !alert) return;

    const handleClick = () => onDismiss?.(alert.id);
    btn.addEventListener('click', handleClick);
    return () => btn.removeEventListener('click', handleClick);
  }, [alert, onDismiss]);

  // Handle resolve button click
  useEffect(() => {
    const btn = resolveBtnRef.current;
    if (!btn || !alert) return;

    const handleClick = () => onResolve?.(alert.id);
    btn.addEventListener('click', handleClick);
    return () => btn.removeEventListener('click', handleClick);
  }, [alert, onResolve]);

  // Handle reactivate button click
  useEffect(() => {
    const btn = reactivateBtnRef.current;
    if (!btn || !alert) return;

    const handleClick = () => onReactivate?.(alert.id);
    btn.addEventListener('click', handleClick);
    return () => btn.removeEventListener('click', handleClick);
  }, [alert, onReactivate]);

  if (!alert) return null;

  const warnings: any[] = Array.isArray(parsed?.warnings) ? parsed.warnings : [];
  const recommendation = parsed?.recommendation ?? "Review this product before continuing to sell it.";
  const checkedAt = parsed?.checkedAt ? new Date(parsed.checkedAt) : null;
  const isSafe = parsed?.isSafe === true;
  const warningsCount = warnings.length || alert.warningsCount || 0;
  const primaryWarning = warnings[0];
  const similarity = typeof primaryWarning?.similarity === "number" ? primaryWarning.similarity : null;

  // Helper to get images from warning
  const getWarningImages = (warning: any) => {
    const fields = warning.alertDetails?.fields || {};
    let pictures = Array.isArray(fields.pictures) ? fields.pictures : [];
    if (pictures.length === 0) {
      if (fields.product_image) pictures.push(fields.product_image);
      if (fields.product_other_images && typeof fields.product_other_images === "string") {
        pictures.push(
          ...fields.product_other_images
            .split(",")
            .map((entry: string) => entry.trim())
            .filter(Boolean)
        );
      }
    }
    return pictures;
  };

  return (
    <>
      <s-modal id={modalId} heading="Safety Alert Details" size="large">
        <s-stack gap="large">
          {/* Product Overview Section */}
          <s-box
            padding="large"
            borderRadius="large"
            background="bg-surface-secondary"
          >
            <s-stack gap="base">
              <s-stack direction="inline" gap="large" blockAlign="start" wrap>
                {/* Product Image */}
                {alert.productImage && (
                  <div
                    onClick={() => setSelectedImage(alert.productImage)}
                    className="alert-image-clickable"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setSelectedImage(alert.productImage);
                    }}
                    style={{ flexShrink: 0 }}
                  >
                    <s-thumbnail
                      src={alert.productImage}
                      alt={alert.productTitle}
                      size="extra-large"
                    />
                  </div>
                )}

                {/* Product Info */}
                <s-stack gap="base" style={{ flex: 1, minWidth: 0 }}>
                  <s-heading size="large">{alert.productTitle}</s-heading>

                  <s-stack direction="inline" gap="small" wrap>
                    <StatusBadge status={alert.status} />
                    <AlertBadge
                      alertLevel={alert.riskLevel}
                      alertType={alert.alertType}
                      riskDescription={alert.riskDescription}
                    />
                    <s-badge tone={warningsCount > 0 ? "critical" : "success"}>
                      {warningsCount} {warningsCount === 1 ? "match" : "matches"}
                    </s-badge>
                  </s-stack>

                  <RiskMeter riskLevel={alert.riskLevel} similarity={similarity} />

                  {checkedAt && (
                    <s-text tone="subdued" size="small">
                      Last checked: {checkedAt.toLocaleString("en-GB")}
                    </s-text>
                  )}
                </s-stack>
              </s-stack>
            </s-stack>
          </s-box>

          {/* Notes Section */}
          {alert.notes && (
            <s-banner tone="info" heading="Internal Notes">
              <s-text>{alert.notes}</s-text>
            </s-banner>
          )}

          {/* Status Banner */}
          <s-banner
            tone={isSafe ? "success" : "critical"}
            heading={isSafe ? "No Safety Issues Found" : "⚠️ Potential Safety Risk Detected"}
          >
            <s-text>{recommendation}</s-text>
          </s-banner>

          {/* Safety Gate Matches Section */}
          {warnings.length > 0 ? (
            <s-section heading={`Safety Gate Matches (${warnings.length})`}>
              <s-stack gap="large">
                {warnings.map((warning: any, index: number) => (
                  <WarningCard
                    key={`warning-${index}`}
                    warning={warning}
                    index={index}
                    onImageClick={setSelectedImage}
                    getWarningImages={getWarningImages}
                  />
                ))}
              </s-stack>
            </s-section>
          ) : (
            <s-banner tone="success" heading="No Safety Gate Matches">
              <s-text>This product did not match any entries in the EU Safety Gate database.</s-text>
            </s-banner>
          )}
        </s-stack>

        {/* Footer Actions */}
        {alert.status === "active" && (
          <>
            <s-button
              ref={dismissBtnRef}
              slot="secondary-actions"
              variant="secondary"
              commandFor={modalId}
              command="--hide"
              loading={isLoading || undefined}
            >
              Dismiss Alert
            </s-button>
            <s-button
              ref={resolveBtnRef}
              slot="primary-action"
              variant="primary"
              commandFor={modalId}
              command="--hide"
              loading={isLoading || undefined}
            >
              Mark as Resolved
            </s-button>
          </>
        )}
        {(alert.status === "dismissed" || alert.status === "resolved") && (
          <s-button
            ref={reactivateBtnRef}
            slot="secondary-actions"
            variant="secondary"
            commandFor={modalId}
            command="--hide"
            loading={isLoading || undefined}
          >
            Reactivate
          </s-button>
        )}
        <s-button
          slot="secondary-actions"
          variant="secondary"
          commandFor={modalId}
          command="--hide"
        >
          Close
        </s-button>
      </s-modal>

      {/* Image Lightbox Overlay */}
      {selectedImage && typeof document !== 'undefined' && createPortal(
        <div
          className="image-lightbox-overlay"
          onClick={closeLightbox}
        >
          <div
            className="image-lightbox-content"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="image-lightbox-close"
              onClick={closeLightbox}
              aria-label="Close"
              type="button"
            >
              ×
            </button>
            <img
              src={selectedImage}
              alt="Alert image enlarged"
              className="image-lightbox-image"
            />
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// Warning card with full details and images
function WarningCard({
  warning,
  index,
  onImageClick,
  getWarningImages,
}: {
  warning: any;
  index: number;
  onImageClick: (src: string) => void;
  getWarningImages: (warning: any) => any[];
}) {
  const fields = warning.alertDetails?.fields || {};
  const meta = warning.alertDetails?.meta || {};
  const alertDate = fields.alert_date || meta.alert_date;
  const formattedDate = alertDate
    ? new Date(alertDate).toLocaleDateString("en-GB")
    : "—";
  const warningSimilarity = warning.similarity ?? 0;
  const pictures = getWarningImages(warning);

  // Get correct field names from Safety Gate database
  const notifyingCountry = fields.alert_country || fields.notifying_country;
  const originCountry = fields.product_country || fields.country_of_origin;
  const productName = fields.product_name || fields.name;
  const productModel = fields.product_model_type || fields.product_model || fields.model;

  return (
    <s-box
      padding="large"
      borderColor={warningSimilarity >= 80 ? "border-critical" : warningSimilarity >= 60 ? "border-warning" : "border"}
      borderWidth="base"
      borderRadius="large"
      background="bg-surface"
    >
      <s-stack gap="base">
        {/* Header with badges and link */}
        <s-stack direction="inline" align="space-between" blockAlign="center" wrap>
          <s-stack direction="inline" gap="small" wrap>
            <s-badge
              tone={warningSimilarity >= 80 ? "critical" : warningSimilarity >= 60 ? "warning" : "info"}
            >
              {warningSimilarity}% match
            </s-badge>
            <AlertBadge
              alertLevel={fields.alert_level}
              alertType={fields.alert_type}
              riskDescription={warning.riskLegalProvision}
            />
            {fields.product_category && (
              <s-badge>{fields.product_category}</s-badge>
            )}
          </s-stack>
          {fields.rapex_url && (
            <s-link href={fields.rapex_url} target="_blank">
              Open in Safety Gate ↗
            </s-link>
          )}
        </s-stack>

        {/* Alert number header */}
        {fields.alert_number && (
          <s-text tone="subdued" size="small">Alert number: {fields.alert_number}</s-text>
        )}

        {/* Match Reason - highlighted */}
        {warning.reason && (
          <s-box
            padding="base"
            borderRadius="base"
            borderColor="border-info"
            borderWidth="base"
            background="bg-surface-info"
          >
            <s-stack gap="small-200">
              <s-stack direction="inline" gap="small" blockAlign="center">
                <s-text fontWeight="bold" tone="info">Why this matched</s-text>
              </s-stack>
              <s-text>{warning.reason}</s-text>
            </s-stack>
          </s-box>
        )}

        {/* Main content: Image + Details table */}
        <s-stack direction="inline" gap="large" blockAlign="start" wrap>
          {/* Images - all in one row */}
          {pictures.length > 0 && (
            <s-stack direction="inline" gap="small" wrap style={{ flexShrink: 0 }}>
              {pictures.slice(0, 6).map((pic: any, idx: number) => {
                const src = typeof pic === "string" ? pic : pic?.url || pic?.src;
                if (!src) return null;
                return (
                  <div
                    key={`${src}-${idx}`}
                    onClick={() => onImageClick(src)}
                    className="alert-image-clickable"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onImageClick(src);
                    }}
                  >
                    <s-thumbnail src={src} alt={`Reference ${idx + 1}`} size="large" />
                  </div>
                );
              })}
            </s-stack>
          )}

          {/* Details table */}
          <s-box style={{ flex: 1, minWidth: "280px" }}>
            <s-section padding="none">
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary"></s-table-header>
                  <s-table-header listSlot="secondary"></s-table-header>
                </s-table-header-row>
                <s-table-body>
                  <s-table-row>
                    <s-table-cell>Risk Level</s-table-cell>
                    <s-table-cell>{fields.alert_level || "—"}</s-table-cell>
                  </s-table-row>
                  {productName && (
                    <s-table-row>
                      <s-table-cell>Product Name</s-table-cell>
                      <s-table-cell>{productName}</s-table-cell>
                    </s-table-row>
                  )}
                  {fields.product_brand && (
                    <s-table-row>
                      <s-table-cell>Brand</s-table-cell>
                      <s-table-cell>{fields.product_brand}</s-table-cell>
                    </s-table-row>
                  )}
                  {productModel && (
                    <s-table-row>
                      <s-table-cell>Model / Type</s-table-cell>
                      <s-table-cell>{productModel}</s-table-cell>
                    </s-table-row>
                  )}
                  <s-table-row>
                    <s-table-cell>Category</s-table-cell>
                    <s-table-cell>{fields.product_category || "—"}</s-table-cell>
                  </s-table-row>
                  {notifyingCountry && (
                    <s-table-row>
                      <s-table-cell>Notifying Country</s-table-cell>
                      <s-table-cell>{notifyingCountry}</s-table-cell>
                    </s-table-row>
                  )}
                  {originCountry && (
                    <s-table-row>
                      <s-table-cell>Country of Origin</s-table-cell>
                      <s-table-cell>{originCountry}</s-table-cell>
                    </s-table-row>
                  )}
                  <s-table-row>
                    <s-table-cell>Alert Date</s-table-cell>
                    <s-table-cell>{formattedDate}</s-table-cell>
                  </s-table-row>
                  {fields.alert_type && (
                    <s-table-row>
                      <s-table-cell>Risk Type</s-table-cell>
                      <s-table-cell>{fields.alert_type}</s-table-cell>
                    </s-table-row>
                  )}
                </s-table-body>
              </s-table>
            </s-section>
          </s-box>
        </s-stack>

        {/* Description */}
        {fields.product_description && (
          <s-box
            padding="base"
            borderRadius="base"
            background="bg-surface-secondary"
          >
            <s-stack gap="small-200">
              <s-text tone="subdued" size="small">Product Description</s-text>
              <s-text>{fields.product_description}</s-text>
            </s-stack>
          </s-box>
        )}

        {/* Risk description */}
        {fields.alert_description && (
          <s-box
            padding="base"
            borderRadius="base"
            background="bg-surface-critical"
          >
            <s-stack gap="small-200">
              <s-text tone="subdued" size="small">Risk Description</s-text>
              <s-text>{fields.alert_description}</s-text>
            </s-stack>
          </s-box>
        )}

        {/* Risk Legal Provision */}
        {fields.risk_legal_provision && (
          <s-banner tone="warning" heading="Legal Provision">
            <s-text>{fields.risk_legal_provision}</s-text>
          </s-banner>
        )}
      </s-stack>
    </s-box>
  );
}
