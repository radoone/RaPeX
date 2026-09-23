import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { AlertBadge } from "./AlertBadge";
import { StatusBadge } from "./StatusBadge";
import type { ResolutionType } from "./AlertTable";

interface AlertDetailModalProps {
  alert: any;
  modalId: string;
  onDismiss?: (alertId: string, resolutionType?: ResolutionType, notes?: string) => void;
  onResolve?: (alertId: string, resolutionType?: ResolutionType, notes?: string) => void;
  onReactivate?: (alertId: string) => void;
  isLoading?: boolean;
  openOnMount?: boolean;
}

export function AlertDetailModal({
  alert,
  modalId,
  onDismiss,
  onResolve,
  onReactivate,
  isLoading = false,
  openOnMount = false,
}: AlertDetailModalProps) {
  const { t } = useTranslation();
  const [isHydrated, setIsHydrated] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [auditNote, setAuditNote] = useState("");
  const [selectedOutcome, setSelectedOutcome] = useState<ResolutionType | "">("");
  const lightboxDialogRef = useRef<HTMLDialogElement>(null);
  const reactivateBtnRef = useRef<HTMLElement>(null);

  // Polaris upgrades modal custom elements in the browser. Keeping this client-only
  // gives React identical server and first-client markup instead of hiding a mismatch.
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated || !openOnMount || !alert) return;
    const triggerOpen = () => {
      const modal = document.getElementById(modalId) as HTMLElement & { showOverlay?: () => void; show?: () => void };
      if (modal?.showOverlay) {
        modal.showOverlay();
      } else if (modal?.show) {
        modal.show();
      }
      const triggerBtn = document.querySelector(`[commandFor="${modalId}"]`) as HTMLElement;
      triggerBtn?.click();
    };
    triggerOpen();
    const timer = setTimeout(triggerOpen, 150);
    return () => clearTimeout(timer);
  }, [alert, isHydrated, modalId, openOnMount]);

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

  useEffect(() => {
    setSelectedOutcome("");
    setAuditNote("");
  }, [alert?.id]);

  // Handle reactivate button click
  useEffect(() => {
    const btn = reactivateBtnRef.current;
    if (!btn || !alert) return;

    const handleClick = () => onReactivate?.(alert.id);
    btn.addEventListener('click', handleClick);
    return () => btn.removeEventListener('click', handleClick);
  }, [alert, onReactivate]);

  if (!alert || !isHydrated) return null;

  const warnings: any[] = Array.isArray(parsed?.warnings) ? parsed.warnings : [];
  const primaryWarning = warnings[0];
  const fields = primaryWarning?.alertDetails?.fields || {};
  const pictures = primaryWarning ? getWarningImages(primaryWarning) : [];
  const firstPicture = pictures[0];
  const safetyImage = typeof firstPicture === "string" ? firstPicture : firstPicture?.url || firstPicture?.src;
  const safetyBrand = fields.brand || fields.product_brand;
  const safetyModel = fields.type_numberOfModel || fields.product_model_type || fields.product_model || fields.model;
  const safetyCategory = fields.category || fields.product_category;
  const safetyTitle = fields.name || fields.product || fields.product_name || [safetyBrand, safetyCategory].filter(Boolean).join(" · ") || t("analysis.reviewLayout.unnamedRecord");
  const caseNumber = fields.caseNumber || fields.alert_number || primaryWarning?.alertId;
  const safetyUrl = fields.url || fields.rapex_url || fields.reference;
  const isSafe = parsed?.isSafe === true;
  const overallSimilarity = typeof primaryWarning?.overallSimilarity === "number" ? primaryWarning.overallSimilarity : null;
  const imageSimilarity = typeof primaryWarning?.imageSimilarity === "number" ? primaryWarning.imageSimilarity : null;
  const isActive = alert.status === "active";
  const isDismissOutcome = selectedOutcome === "false_positive" || selectedOutcome === "not_my_product";
  const outcomeLabels: Record<ResolutionType, string> = {
    verified_safe: t("resolveActions.verifiedSafe"),
    removed_from_sale: t("resolveActions.removedFromSale"),
    modified_product: t("resolveActions.modifiedProduct"),
    contacted_supplier: t("resolveActions.contactedSupplier"),
    false_positive: t("resolveActions.falsePositive"),
    not_my_product: t("resolveActions.notMyProduct"),
  };
  const recordedOutcome = alert.resolutionType ? outcomeLabels[alert.resolutionType as ResolutionType] : null;
  const recordDecision = () => {
    if (!selectedOutcome || isLoading) return;
    const action = isDismissOutcome ? onDismiss : onResolve;
    action?.(alert.id, selectedOutcome, auditNote.trim() || undefined);
  };

  function getWarningImages(warning: any): any[] {
    const warningFields = warning.alertDetails?.fields || {};
    const images = Array.isArray(warningFields.pictures) ? [...warningFields.pictures] : [];
    if (images.length === 0) {
      if (warningFields.product_image) images.push(warningFields.product_image);
      if (typeof warningFields.product_other_images === "string") {
        images.push(...warningFields.product_other_images.split(",").map((item: string) => item.trim()).filter(Boolean));
      }
    }
    return images;
  }

  return (
    <>
      <s-modal
        id={modalId}
        heading={t("analysis.modalHeading")}
        accessibilityLabel={t("analysis.modalAccessibilityLabel", { title: alert.productTitle })}
        size="large"
      >
        <div className="review-modal">
          <div className="review-modal__summary">
            <div>
              <div className="review-modal__eyebrow">{t("analysis.reviewLayout.possibleMatch")}</div>
              <h2 className="review-modal__title">{alert.productTitle}</h2>
              <p className="review-modal__intro">
                {isActive
                  ? isSafe ? t("analysis.sections.whatHappenedSafe") : t("analysis.sections.whatHappenedRisk")
                  : t("analysis.sections.whatHappenedReviewed")}
              </p>
            </div>
            <div className="review-modal__badges">
              <StatusBadge status={alert.status} />
              {alert.riskLevel && <AlertBadge alertLevel={alert.riskLevel} showSeverity />}
              {overallSimilarity !== null && <s-badge tone="info">{t("analysis.overallMatchShort", { count: overallSimilarity })}</s-badge>}
            </div>
          </div>

          <section className="review-modal__section" aria-label={t("analysis.reviewLayout.compareHeading")}>
            <div className="review-modal__section-heading">
              <h3>{t("analysis.reviewLayout.compareHeading")}</h3>
              <span>{t("analysis.reviewLayout.compareHint")}</span>
            </div>
            <div className="review-modal__comparison">
              <div className="review-modal__product-card">
                <span className="review-modal__card-label">{t("analysis.yourProduct")}</span>
                <button type="button" className="review-modal__image-button" onClick={() => alert.productImage && setSelectedImage(alert.productImage)} disabled={!alert.productImage} aria-label={t("analysis.openProductImage", { title: alert.productTitle })}>
                  {alert.productImage ? <img src={alert.productImage} alt={alert.productTitle} /> : <span>{t("analysis.reviewLayout.noImage")}</span>}
                </button>
                <div className="review-modal__card-details">
                  <strong>{alert.productTitle}</strong>
                  {(alert.productVendor || alert.productType) && <span>{[alert.productVendor, alert.productType].filter(Boolean).join(" · ")}</span>}
                  <s-link href={`https://${alert.shop}/admin/products/${alert.productId}`} target="_blank">{t("analysis.editInShopify")}</s-link>
                </div>
              </div>
              <div className="review-modal__product-card review-modal__product-card--safety">
                <span className="review-modal__card-label">Safety Gate</span>
                <button type="button" className="review-modal__image-button" onClick={() => safetyImage && setSelectedImage(safetyImage)} disabled={!safetyImage} aria-label={t("analysis.enlargedSafetyAlert")}>
                  {safetyImage ? <img src={safetyImage} alt={safetyTitle} /> : <span>{t("analysis.reviewLayout.noImage")}</span>}
                </button>
                <div className="review-modal__card-details">
                  <strong>{safetyTitle}</strong>
                  {(safetyBrand || safetyModel) && <span>{[safetyBrand, safetyModel].filter(Boolean).join(" · ")}</span>}
                  {caseNumber && <span>{t("analysis.alertNumber", { number: caseNumber })}</span>}
                  {safetyUrl && <s-link href={safetyUrl} target="_blank">{t("analysis.viewOnSafetyGate")}</s-link>}
                </div>
              </div>
            </div>
          </section>

          <div className="review-modal__final-row">
          <section className="review-modal__section" aria-label={t("analysis.reviewLayout.reviewPointsHeading")}>
            <div className="review-modal__section-heading"><h3>{t("analysis.reviewLayout.reviewPointsHeading")}</h3></div>
            <div className="review-modal__points">
              <div><strong>{t("analysis.imageMatch")}</strong><span>{imageSimilarity !== null ? t("analysis.imageMatchShort", { count: imageSimilarity }) : t("common.unknown")}</span></div>
              <div><strong>{t("analysis.fields.brand")}</strong><span>{safetyBrand || t("common.unknown")}</span></div>
              <div><strong>{t("analysis.fields.model")}</strong><span>{safetyModel || t("common.unknown")}</span></div>
              <div><strong>{t("analysis.fields.category")}</strong><span>{safetyCategory || t("common.unknown")}</span></div>
            </div>
            {primaryWarning?.reason && <p className="review-modal__reason">{primaryWarning.reason}</p>}
            <p className="review-modal__score-help">{t("analysis.scoreHelper")}</p>
          </section>

          {isActive ? (
            <section className="review-modal__decision" aria-label={t("analysis.reviewLayout.decisionHeading")}>
              <div className="review-modal__section-heading"><h3>{t("analysis.reviewLayout.decisionHeading")}</h3></div>
              <p>{t("analysis.decisionContextDesc")}</p>
              <s-select label={t("analysis.reviewLayout.outcomeLabel")} value={selectedOutcome} onChange={(event: any) => setSelectedOutcome(event.currentTarget.value || "")}>
                <s-option value="">{t("analysis.reviewLayout.chooseOutcome")}</s-option>
                <s-option value="removed_from_sale">{t("resolveActions.removedFromSale")}</s-option>
                <s-option value="modified_product">{t("resolveActions.modifiedProduct")}</s-option>
                <s-option value="contacted_supplier">{t("resolveActions.contactedSupplier")}</s-option>
                <s-option value="verified_safe">{t("resolveActions.verifiedSafe")}</s-option>
                <s-option value="false_positive">{t("resolveActions.falsePositive")}</s-option>
                <s-option value="not_my_product">{t("resolveActions.notMyProduct")}</s-option>
              </s-select>
              <s-text-area label={t("analysis.audit.noteLabel")} placeholder={t("analysis.audit.notePlaceholder")} value={auditNote} onInput={(event: any) => setAuditNote(event.currentTarget.value || "")} />
            </section>
          ) : (
            <div className="review-modal__recorded">
              <strong>{t("analysis.decisionRecorded")}</strong>
              {recordedOutcome && <span>{recordedOutcome}</span>}
              {alert.notes && <p>{alert.notes}</p>}
            </div>
          )}
          </div>
          {warnings.length > 0 && (
            <details className="review-modal__evidence">
              <summary>{t("analysis.reviewLayout.fullEvidence", { count: warnings.length })}</summary>
              <div className="review-modal__evidence-content">
                {warnings.map((warning: any, index: number) => (
                  <WarningCard key={`warning-${index}`} warning={warning} index={index} onImageClick={setSelectedImage} getWarningImages={getWarningImages} merchantProduct={alert} />
                ))}
              </div>
            </details>
          )}

        </div>
        {isActive && (
          <s-button slot="primary-action" variant="primary" disabled={!selectedOutcome || isLoading} loading={isLoading || undefined} onClick={recordDecision} commandFor={selectedOutcome ? modalId : undefined} command={selectedOutcome ? "--hide" : undefined}>
            {t("actions.recordDecision")}
          </s-button>
        )}
        {(alert.status === "dismissed" || alert.status === "resolved") && (
          <s-button ref={reactivateBtnRef} slot="secondary-actions" variant="secondary" icon="undo" commandFor={modalId} command="--hide" loading={isLoading || undefined}>{t("actions.reactivate")}</s-button>
        )}
        <s-button slot="secondary-actions" variant="secondary" commandFor={modalId} command="--hide">{t("common.cancel")}</s-button>
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
  index: _index,
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

  // Get correct field names from Safety Gate database (official ec.europa.eu fields with fallbacks)
  const caseNumber = fields.caseNumber || fields.alert_number;
  const brand = fields.brand || fields.product_brand;
  const category = fields.category || fields.product_category;
  const productName = fields.name || fields.product || fields.product_name;
  const productModel = fields.type_numberOfModel || fields.product_model_type || fields.product_model || fields.model;
  const notifyingCountry = fields.notifyingCountry || fields.alert_country || fields.notifying_country;
  const originCountry = fields.countryOfOrigin || fields.product_country || fields.country_of_origin;
  const alertLevel = fields.level || fields.alert_level || fields.risk_level;
  const alertType = fields.riskType || fields.alert_type;
  const safetyGateUrl = fields.url || fields.rapex_url || fields.reference;
  const dangerDescription = fields.danger || fields.alert_description;
  const productDescription = fields.description || fields.product_description;
  const measuresDescription = fields.measures || fields.technical_defect || fields.measures_country;

  // Determine card border color based on similarity
  const borderColor = warningOverallSimilarity >= 80 ? "border-critical" : warningOverallSimilarity >= 60 ? "border-warning" : "border";
  const isImageFirst = warning.scoreBreakdown?.scoringMode === "image-first";

  // Check matching fields with merchant product details for highlighting
  const merchantTitle = String(merchantProduct?.productTitle || "").toLowerCase();
  const isBrandMatched = brand && merchantTitle.includes(brand.trim().toLowerCase());
  const isModelMatched = productModel && merchantTitle.includes(productModel.trim().toLowerCase());
  const isCategoryMatched = category && merchantProduct?.productType && merchantTitle.includes(category.trim().toLowerCase());

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
            {alertLevel && (
              <AlertBadge
                alertLevel={alertLevel}
                showSeverity={true}
              />
            )}
            {alertType && (
              <AlertBadge
                alertLevel={alertLevel}
                alertType={alertType}
                riskDescription={warning.riskLegalProvision || dangerDescription}
              />
            )}
          </s-stack>
          
          {safetyGateUrl && (
            <s-link href={safetyGateUrl} target="_blank">
              {t("analysis.viewOnSafetyGate")}
            </s-link>
          )}
        </s-stack>

        {/* Alert number */}
        {caseNumber && (
          <s-text tone="subdued" size="small">
            {t("analysis.alertNumber", { number: caseNumber })} • {formattedDate}
          </s-text>
        )}

        {/* Start comparison with the visual evidence and identifying details. */}
        <s-grid gap="large" gridTemplateColumns="auto 1fr">
          {/* Images Column */}
          {pictures.length > 0 && (
            <div className="alert-reference-images">
              {(() => {
                const primarySrc = typeof pictures[0] === "string" ? pictures[0] : pictures[0]?.url || pictures[0]?.src;
                if (!primarySrc) return null;
                return (
                  <div
                    onClick={() => onImageClick(primarySrc)}
                    className="alert-image-clickable"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onImageClick(primarySrc);
                    }}
                  >
                    <img src={primarySrc} alt="Safety Gate Reference 1" className="alert-reference-image-primary" />
                  </div>
                );
              })()}
              {pictures.length > 1 && (
                <div className="alert-reference-thumbnails">
                  {pictures.slice(1, 5).map((pic: any, idx: number) => {
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
                          if (e.key === "Enter") onImageClick(src);
                        }}
                      >
                        <img src={src} alt={`Thumbnail ${idx + 2}`} className="alert-reference-image-thumb" />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="match-detail-list">
            {productName && <DetailItem label={t("analysis.fields.productName")} value={productName} />}
            {brand && (
              <DetailItem label={t("analysis.fields.brand")} value={brand} highlight={Boolean(isBrandMatched)} />
            )}
            {productModel && (
              <DetailItem label={t("analysis.fields.model")} value={productModel} highlight={Boolean(isModelMatched)} />
            )}
            {category && (
              <DetailItem label={t("analysis.fields.category")} value={category} highlight={Boolean(isCategoryMatched)} />
            )}
            {notifyingCountry && <DetailItem label={t("analysis.fields.notifyingCountry")} value={notifyingCountry} />}
            {originCountry && <DetailItem label={t("analysis.fields.origin")} value={originCountry} />}
            <DetailItem label={t("analysis.fields.alertDate")} value={formattedDate} />
            {alertLevel && (
              <div className="match-detail-list__item">
                <span>{t("analysis.riskSeverity")}</span>
                <AlertBadge alertLevel={alertLevel} showSeverity={true} />
              </div>
            )}
            {alertType && (
              <div className="match-detail-list__item">
                <span>{t("analysis.hazardType")}</span>
                <AlertBadge alertLevel={alertLevel} alertType={alertType} />
              </div>
            )}
          </div>
        </s-grid>

        {warning.reason && (
          <s-box padding="base" borderRadius="base" background="bg-surface-info">
            <s-stack gap="small-100">
              <s-text fontWeight="bold" tone="info" size="small">{t("analysis.whyThisMatched")}</s-text>
              <s-text>{warning.reason}</s-text>
              {isImageFirst && !warning.reason.toLowerCase().includes("exact") && (
                <s-text tone="subdued" size="small">{t("analysis.imageDominated")}</s-text>
              )}
            </s-stack>
          </s-box>
        )}

        {/* RISK DESCRIPTION (if present) */}
        {dangerDescription && (
          <s-box
            padding="base"
            borderRadius="base"
            background="bg-surface-critical"
          >
            <s-stack gap="small-100">
              <s-text fontWeight="bold" tone="critical" size="small">{t("analysis.riskDescription")}</s-text>
              <s-text>{dangerDescription}</s-text>
            </s-stack>
          </s-box>
        )}

        {/* Measures (if present) */}
        {measuresDescription && (
          <s-box padding="base" borderRadius="base" background="bg-surface-warning">
            <s-stack gap="small-100">
              <s-text fontWeight="bold" tone="warning" size="small">{t("analysis.measures") || "Compulsory / Economic Operator Measures"}</s-text>
              <s-text size="small">{measuresDescription}</s-text>
            </s-stack>
          </s-box>
        )}

        {/* Product Description */}
        {productDescription && (
          <s-box padding="base" borderRadius="base" background="bg-surface-secondary">
            <s-stack gap="small-100">
              <s-text tone="subdued" size="small">{t("analysis.fields.productDescription")}</s-text>
              <s-text size="small">{productDescription}</s-text>
            </s-stack>
          </s-box>
        )}

        {/* Legal Provision */}
        {fields.risk_legal_provision && fields.risk_legal_provision !== dangerDescription && (
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
