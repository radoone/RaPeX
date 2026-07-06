import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { AlertBadge, cleanRiskLabel } from "./AlertBadge";
import { StatusBadge } from "./StatusBadge";
import type { ResolutionType } from "./AlertTable";

// Helper to highlight matched words
function HighlightedText({ text, query, tone = "info" }: { text: string; query?: string; tone?: string }) {
  if (!query || !text) return <>{text}</>;
  
  const words = query.split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return <>{text}</>;
  
  const regex = new RegExp(`(${words.join('|')})`, 'gi');
  const parts = text.split(regex);
  
  return (
    <>
      {parts.map((part, i) => 
        regex.test(part) ? (
          <s-text key={i} fontWeight="bold" tone={tone} style={{ backgroundColor: 'var(--s-surface-highlight)', padding: '0 2px', borderRadius: '2px' }}>
            {part}
          </s-text>
        ) : part
      )}
    </>
  );
}

interface AlertDetailModalProps {
  alert: any;
  modalId: string;
  onDismiss?: (alertId: string, resolutionType?: ResolutionType, notes?: string) => void;
  onResolve?: (alertId: string, resolutionType?: ResolutionType, notes?: string) => void;
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
  const [auditNote, setAuditNote] = useState("");
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const lightboxDialogRef = useRef<HTMLDialogElement>(null);
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

