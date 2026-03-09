import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { AlertBadge } from "./AlertBadge";
import { RiskMeter } from "./RiskMeter";
import { StatusBadge } from "./StatusBadge";
import type { ResolutionType } from "./AlertTable";

interface AlertDetailModalProps {
  alert: any;
  modalId: string;
  onDismiss?: (alertId: string, resolutionType?: ResolutionType) => void;
  onResolve?: (alertId: string, resolutionType?: ResolutionType) => void;
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
  const { t } = useTranslation();
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const reactivateBtnRef = useRef<HTMLElement>(null);
  
  // Refs for resolve action buttons
  const verifiedSafeBtnRef = useRef<HTMLElement>(null);
  const removedFromSaleBtnRef = useRef<HTMLElement>(null);
  const modifiedProductBtnRef = useRef<HTMLElement>(null);
  const contactedSupplierBtnRef = useRef<HTMLElement>(null);
  
  // Refs for dismiss action buttons
  const falsePositiveBtnRef = useRef<HTMLElement>(null);
  const notMyProductBtnRef = useRef<HTMLElement>(null);
  
  const resolveMenuId = `modal-resolve-menu-${modalId}`;

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

  // Resolve action handlers
  useEffect(() => {
    if (!alert) return;
    
    const handlers = [
      { ref: verifiedSafeBtnRef, type: 'verified_safe' as ResolutionType, action: onResolve },
      { ref: removedFromSaleBtnRef, type: 'removed_from_sale' as ResolutionType, action: onResolve },
      { ref: modifiedProductBtnRef, type: 'modified_product' as ResolutionType, action: onResolve },
      { ref: contactedSupplierBtnRef, type: 'contacted_supplier' as ResolutionType, action: onResolve },
      { ref: falsePositiveBtnRef, type: 'false_positive' as ResolutionType, action: onDismiss },
      { ref: notMyProductBtnRef, type: 'not_my_product' as ResolutionType, action: onDismiss },
    ];
    
    const cleanups: (() => void)[] = [];
    
    handlers.forEach(({ ref, type, action }) => {
      const btn = ref.current;
      if (!btn) return;
      const handleClick = () => action?.(alert.id, type);
      btn.addEventListener('click', handleClick);
      cleanups.push(() => btn.removeEventListener('click', handleClick));
    });
    
    return () => cleanups.forEach(cleanup => cleanup());
  }, [alert, onResolve, onDismiss]);

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
  const analysis = parsed?.analysis ?? null;
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
          
          {/* ═══════════════════════════════════════════════════════════════
              SECTION 1: YOUR PRODUCT
          ═══════════════════════════════════════════════════════════════ */}
          <s-box padding="large" borderRadius="large" background="bg-surface-secondary">
            <s-stack gap="base">
              {/* Section Label */}
              <s-text tone="subdued" fontWeight="bold" size="small">YOUR PRODUCT</s-text>
              
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
                <s-stack gap="small" style={{ flex: 1, minWidth: 0 }}>
                  <s-heading size="large">{alert.productTitle}</s-heading>
                  
                  <s-stack direction="inline" gap="small" wrap>
                    <StatusBadge status={alert.status} />
                    <AlertBadge
                      alertLevel={alert.riskLevel}
                      alertType={alert.alertType}
                      riskDescription={alert.riskDescription}
                    />
                  </s-stack>
                  
                  {checkedAt && (
                    <s-text tone="subdued" size="small">
                      {t("analysis.checkedAt", { date: checkedAt.toLocaleString("en-GB") })}
                    </s-text>
                  )}