  useEffect(() => {
    const dialog = lightboxDialogRef.current;
    if (!dialog) return;

    if (selectedImage) {
      if (!dialog.open) {
        dialog.showModal();
      }
      return;
    }

    if (dialog.open) {
      dialog.close();
    }
  }, [selectedImage]);

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
      const handleClick = () => action?.(alert.id, type, auditNote.trim() || undefined);
      btn.addEventListener('click', handleClick);
      cleanups.push(() => btn.removeEventListener('click', handleClick));
    });
    
    return () => cleanups.forEach(cleanup => cleanup());
  }, [alert, onResolve, onDismiss, auditNote]);

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
  const primaryFields = primaryWarning?.alertDetails?.fields || {};
  const supplierFollowUp = t("analysis.supplierFollowUp.template", {
    product: alert.productTitle,
    alert: primaryFields.alert_number || primaryWarning?.alertId || t("common.unknown"),
    risk: primaryFields.alert_level || primaryFields.risk_level || alert.riskLevel || t("common.unknown"),
    reason: primaryWarning?.reason || recommendation,
  });

  const matchKeywords = [
    primaryFields.product_brand,
    primaryFields.product_model,
    primaryFields.product_name,
  ].filter(Boolean).join(' ');

  const overallSimilarity = typeof primaryWarning?.overallSimilarity === "number"
    ? primaryWarning.overallSimilarity
    : null;
  const imageSimilarity = typeof primaryWarning?.imageSimilarity === "number"
    ? primaryWarning.imageSimilarity
    : null;
  const hasActiveRisk = alert.status === "active" && !isSafe;
  const hasActiveSafeState = alert.status === "active" && isSafe;
  const confidenceLabel = overallSimilarity == null
    ? t("analysis.summary.confidenceUnknown")
    : overallSimilarity >= 90
      ? t("analysis.summary.highConfidence")
      : overallSimilarity >= 70
        ? t("analysis.summary.likelyMatch")
        : t("analysis.summary.reviewRecommended");
  const focusVariant = hasActiveRisk
    ? "critical"
    : hasActiveSafeState
      ? "safe"
      : "reviewed";
  const merchantRecommendation = hasActiveRisk
    ? t("analysis.merchantRecommendation.active")
    : hasActiveSafeState
      ? t("analysis.merchantRecommendation.safe")
      : t("analysis.merchantRecommendation.reviewed");
  const recordedResolution = alert.resolutionType
    ? t(`resolveActions.${{
        verified_safe: "verifiedSafe",
        removed_from_sale: "removedFromSale",
        modified_product: "modifiedProduct",
        contacted_supplier: "contactedSupplier",
        false_positive: "falsePositive",
        not_my_product: "notMyProduct",
      }[alert.resolutionType as string] || "menuLabel"}`)
    : t("analysis.summary.decisionRecorded");

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
      <s-modal id={modalId} heading={t("analysis.modalHeading")} size="large" suppressHydrationWarning>
        <div className="alert-detail-layout">
          
          {/* COLUMN 1: YOUR PRODUCT & RISK ASSESSMENT */}
          <div className="alert-detail-column alert-detail-column--product">
            
            {/* Your Product */}
            <s-box padding="large" borderRadius="large" background="bg-surface-secondary">
              <s-stack gap="base">
                <s-text tone="subdued" fontWeight="bold" size="small">{t("analysis.yourProduct")}</s-text>
                
                <s-stack direction="inline" gap="large" blockAlign="start" wrap>
                  {/* Product Image */}
                  {alert.productImage && (
                    <div
                      onClick={() => setSelectedImage(alert.productImage)}
                      className="alert-image-clickable alert-image-clickable--product"
                      role="button"
                      tabIndex={0}
                      aria-label={t("analysis.openProductImage", { title: alert.productTitle })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedImage(alert.productImage);
                        }
                      }}
                      style={{ flexShrink: 0 }}
                    >
                      <img
                        src={alert.productImage}
                        alt={alert.productTitle}
                        className="alert-product-image"
                      />
                    </div>
                  )}

                  {/* Product Info */}
                  <s-stack gap="small" style={{ flex: 1, minWidth: 0 }}>
                    <s-heading size="large">
                      <HighlightedText text={alert.productTitle} query={matchKeywords} tone="critical" />
                    </s-heading>
                    
                    <s-stack direction="inline" gap="small" wrap>
                      <StatusBadge status={alert.status} />
                      <AlertBadge
                        alertLevel={alert.riskLevel}
                        alertType={alert.alertType}
                        riskDescription={alert.riskDescription}
                      />
                    </s-stack>

                    {/* Direct link to Edit Product in Shopify Admin */}
                    <div style={{ marginTop: "6px" }}>
                      <s-link href={`https://${alert.shop}/admin/products/${alert.productId}`} target="_blank">
                        {t("analysis.editInShopify")}
                      </s-link>
                    </div>
                    
                    {checkedAt && (
                      <s-text tone="subdued" size="small">
                        {t("analysis.checkedAt", { date: checkedAt.toLocaleString("en-GB") })}
                      </s-text>
                    )}

                    {analysis && (
                      <s-badge tone={analysis.mode === "with-image" ? "info" : "neutral"}>
                        {analysis.mode === "with-image" ? t("analysis.withImage") : t("analysis.textOnly")}
                      </s-badge>
                    )}
                  </s-stack>
                </s-stack>
              </s-stack>
            </s-box>

            {/* Decision Summary */}
            <div className="alert-decision-summary">
              <div className="alert-decision-summary__item">
                <span>{t("analysis.summary.overallMatch")}</span>
                <strong>{overallSimilarity !== null ? t("analysis.overallMatchShort", { count: overallSimilarity }) : t("common.unknown")}</strong>
              </div>
              <div className="alert-decision-summary__item">
                <span>{t("analysis.summary.confidence")}</span>
                <strong>{confidenceLabel}</strong>
              </div>
              <div className={`alert-decision-summary__item${hasActiveRisk ? " alert-decision-summary__item--critical" : ""}`}>
                <span>{t("analysis.summary.nextStep")}</span>
                <strong>{hasActiveRisk ? t("analysis.summary.decisionRequired") : t("analysis.summary.decisionRecorded")}</strong>
              </div>
            </div>

            {/* Risk Assessment Summary */}
            <s-box
              padding="large"
              borderRadius="large"
              borderWidth="base"
              borderColor={hasActiveRisk ? "border-critical" : hasActiveSafeState ? "border-success" : "border"}
              background={hasActiveRisk ? "bg-surface-critical" : hasActiveSafeState ? "bg-surface-success" : "bg-surface-secondary"}
            >
              <s-stack gap="base">
                <s-stack gap="small-100">
                  <s-text tone="subdued" fontWeight="bold" size="small">
                    {t("analysis.sections.whatHappened")}
                  </s-text>
                  <s-text size="large" fontWeight="bold">
                    {hasActiveRisk
                      ? t("analysis.potentialRisk")
                      : hasActiveSafeState
                        ? t("analysis.noIssuesFound")
                        : t("analysis.decisionRecorded")}
                  </s-text>
                  <s-text>
                    {hasActiveRisk
                      ? t("analysis.sections.whatHappenedRisk")
                      : hasActiveSafeState
                        ? t("analysis.sections.whatHappenedSafe")
                        : t("analysis.sections.whatHappenedReviewed")}
                  </s-text>
                </s-stack>

                <s-stack gap="small-100">
                  <s-text tone="subdued" fontWeight="bold" size="small">
                    {t("analysis.sections.whatToDo")}
                  </s-text>
                  <s-text>{merchantRecommendation}</s-text>
                  {hasActiveRisk && (
                    <s-button
                      variant="secondary"
                      size="small"
                      onClick={() => navigator.clipboard?.writeText(supplierFollowUp)}
                    >
                      {t("analysis.supplierFollowUp.copy")}
                    </s-button>
                  )}
                </s-stack>

                <div className={`alert-focus-card alert-focus-card--${focusVariant}`}>
                  <p className="alert-focus-card__title">
                    {hasActiveRisk
                      ? t("analysis.focus.criticalTitle")
                      : hasActiveSafeState
                        ? t("analysis.focus.safeTitle")
                        : t("analysis.focus.reviewedTitle")}
                  </p>
                  <p className="alert-focus-card__lead">
                    {hasActiveRisk
                      ? t("analysis.focus.criticalLead")
                      : hasActiveSafeState
                        ? t("analysis.focus.safeLead")
                        : t("analysis.focus.reviewedLead")}
                  </p>
                  {!hasActiveRisk && !hasActiveSafeState && (
                    <p className="alert-focus-card__resolution">
                      {t("analysis.focus.recordedOutcome", { outcome: recordedResolution })}
                    </p>
                  )}
                  <ol className="alert-focus-card__steps">
                    {hasActiveRisk ? (
                      <>
                        <li>{t("analysis.focus.criticalStepCompare")}</li>
                        <li>{t("analysis.focus.criticalStepDecide")}</li>
                        <li>{t("analysis.focus.criticalStepDocument")}</li>
                      </>
                    ) : hasActiveSafeState ? (
                      <>
                        <li>{t("analysis.focus.safeStepMonitor")}</li>
                        <li>{t("analysis.focus.safeStepRecheck")}</li>
                        <li>{t("analysis.focus.safeStepClose")}</li>
                      </>
                    ) : (
                      <>
                        <li>{t("analysis.focus.reviewedStepAudit")}</li>
                        <li>{t("analysis.focus.reviewedStepReactivate")}</li>
                      </>
                    )}
                  </ol>
                </div>
                
                {/* Stats Row */}
                <s-stack direction="inline" gap="large" wrap>
                  <s-stack gap="small-100">
                    <s-text tone="subdued" size="small">{t("analysis.safetyGateMatches")}</s-text>
                    <s-text size="large" fontWeight="bold">{warningsCount}</s-text>
                  </s-stack>
                  
                  <s-stack gap="small-100">
                    <s-text tone="subdued" size="small">{t("analysis.riskLevel")}</s-text>
                    <AlertBadge
                      alertLevel={alert.riskLevel}
                      alertType={alert.alertType}
                      riskDescription={alert.riskDescription}
                    />
                  </s-stack>
                </s-stack>
                
                {hasActiveRisk && (
                  <s-text tone="subdued" size="small">
                    {t("analysis.primaryRiskFocus", {
                      category: cleanRiskLabel(primaryFields.alert_type || alert.alertType || t("common.unknown")),
                      level: cleanRiskLabel(primaryFields.alert_level || primaryFields.risk_level || alert.riskLevel || t("common.unknown")),
                    })}
                  </s-text>
                )}

                {analysis && (
                  <s-box padding="base" borderRadius="base" background="bg-surface-secondary">
                    <s-stack gap="small">
                      <s-stack direction="inline" align="space-between" blockAlign="center" wrap>
                        <s-text fontWeight="bold">{t("analysis.technicalDetails.title")}</s-text>
                        <s-button
                          variant="tertiary"
                          size="small"
                          onClick={() => setShowTechnicalDetails((visible) => !visible)}
                        >
                          {showTechnicalDetails
                            ? t("analysis.technicalDetails.hide")
                            : t("analysis.technicalDetails.show")}
                        </s-button>
                      </s-stack>
                      <s-text tone="subdued" size="small">
                        {t("analysis.technicalDetails.description")}
                      </s-text>
                      {showTechnicalDetails && (
                        <s-stack direction="inline" gap="small" wrap>
                          {overallSimilarity !== null && (
                            <s-badge tone="info">
                              {t("analysis.overallMatchShort", { count: overallSimilarity })}
                            </s-badge>
                          )}
                          {imageSimilarity !== null && (
                            <s-badge tone="info">
                              {t("analysis.imageMatchShort", { count: imageSimilarity })}
                            </s-badge>
                          )}
                          <s-badge tone="info">
                            {t("analysis.productImagesUsed", {
                              used: analysis.productImagesUsed || 0,
                              provided: analysis.productImagesProvided || 0,
                            })}
                          </s-badge>
                          <s-badge tone="info">
                            {t("analysis.alertImagesUsed", { count: analysis.alertImagesUsed || 0 })}
                          </s-badge>
                          <s-badge tone="info">
                            {t("analysis.candidateAlerts", {
                              count: analysis.candidateAlertsConsidered || 0,
                            })}
                          </s-badge>
                        </s-stack>
                      )}
                    </s-stack>
                  </s-box>
                )}
              </s-stack>
            </s-box>

            {/* Notes Section */}
            {alert.notes && (
              <s-banner tone="info" heading={t("analysis.audit.existingNotes")}>
                <s-text>{alert.notes}</s-text>
              </s-banner>
            )}
          </div>

          {/* COLUMN 2: SAFETY GATE MATCHES */}
          <div className="alert-detail-column">
            {warnings.length > 0 && (
              <s-stack gap="base">
                <s-text tone="subdued" fontWeight="bold" size="small">
                  {t("analysis.safetyGateMatches")} ({warnings.length})
                </s-text>
                <s-text tone="subdued" size="small">
                  {t("analysis.matchesHint")}
                </s-text>
                
                <s-stack gap="base">
                  {warnings.map((warning: any, index: number) => (
                    <WarningCard
                      key={`warning-${index}`}
                      warning={warning}
                      index={index}
                      onImageClick={setSelectedImage}
                      getWarningImages={getWarningImages}
                      merchantProduct={alert}
                    />
                  ))}
                </s-stack>
              </s-stack>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        {alert.status === "active" && (
          <>
            <div slot="secondary-actions" className="alert-audit-note">
              <s-text-area
                label={t("analysis.audit.noteLabel")}
                placeholder={t("analysis.audit.notePlaceholder")}
                value={auditNote}
                onInput={(event: any) => setAuditNote(event.currentTarget.value || "")}
              />
            </div>
            <s-button
              slot="primary-action"
              variant="primary"
              icon="caret-down"
              commandFor={resolveMenuId}
              loading={isLoading || undefined}
              suppressHydrationWarning
            >
              {t('actions.recordDecision')}
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
            suppressHydrationWarning
          >
            {t('actions.reactivate')}
          </s-button>
        )}
        <s-button
          slot="secondary-actions"
          variant="secondary"
          commandFor={modalId}
          command="--hide"
          suppressHydrationWarning
        >
          {t('common.cancel')}
        </s-button>
      </s-modal>

      {/* Image Lightbox (top-layer dialog so it always appears above s-modal) */}
      {typeof document !== "undefined" && createPortal(
        <dialog
          ref={lightboxDialogRef}
          className="image-lightbox-dialog"
          onClose={closeLightbox}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeLightbox();
            }
          }}
        >
          {selectedImage && (
            <div className="image-lightbox-content" onClick={(e) => e.stopPropagation()}>
              <button
                className="image-lightbox-close"
                onClick={closeLightbox}
                aria-label={t("common.close")}
                type="button"
              >
                {t("common.close")}
              </button>
              <img
                src={selectedImage}
                alt={t("analysis.enlargedSafetyAlert")}
                className="image-lightbox-image"
              />
            </div>
          )}
        </dialog>,
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
  merchantProduct,
}: {
  warning: any;
  index: number;
  onImageClick: (src: string) => void;
  getWarningImages: (warning: any) => any[];
  merchantProduct: any;
}) {
  const { t } = useTranslation();
  const fields = warning.alertDetails?.fields || {};
  const meta = warning.alertDetails?.meta || {};
  const alertDate = fields.alert_date || meta.alert_date;
  const formattedDate = alertDate
    ? new Date(alertDate).toLocaleDateString("en-GB")
    : "—";
  const warningOverallSimilarity =
    typeof warning.overallSimilarity === "number" ? warning.overallSimilarity : 0;
  const pictures = getWarningImages(warning);

  // Get correct field names from Safety Gate database
  const notifyingCountry = fields.alert_country || fields.notifying_country;
  const originCountry = fields.product_country || fields.country_of_origin;
  const productName = fields.product_name || fields.name;
  const productModel = fields.product_model_type || fields.product_model || fields.model;

  // Determine card border color based on similarity
  const borderColor = warningOverallSimilarity >= 80 ? "border-critical" : warningOverallSimilarity >= 60 ? "border-warning" : "border";
  const isImageFirst = warning.scoreBreakdown?.scoringMode === "image-first";

  // Check matching fields with merchant product details for highlighting
  const merchantTitle = String(merchantProduct?.productTitle || "").toLowerCase();
  const isBrandMatched = fields.product_brand && merchantTitle.includes(fields.product_brand.trim().toLowerCase());
  const isModelMatched = productModel && merchantTitle.includes(productModel.trim().toLowerCase());
  const isCategoryMatched = fields.product_category && merchantProduct?.productType && merchantTitle.includes(fields.product_category.trim().toLowerCase());

  return (
    <s-box
      padding="large"
      borderColor={borderColor}
      borderWidth="base"
      borderRadius="large"
      background="bg-surface"
    >
      <s-stack gap="base">
        
        {/* HEADER: Risk badges + source link */}
        <s-stack direction="inline" align="space-between" blockAlign="center" wrap>
          <s-stack direction="inline" gap="small" wrap blockAlign="center">
            <AlertBadge
              alertLevel={fields.alert_level}
              alertType={fields.alert_type}
              riskDescription={warning.riskLegalProvision}
            />
          </s-stack>
          
          {fields.rapex_url && (
            <s-link href={fields.rapex_url} target="_blank">
              {t("analysis.viewOnSafetyGate")}
            </s-link>
          )}
        </s-stack>

        {/* Alert number */}
        {fields.alert_number && (
          <s-text tone="subdued" size="small">
            {t("analysis.alertNumber", { number: fields.alert_number })} • {formattedDate}
          </s-text>
        )}

        {/* WHY THIS MATCHED (highlighted box) */}
        {warning.reason && (
          <s-box
            padding="base"
            borderRadius="base"
            background="bg-surface-info"
          >
            <s-stack gap="small-100">
              <s-text fontWeight="bold" tone="info" size="small">{t("analysis.whyThisMatched")}</s-text>
              <s-text>{warning.reason}</s-text>
              {isImageFirst && (
                <s-text tone="subdued" size="small">
                  {t("analysis.imageDominated")}
                </s-text>
              )}
            </s-stack>
          </s-box>
        )}

        {/* MAIN CONTENT: Images + Details side by side */}
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

          <div className="match-detail-list">
            {productName && <DetailItem label={t("analysis.fields.productName")} value={productName} />}
            {fields.product_brand && (
              <DetailItem label={t("analysis.fields.brand")} value={fields.product_brand} highlight={Boolean(isBrandMatched)} />
            )}
            {productModel && (
              <DetailItem label={t("analysis.fields.model")} value={productModel} highlight={Boolean(isModelMatched)} />
            )}
            {fields.product_category && (
              <DetailItem label={t("analysis.fields.category")} value={fields.product_category} highlight={Boolean(isCategoryMatched)} />
            )}
            {notifyingCountry && <DetailItem label={t("analysis.fields.notifyingCountry")} value={notifyingCountry} />}
            {originCountry && <DetailItem label={t("analysis.fields.origin")} value={originCountry} />}
            <DetailItem label={t("analysis.fields.alertDate")} value={formattedDate} />
            {fields.alert_level && (
              <div className="match-detail-list__item">
                <span>{t("analysis.riskLevel")}</span>
                <AlertBadge alertLevel={fields.alert_level} alertType={fields.alert_type} />
              </div>
            )}
          </div>
        </s-grid>

        {/* RISK DESCRIPTION (if present) */}
        {fields.alert_description && (
          <s-box
            padding="base"
            borderRadius="base"
            background="bg-surface-critical"
          >
            <s-stack gap="small-100">
              <s-text fontWeight="bold" tone="critical" size="small">{t("analysis.riskDescription")}</s-text>
              <s-text>{fields.alert_description}</s-text>
            </s-stack>
          </s-box>
        )}

        {/* Product Description */}
        {fields.product_description && (
          <s-box padding="base" borderRadius="base" background="bg-surface-secondary">
            <s-stack gap="small-100">
              <s-text tone="subdued" size="small">{t("analysis.fields.productDescription")}</s-text>
              <s-text size="small">{fields.product_description}</s-text>
            </s-stack>
          </s-box>
        )}

        {/* Legal Provision */}
        {fields.risk_legal_provision && (
          <s-box padding="base" borderRadius="base" background="bg-surface-warning">
            <s-stack gap="small-100">
              <s-text fontWeight="bold" tone="warning" size="small">{t("analysis.legalProvision")}</s-text>
              <s-text size="small">{fields.risk_legal_provision}</s-text>
            </s-stack>
          </s-box>
        )}
      </s-stack>
    </s-box>
  );
}

function DetailItem({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`match-detail-list__item ${highlight ? "match-detail-list__item--highlight" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