                  {analysis && (
                    <s-stack direction="inline" gap="small" wrap>
                      <s-badge tone={analysis.mode === "with-image" ? "info" : "neutral"}>
                        {analysis.mode === "with-image" ? t("analysis.withImage") : t("analysis.textOnly")}
                      </s-badge>
                      <s-badge tone="info">
                        {t("analysis.productImagesUsed", {
                          used: analysis.productImagesUsed || 0,
                          provided: analysis.productImagesProvided || 0,
                        })}
                      </s-badge>
                      <s-badge tone="info">
                        {t("analysis.alertImagesUsed", { count: analysis.alertImagesUsed || 0 })}
                      </s-badge>
                    </s-stack>
                  )}
                </s-stack>
              </s-stack>
            </s-stack>
          </s-box>

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 2: RISK ASSESSMENT SUMMARY
          ═══════════════════════════════════════════════════════════════ */}
          <s-box
            padding="large"
            borderRadius="large"
            borderWidth="base"
            borderColor={isSafe ? "border-success" : "border-critical"}
            background={isSafe ? "bg-surface-success" : "bg-surface-critical"}
          >
            <s-stack gap="base">
              {/* Header */}
              <s-stack direction="inline" gap="small" blockAlign="center">
                <s-text size="large" fontWeight="bold">
                  {isSafe ? "✅" : "⚠️"} {isSafe ? "No Safety Issues Found" : "Potential Safety Risk"}
                </s-text>
              </s-stack>
              
              {/* Stats Row */}
              <s-stack direction="inline" gap="large" wrap>
                <s-stack gap="small-100">
                  <s-text tone="subdued" size="small">Safety Gate Matches</s-text>
                  <s-text size="large" fontWeight="bold">{warningsCount}</s-text>
                </s-stack>
                
                {similarity !== null && (
                  <s-stack gap="small-100">
                    <s-text tone="subdued" size="small">Highest Match</s-text>
                    <s-text size="large" fontWeight="bold">{similarity}%</s-text>
                  </s-stack>
                )}

                {analysis && (
                  <s-stack gap="small-100">
                    <s-text tone="subdued" size="small">{t("analysis.candidateAlerts")}</s-text>
                    <s-text size="large" fontWeight="bold">{analysis.candidateAlertsConsidered || 0}</s-text>
                  </s-stack>
                )}
                
                <s-stack gap="small-100">
                  <s-text tone="subdued" size="small">Risk Level</s-text>
                  <AlertBadge
                    alertLevel={alert.riskLevel}
                    alertType={alert.alertType}
                    riskDescription={alert.riskDescription}
                  />
                </s-stack>
              </s-stack>
              
              {/* Risk Meter */}
              <RiskMeter riskLevel={alert.riskLevel} similarity={similarity} />
              
              {/* Recommendation */}
              <s-text>{recommendation}</s-text>
            </s-stack>
          </s-box>

          {/* Notes Section */}
          {alert.notes && (
            <s-banner tone="info" heading="Internal Notes">
              <s-text>{alert.notes}</s-text>
            </s-banner>
          )}

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 3: SAFETY GATE MATCHES
          ═══════════════════════════════════════════════════════════════ */}
          {warnings.length > 0 && (
            <s-stack gap="base">
              <s-text tone="subdued" fontWeight="bold" size="small">
                SAFETY GATE MATCHES ({warnings.length})
              </s-text>
              
              <s-stack gap="base">
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
            </s-stack>
          )}
        </s-stack>

        {/* Footer Actions */}
        {alert.status === "active" && (
          <>
            <s-button
              slot="primary-action"
              variant="primary"
              icon="caret-down"
              commandFor={resolveMenuId}
              loading={isLoading || undefined}
            >
              {t('actions.resolve')}
            </s-button>
            <s-menu id={resolveMenuId} accessibilityLabel={t('resolveActions.menuLabel')}>
              <s-section heading={t('resolveActions.actionTaken')}>
                <s-button ref={verifiedSafeBtnRef} icon="check-circle" commandFor={modalId} command="--hide">
                  {t('resolveActions.verifiedSafe')}
                </s-button>
                <s-button ref={removedFromSaleBtnRef} icon="delete" commandFor={modalId} command="--hide">
                  {t('resolveActions.removedFromSale')}
                </s-button>
                <s-button ref={modifiedProductBtnRef} icon="edit" commandFor={modalId} command="--hide">
                  {t('resolveActions.modifiedProduct')}
                </s-button>
                <s-button ref={contactedSupplierBtnRef} icon="email" commandFor={modalId} command="--hide">
                  {t('resolveActions.contactedSupplier')}
                </s-button>
              </s-section>
              <s-section heading={t('resolveActions.noActionNeeded')}>
                <s-button ref={falsePositiveBtnRef} icon="x-circle" commandFor={modalId} command="--hide">
                  {t('resolveActions.falsePositive')}
                </s-button>
                <s-button ref={notMyProductBtnRef} icon="product-unavailable" commandFor={modalId} command="--hide">
                  {t('resolveActions.notMyProduct')}
                </s-button>
              </s-section>
            </s-menu>
          </>
        )}
        {(alert.status === "dismissed" || alert.status === "resolved") && (
          <s-button
            ref={reactivateBtnRef}
            slot="secondary-actions"
            variant="secondary"
            icon="undo"
            commandFor={modalId}
            command="--hide"
            loading={isLoading || undefined}
          >
            {t('actions.reactivate')}
          </s-button>
        )}
        <s-button
          slot="secondary-actions"
          variant="secondary"
          commandFor={modalId}
          command="--hide"
        >
          {t('common.cancel')}
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
              alt="Enlarged safety alert"
              className="image-lightbox-image"
            />
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// WARNING CARD - Individual Safety Gate match
// ═══════════════════════════════════════════════════════════════════════════
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

  // Determine card border color based on similarity
  const borderColor = warningSimilarity >= 80 ? "border-critical" : warningSimilarity >= 60 ? "border-warning" : "border";
  const matchTone = warningSimilarity >= 80 ? "critical" : warningSimilarity >= 60 ? "warning" : "info";

  return (
    <s-box
      padding="large"
      borderColor={borderColor}
      borderWidth="base"
      borderRadius="large"
      background="bg-surface"
    >
      <s-stack gap="base">
        
        {/* ─────────────────────────────────────────────────────────────
            HEADER: Match percentage + badges + link
        ───────────────────────────────────────────────────────────── */}
        <s-stack direction="inline" align="space-between" blockAlign="center" wrap>
          <s-stack direction="inline" gap="small" wrap blockAlign="center">
            <s-badge tone={matchTone} size="large">
              {warningSimilarity}% match
            </s-badge>
            <AlertBadge
              alertLevel={fields.alert_level}
              alertType={fields.alert_type}
              riskDescription={warning.riskLegalProvision}
            />
          </s-stack>
          
          {fields.rapex_url && (
            <s-link href={fields.rapex_url} target="_blank">
              View on Safety Gate ↗
            </s-link>
          )}
        </s-stack>

        {/* Alert number */}
        {fields.alert_number && (
          <s-text tone="subdued" size="small">
            Alert: {fields.alert_number} • {formattedDate}
          </s-text>
        )}

        {/* ─────────────────────────────────────────────────────────────
            WHY THIS MATCHED (highlighted box)
        ───────────────────────────────────────────────────────────── */}
        {warning.reason && (
          <s-box
            padding="base"
            borderRadius="base"
            background="bg-surface-info"
          >
            <s-stack gap="small-100">
              <s-text fontWeight="bold" tone="info" size="small">💡 WHY THIS MATCHED</s-text>
              <s-text>{warning.reason}</s-text>
            </s-stack>
          </s-box>
        )}

        {/* ─────────────────────────────────────────────────────────────
            MAIN CONTENT: Images + Details side by side
        ───────────────────────────────────────────────────────────── */}
        <s-grid gap="large" gridTemplateColumns="auto 1fr">
          {/* Images Column */}
          {pictures.length > 0 && (
            <s-stack direction="inline" gap="small" wrap style={{ maxWidth: '200px' }}>
              {pictures.slice(0, 4).map((pic: any, idx: number) => {
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

          {/* Details Table */}
          <s-box style={{ flex: 1 }}>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Field</s-table-header>
                <s-table-header listSlot="secondary">Value</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {productName && (
                  <s-table-row>
                    <s-table-cell><s-text tone="subdued">Product Name</s-text></s-table-cell>
                    <s-table-cell><s-text fontWeight="semibold">{productName}</s-text></s-table-cell>
                  </s-table-row>
                )}
                {fields.product_brand && (
                  <s-table-row>
                    <s-table-cell><s-text tone="subdued">Brand</s-text></s-table-cell>
                    <s-table-cell>{fields.product_brand}</s-table-cell>
                  </s-table-row>
                )}
                {productModel && (
                  <s-table-row>
                    <s-table-cell><s-text tone="subdued">Model</s-text></s-table-cell>
                    <s-table-cell>{productModel}</s-table-cell>
                  </s-table-row>
                )}
                {fields.product_category && (
                  <s-table-row>
                    <s-table-cell><s-text tone="subdued">Category</s-text></s-table-cell>
                    <s-table-cell>{fields.product_category}</s-table-cell>
                  </s-table-row>
                )}
                {notifyingCountry && (
                  <s-table-row>
                    <s-table-cell><s-text tone="subdued">Notifying Country</s-text></s-table-cell>
                    <s-table-cell>{notifyingCountry}</s-table-cell>
                  </s-table-row>
                )}
                {originCountry && (
                  <s-table-row>
                    <s-table-cell><s-text tone="subdued">Origin</s-text></s-table-cell>
                    <s-table-cell>{originCountry}</s-table-cell>
                  </s-table-row>
                )}
                <s-table-row>
                  <s-table-cell><s-text tone="subdued">Alert Date</s-text></s-table-cell>
                  <s-table-cell>{formattedDate}</s-table-cell>
                </s-table-row>
                {fields.alert_level && (
                  <s-table-row>
                    <s-table-cell><s-text tone="subdued">Risk Level</s-text></s-table-cell>
                    <s-table-cell>
                      <AlertBadge alertLevel={fields.alert_level} alertType={fields.alert_type} />
                    </s-table-cell>
                  </s-table-row>
                )}
              </s-table-body>
            </s-table>
          </s-box>
        </s-grid>

        {/* ─────────────────────────────────────────────────────────────
            RISK DESCRIPTION (if present)
        ───────────────────────────────────────────────────────────── */}
        {fields.alert_description && (
          <s-box
            padding="base"
            borderRadius="base"
            background="bg-surface-critical"
          >
            <s-stack gap="small-100">
              <s-text fontWeight="bold" tone="critical" size="small">⚠️ RISK DESCRIPTION</s-text>
              <s-text>{fields.alert_description}</s-text>
            </s-stack>
          </s-box>
        )}

        {/* Product Description (collapsible feel) */}
        {fields.product_description && (
          <s-box padding="base" borderRadius="base" background="bg-surface-secondary">
            <s-stack gap="small-100">
              <s-text tone="subdued" size="small">Product Description</s-text>
              <s-text size="small">{fields.product_description}</s-text>
            </s-stack>
          </s-box>
        )}

        {/* Legal Provision */}
        {fields.risk_legal_provision && (
          <s-box padding="base" borderRadius="base" background="bg-surface-warning">
            <s-stack gap="small-100">
              <s-text fontWeight="bold" tone="warning" size="small">📋 LEGAL PROVISION</s-text>
              <s-text size="small">{fields.risk_legal_provision}</s-text>
            </s-stack>
          </s-box>
        )}
      </s-stack>
    </s-box>
  );
}
