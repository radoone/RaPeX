import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { imageUrls, warningImages } from "../services/product-images";
import { GalleryNavigation, ReviewImageGallery, type OpenGallery } from "./ReviewImageGallery";
import { useTranslation } from "react-i18next";
import { AlertBadge } from "./AlertBadge";
import { LocalDateTime } from "./LocalDateTime";
import { StatusBadge } from "./StatusBadge";
import type { ResolutionType } from "./AlertTable";
import {
  officialRiskDetails,
  officialSource,
  isWaitingForSupplier,
} from "../services/review-evidence";
import { compareProductIdentifiers } from "../services/product-identifiers";
import { openReviewModalWhenReady } from "../services/review-modal";
import { fetchReviewPhotos } from "../services/review-photos";

interface AlertDetailModalProps {
  alert: any;
  decisionHistory?: Array<{
    action: string;
    reviewState: string;
    resolutionType: string | null;
    notes: string | null;
    createdAt: Date | string;
  }>;
  modalId: string;
  onDismiss?: (
    alertId: string,
    resolutionType?: ResolutionType,
    notes?: string,
  ) => void;
  onResolve?: (
    alertId: string,
    resolutionType?: ResolutionType,
    notes?: string,
  ) => void;
  onReactivate?: (alertId: string) => void;
  isLoading?: boolean;
  openOnMount?: boolean;
  inline?: boolean;
  waitForDecisionSave?: boolean;
  decisionSaveFailed?: boolean;
}

export function AlertDetailModal({
  alert,
  decisionHistory = [],
  modalId,
  onDismiss,
  onResolve,
  onReactivate,
  isLoading = false,
  openOnMount = false,
  inline = false,
  waitForDecisionSave = false,
  decisionSaveFailed = false,
}: AlertDetailModalProps) {
  const { t, i18n } = useTranslation();
  const [isHydrated, setIsHydrated] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number; title: string } | null>(null);
  const selectedImage = lightbox?.images[lightbox.index] || null;
  const requestedPhotos = useRef<string | null>(null);
  const photoRequest = useRef<AbortController | null>(null);
  const [cachedPhotos, setCachedPhotos] = useState<{ productId: string; images: string[] } | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoRequestFailed, setPhotoRequestFailed] = useState(false);
  const productId = String(alert?.productId || "").replace("gid://shopify/Product/", "");
  useEffect(() => () => photoRequest.current?.abort(), []);
  const loadPhotos = useCallback(() => {
    if (!productId || requestedPhotos.current === productId) return;
    requestedPhotos.current = productId;
    photoRequest.current?.abort();
    const controller = new AbortController();
    photoRequest.current = controller;
    setPhotoLoading(true);
    setPhotoRequestFailed(false);
    void fetchReviewPhotos(productId, controller.signal).then(images => {
      if (!controller.signal.aborted) setCachedPhotos({ productId, images });
    }).catch(() => {
      if (controller.signal.aborted) return;
      requestedPhotos.current = null;
      // Keep the last successful photographs and offer a local retry.
      setPhotoRequestFailed(true);
    }).finally(() => {
      if (photoRequest.current === controller && !controller.signal.aborted) setPhotoLoading(false);
    });
  }, [productId]);
  useEffect(() => {
    if (!isHydrated) return;
    const modal = document.getElementById(modalId);
    modal?.addEventListener("show", loadPhotos);
    if (openOnMount || inline) loadPhotos();
    return () => modal?.removeEventListener("show", loadPhotos);
  }, [inline, isHydrated, loadPhotos, modalId, openOnMount]);
  const openGallery: OpenGallery = (images, index, title) => setLightbox({ images, index, title });
  const moveLightbox = (step: number) => setLightbox(current => current && ({
    ...current, index: (current.index + step + current.images.length) % current.images.length,
  }));
  const [auditNote, setAuditNote] = useState("");
  const [referenceStatus, setReferenceStatus] = useState("");
  const [outcomeGroup, setOutcomeGroup] = useState("");
  const [selectedOutcome, setSelectedOutcome] = useState<ResolutionType | "">(
    "",
  );
  const lightboxDialogRef = useRef<HTMLDialogElement>(null);
  const reactivateBtnRef = useRef<HTMLElement>(null);
  const hasResult = Boolean(alert);

  // Polaris upgrades modal custom elements in the browser. Keeping this client-only
  // gives React identical server and first-client markup instead of hiding a mismatch.
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated || !openOnMount || !hasResult) return;
    return openReviewModalWhenReady(modalId, document, customElements);
  }, [alert?.id, hasResult, isHydrated, modalId, openOnMount]);

  // Close lightbox
  const closeLightbox = useCallback(() => {
    setLightbox(null);
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
    setOutcomeGroup("");
    setAuditNote("");
  }, [alert?.id, alert?.status, alert?.reviewState, alert?.resolutionType]);

  // Handle reactivate button click
  useEffect(() => {
    const btn = reactivateBtnRef.current;
    if (!btn || !alert) return;

    const handleClick = () => onReactivate?.(alert.id);
    btn.addEventListener("click", handleClick);
    return () => btn.removeEventListener("click", handleClick);
  }, [alert, onReactivate]);

  if (!alert || (!inline && !isHydrated)) return null;

  const warnings: any[] = Array.isArray(parsed?.warnings)
    ? parsed.warnings
    : [];
  const primaryWarning = warnings[0];
  const fields = primaryWarning?.alertDetails?.fields || {};
  const pictures = primaryWarning ? warningImages(primaryWarning) : [];
  const merchantPictures = cachedPhotos?.productId === productId
    ? cachedPhotos.images : imageUrls(alert.productImages, alert.productImage);

  const safetyBrand = fields.brand || fields.product_brand;
  const safetyTitle =
    fields.name ||
    fields.product ||
    fields.product_name ||
    fields.product_description ||
    safetyBrand ||
    t("analysis.reviewLayout.possibleMatch");
  const safetyModel =
    fields.type_numberOfModel ||
    fields.product_model_type ||
    fields.product_model ||
    fields.model;
  const { caseNumber, url: safetyUrl } = officialSource(fields);
  const publishedAt = fields.alert_date || primaryWarning?.alertDetails?.meta?.alert_date;
  const notifyingCountry = fields.notifyingCountry || fields.alert_country || fields.notifying_country;
  const isSafe = parsed?.isSafe === true;
  const overallSimilarity =
    typeof primaryWarning?.overallSimilarity === "number"
      ? primaryWarning.overallSimilarity
      : null;
  const imageSimilarity =
    typeof primaryWarning?.imageSimilarity === "number"
      ? primaryWarning.imageSimilarity
      : null;
  const scoringMode =
    primaryWarning?.scoreBreakdown?.scoringMode ?? parsed?.analysis?.scoringMode;
  const imageLed = scoringMode === "image-first" && imageSimilarity !== null;
  const textOnly = parsed?.analysis?.mode === "text-only";
  const isActive = alert.status === "active";
  const isWaiting = isWaitingForSupplier(alert);
  const isDismissOutcome =
    selectedOutcome === "false_positive" ||
    selectedOutcome === "not_my_product";
  const isConfirmingMatch = selectedOutcome === "match_confirmed";
  const hasConfirmedMatch = isActive && alert.resolutionType === "match_confirmed";
  const needsNote = selectedOutcome === "other" || isConfirmingMatch;
  const canRecordDecision = Boolean(
    selectedOutcome && (!needsNote || auditNote.trim()),
  );
  const outcomeLabels: Record<ResolutionType, string> = {
    verified_safe: t("resolveActions.verifiedSafe"),
    match_not_confirmed: t("workspace.matchNotConfirmed"),
    match_confirmed: t("matchConfirmed"),
    removed_from_sale: t("resolveActions.removedFromSale"),
    modified_product: t("resolveActions.modifiedProduct"),
    contacted_supplier: t("resolveActions.contactedSupplier"),
    false_positive: t("resolveActions.falsePositive"),
    not_my_product: t("resolveActions.notMyProduct"),
    other: t("resolveActions.other"),
  };
  const latestEvent = decisionHistory[0];
  const recordedEvent = !isActive && latestEvent && latestEvent.reviewState === alert.status
    && (!alert.resolutionType || latestEvent.resolutionType === alert.resolutionType)
    ? latestEvent
    : null;
  const recordedType = alert.resolutionType || recordedEvent?.resolutionType;
  const recordedOutcome = recordedType
    ? outcomeLabels[recordedType as ResolutionType] || recordedType
    : null;
  const recordedAt = recordedEvent?.createdAt
    ?? (alert.status === "resolved" ? alert.resolvedAt : alert.dismissedAt);
  const recordedNotes = alert.notes || recordedEvent?.notes;
  const history = recordedEvent ? decisionHistory.slice(1) : decisionHistory;
  const recordDecision = () => {
    if (!canRecordDecision || !selectedOutcome || isLoading) return;
    const action = isDismissOutcome ? onDismiss : onResolve;
    action?.(alert.id, selectedOutcome, auditNote.trim() || undefined);
  };

  const merchantBrand = alert.brand || null;
  const merchantModel = alert.model || null;
  const merchantBarcode =
    primaryWarning?.identifierMatches?.map((item: any) =>
      `${item.barcode}${item.variantTitle || item.variantId ? ` (${item.variantTitle || item.variantId})` : ""}`).join("; ") ||
    alert.barcode || alert.productBarcode || alert.gtin || alert.ean || null;
  const merchantBatch = alert.batchNumber || alert.batch || null;

  const safetyBarcode = fields.barcode || fields.product_barcode || null;
  const safetyBatch = fields.batchNumber || fields.batch_number || null;

  const identifierRows = [
    {
      label: t("analysis.reviewLayout.identifiers.brand"),
      merchantVal: merchantBrand,
      safetyVal: safetyBrand,
      status: compareProductIdentifiers(merchantBrand, safetyBrand),
    },
    {
      label: t("analysis.reviewLayout.identifiers.model"),
      merchantVal: merchantModel,
      safetyVal: safetyModel,
      status: compareProductIdentifiers(merchantModel, safetyModel),
    },
    {
      label: t("analysis.reviewLayout.identifiers.barcode"),
      merchantVal: merchantBarcode,
      safetyVal: safetyBarcode,
      status: primaryWarning?.matchBasis === "gtin" && primaryWarning?.identifierMatches?.length
        ? "match" : compareProductIdentifiers(merchantBarcode, safetyBarcode),
    },
    {
      label: t("analysis.reviewLayout.identifiers.batch"),
      merchantVal: merchantBatch,
      safetyVal: safetyBatch,
      status: compareProductIdentifiers(merchantBatch, safetyBatch),
    },
  ];

  const matchingFields = identifierRows.filter(row => row.status === "match").map(row => row.label);
  const differentFields = identifierRows.filter(row => row.status === "mismatch").map(row => row.label);
  const missingFields = identifierRows.filter(row => row.status === "unspecified").map(row => row.label);
  const rawRiskLevel = fields.level || fields.alert_level || fields.risk_level;
  const officialRiskLevel = typeof rawRiskLevel === "string" || typeof rawRiskLevel === "number"
    ? String(rawRiskLevel)
    : "";
  const rawRiskTypes = fields.riskType || fields.alert_type;
  const officialRiskTypes = typeof rawRiskTypes === "string"
    ? [...new Set(rawRiskTypes.split(",").map(type => type.trim()).filter(Boolean))]
    : [];
  const { danger: officialDanger, measures } = officialRiskDetails(fields);
  const hasOfficialRisk = Boolean(officialRiskLevel || officialRiskTypes.length || officialDanger || measures);
  const closeWhenSubmitted = canRecordDecision && !waitForDecisionSave;
  const listFormat = new Intl.ListFormat(i18n.language);

  // A completed check without a finding has no source record or review decision.
  if (isSafe && warnings.length === 0 && !alert.id) {
    return (
      <s-modal
        id={modalId}
        heading={t("workspace.noMatch")}
        accessibilityLabel={t("analysis.modalAccessibilityLabel", {
          title: alert.productTitle,
        })}
      >
        <div className="review-modal">
          <h2 className="review-modal__title">{alert.productTitle}</h2>
          <p>{t("analysis.sections.whatHappenedSafe")} {t("catalogOverview.resultBoundary")}</p>
          <s-link
            href={`https://${alert.shop}/admin/products/${alert.productId}`}
            target="_blank"
          >
            {t("analysis.editInShopify")}
          </s-link>
        </div>
        <s-button
          slot="primary-action"
          variant="primary"
          commandFor={modalId}
          command="--hide"
        >
          {t("common.close")}
        </s-button>
      </s-modal>
    );
  }

  const ReviewContainer = inline ? "s-section" : "s-modal";
  const recordButton = (
    <s-button
      slot={inline ? undefined : "primary-action"}
      variant="primary"
      inlineSize={inline ? "fill" : undefined}
      disabled={!canRecordDecision || isLoading}
      loading={isLoading || undefined}
      onClick={recordDecision}
      commandFor={!inline && closeWhenSubmitted ? modalId : undefined}
      command={!inline && closeWhenSubmitted ? "--hide" : undefined}
    >
      {t("actions.recordDecision")}
    </s-button>
  );
  return (
    <>
      <ReviewContainer
        id={modalId}
        heading={inline ? undefined : t("analysis.modalHeading")}
        accessibilityLabel={t("analysis.modalAccessibilityLabel", {
          title: alert.productTitle,
        })}
        size={inline ? undefined : "large"}
      >
        <div className={inline ? "review-modal review-page" : "review-modal"}>
          <div className="review-modal__summary">
            <div>
              <h2 className="review-modal__title">{alert.productTitle}</h2>
              {isActive && <p className="review-modal__intro">{t(hasConfirmedMatch ? "afterConfirmation" : "workspace.matchNeedsVerification")}</p>}
            </div>
            {isActive && (
              <div className="review-modal__badges">
                {hasConfirmedMatch ? (
                  <s-badge tone="success">{t("matchConfirmed")}</s-badge>
                ) : isWaiting ? (
                  <s-badge tone="warning">{t("workspace.waiting")}</s-badge>
                ) : (
                  <s-badge tone="critical">{t("analysis.reviewLayout.actionNeeded")}</s-badge>
                )}
                <s-button
                  variant={isWaiting ? "secondary" : "primary"}
                  onClick={() => {
                    const decision = document.getElementById(`${modalId}-decision`);
                    decision?.scrollIntoView({ block: "start" });
                    decision?.focus({ preventScroll: true });
                  }}
                >
                  {t("workspace.chooseOutcomeLink")}
                </s-button>
              </div>
            )}
          </div>

          <div className="review-modal__body-grid">
            <div className="review-modal__evidence-column">
              <section
                className="review-modal__section"
              aria-label={t("analysis.reviewLayout.compareHeading")}
            >
            <div className="review-modal__section-heading">
              <h3>{t("analysis.reviewLayout.compareHeading")}</h3>
              {isActive && <span>{t("analysis.reviewLayout.compareHint")}</span>}
            </div>
            <div className="review-modal__comparison">
              <div className="review-modal__product-card">
                <span className="review-modal__card-label">
                  {t("analysis.yourProduct")}
                </span>
                <div>
                  <ReviewImageGallery images={merchantPictures} title={alert.productTitle} onOpen={openGallery} />
                  {photoLoading && <p role="status">{t("common.loading")}</p>}
                  {photoRequestFailed && <div role="status">
                    <p>{t("gallery.loadError")}</p>
                    <s-button onClick={() => { requestedPhotos.current = null; loadPhotos(); }}>{t("actions.retry")}</s-button>
                  </div>}
                </div>
                <div className="review-modal__card-details">
                  <strong>{alert.productTitle}</strong>
                  <div>
                    {[alert.productVendor, alert.productType].filter(Boolean).join(" · ")}
                  </div>
                  <div className="review-modal__card-metadata">
                    {alert.productSku && <span>SKU {alert.productSku}</span>}
                  </div>
                  <div>
                    <s-link
                      href={`https://${alert.shop}/admin/products/${productId}`}
                      target="_blank"
                    >
                      {t("analysis.editInShopify")}
                    </s-link>
                  </div>
                </div>
              </div>
              <div className="review-modal__product-card review-modal__product-card--safety">
                <span className="review-modal__card-label">Safety Gate</span>
                <ReviewImageGallery images={pictures} title={safetyTitle} onOpen={openGallery} />
                <div className="review-modal__card-details">
                  <strong>{safetyTitle}</strong>
                  <div>{[safetyBrand, safetyModel].filter(Boolean).join(" · ")}</div>
                  <div className="review-modal__card-metadata">
                    {officialRiskLevel && <AlertBadge alertLevel={officialRiskLevel} showSeverity />}
                    {caseNumber ? (
                      <span>{t("analysis.alertNumber", { number: caseNumber })}</span>
                    ) : (
                      <span className="admin-helper">{t("workspace.referenceMissing")}</span>
                    )}
                    {notifyingCountry && <span>{t("analysis.fields.notifyingCountry")} · {notifyingCountry}</span>}
                    {publishedAt && (
                      <span>
                        {t("analysis.fields.alertDate")} ·{" "}
                        <LocalDateTime value={publishedAt} format={new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeZone: "UTC" }).format} />
                      </span>
                    )}
                  </div>
                  <div>
                    {safetyUrl ? (
                      <s-link href={safetyUrl} target="_blank">{t("viewExternalSource")}</s-link>
                    ) : <span className="admin-helper">{t("workspace.sourceMissing")}</span>}
                    {caseNumber && (
                      <div>
                        <s-button variant="tertiary" onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(caseNumber);
                            setReferenceStatus(t("caseNumberCopied"));
                          } catch {
                            setReferenceStatus(t("copyCaseNumberFailed"));
                          }
                        }}>{t("copyCaseNumber")}</s-button>
                        <span role="status">{referenceStatus}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

              </section>
              {primaryWarning?.matchBasis !== "gtin" && (overallSimilarity !== null || imageSimilarity !== null) && (
                <section className="review-score">
                  <h3>{t("redesign.aiSimilarity")}</h3>
                  <p>{t("workspace.scoreHelp")}</p>
                  <div className="review-modal__points">
                    {overallSimilarity !== null && (
                      <strong>{t("analysis.overallMatchShort", { count: overallSimilarity })}</strong>
                    )}
                    {imageSimilarity !== null && (
                      <span>{t("analysis.imageMatchShort", { count: imageSimilarity })}</span>
                    )}
                  </div>
                  {primaryWarning.reason && <p>{primaryWarning.reason}</p>}
                </section>
              )}
              <div className="review-evidence-summary review-evidence-summary--compact">
            <section>
              <h3>{t("findingOverview.matches")}</h3>
              <div className="review-evidence-summary__content">
              <p>{matchingFields.length ? listFormat.format(matchingFields) : t("findingOverview.noConfirmedIdentifiers")}</p>
              {primaryWarning?.matchBasis === "gtin" && <p>{t("barcodeMatch.help")}</p>}
              {primaryWarning?.matchBasis !== "gtin" && (imageLed || textOnly) && (
                <p>
                  <strong>{t("analysis.whyThisMatched")}</strong><br />
                  {t(imageLed ? "analysis.imageDominated" : "manualCheck.banners.textOnlyDescription")}
                </p>
              )}
              </div>
            </section>
            <section>
              <h3>{t("findingOverview.verify")}</h3>
              <div className="review-evidence-summary__content">
              {differentFields.length > 0 && (
                <p>{t("workspace.differentIdentifiers", { fields: listFormat.format(differentFields) })}</p>
              )}
              {missingFields.length > 0 && (
                <p>{t("findingOverview.missing", { fields: listFormat.format(missingFields) })}</p>
              )}
              {differentFields.length === 0 && missingFields.length === 0 && <p>{t("findingOverview.verifyApplicability")}</p>}
              </div>
            </section>
            <section>
              <h3>{t("findingOverview.officialRisk")}</h3>
              <div className="review-evidence-summary__content">
              {hasOfficialRisk ? (
                <>
                  <div className="review-evidence-summary__risk">
                    {officialRiskLevel && <AlertBadge alertLevel={officialRiskLevel} showSeverity />}
                    {officialRiskTypes.map(type => <AlertBadge key={type} alertType={type} />)}
                  </div>
                  {officialDanger && (officialDanger.length > 220 ? <details className="review-evidence-risk-details">
                    <summary>{`${officialDanger.slice(0, 220).replace(/\s+\S*$/, "")}…`}</summary>
                    <p>{officialDanger}</p>
                  </details> : <p>{officialDanger}</p>)}
                </>
              ) : <p>{t("findingOverview.riskUnavailable")}</p>}
              {measures && (
                <details className="review-evidence-risk-details">
                  <summary>{t("redesign.officialMeasures")}</summary>
                  <p>{measures}</p>
                </details>
              )}
              </div>
            </section>
              </div>
            <div style={{ marginTop: "16px" }}>
              <div
                className="review-modal__section-heading"
                style={{ marginBottom: "8px" }}
              >
                <h4>{t("analysis.reviewLayout.identifiersHeading")}</h4>
              </div>
              <table className="review-modal__identifiers-table">
                <thead>
                  <tr>
                    <th>{t("analysis.reviewLayout.identifiers.field")}</th>
                    <th>
                      {t("analysis.reviewLayout.identifiers.yourProduct")}
                    </th>
                    <th>{t("analysis.reviewLayout.identifiers.safetyGate")}</th>
                    <th>{t("analysis.reviewLayout.identifiers.result")}</th>
                  </tr>
                </thead>
                <tbody>
                  {identifierRows.map((row, idx) => (
                    <tr key={idx}>
                      <td>
                        <strong>{row.label}</strong>
                      </td>
                      <td>
                        {row.merchantVal ? (
                          <span>{row.merchantVal}</span>
                        ) : (
                          <span className="review-modal__val-empty">
                            {t(
                              "analysis.reviewLayout.identifiers.notSpecified",
                            )}
                          </span>
                        )}
                      </td>
                      <td>
                        {row.safetyVal ? (
                          <span>{row.safetyVal}</span>
                        ) : (
                          <span className="review-modal__val-empty">
                            {t(
                              "analysis.reviewLayout.identifiers.notSpecified",
                            )}
                          </span>
                        )}
                      </td>
                      <td>
                        {row.status === "match" ? (
                          <s-badge tone="success">
                            {t("analysis.reviewLayout.identifiers.match")}
                          </s-badge>
                        ) : row.status === "mismatch" ? (
                          <s-badge tone="critical">
                            {t("analysis.reviewLayout.identifiers.mismatch")}
                          </s-badge>
                        ) : (
                          <s-badge tone="subdued">
                            {t("workspace.cannotCompare")}
                          </s-badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>

          <div className="review-modal__final-row">
            {isActive ? (
              <section
                className="review-modal__decision"
                id={`${modalId}-decision`}
                tabIndex={-1}
                aria-label={t("analysis.reviewLayout.decisionHeading")}
              >
                <s-banner tone="info" heading={t("analysis.reviewLayout.decisionHeading")}>
                  <s-text>{t("workspace.reviewPrompt")}</s-text>
                </s-banner>
                {hasConfirmedMatch && (
                  <s-banner tone="success" heading={t("matchConfirmed")}>
                    <s-text>{t("afterConfirmation")}</s-text>
                    {alert.notes && <p>{alert.notes}</p>}
                  </s-banner>
                )}
                {decisionSaveFailed && (
                  <p role="alert" className="review-modal__required-note">{t("findingOverview.saveFailed")}</p>
                )}
                <s-choice-list
                  label={t("workspace.chooseOutcomeLink")}
                  name={`${modalId}-outcome-group`}
                  onChange={(event: any) => {
                    const group = event.currentTarget.values?.[0] || "";
                    setOutcomeGroup(group);
                    const directOutcomes: Record<string, ResolutionType> = {
                      other: "other", information: "contacted_supplier", confirm: "match_confirmed",
                    };
                    setSelectedOutcome(directOutcomes[group] || "");
                  }}
                >
                  {[
                    ...(inline && !hasConfirmedMatch ? [["confirm", "confirmMatch"]] : []),
                    ["information", "workspace.groupInformation"],
                    ["different", "reviewUx.groupEvidence"],
                    ["action", "workspace.groupAction"],
                    ["other", "resolveActions.other"],
                  ].map(([group, label]) => (
                    <s-choice
                      key={group}
                      value={group}
                      selected={outcomeGroup === group}
                    >
                      {t(label)}
                      <span slot="details">
                        {t(group === "confirm" ? "afterConfirmation"
                          : group === "different" ? "workspace.matchNeedsVerification" : `analysis.reviewLayout.groupHelp.${group}`)}
                      </span>
                    </s-choice>
                  ))}
                </s-choice-list>
                {outcomeGroup === "information" && (
                  <strong>{t("resolveActions.contactedSupplier")}</strong>
                )}
                {(outcomeGroup === "action" ||
                  outcomeGroup === "different") && (
                  <s-select
                    label={t("workspace.chooseOutcomeLink")}
                    value={selectedOutcome}
                    onChange={(event: any) =>
                      setSelectedOutcome(event.currentTarget.value || "")
                    }
                  >
                    <s-option value="">
                      {t("analysis.reviewLayout.chooseOutcome")}
                    </s-option>
                    {outcomeGroup === "action" && (
                      <s-option value="removed_from_sale">
                        {t("resolveActions.removedFromSale")}
                      </s-option>
                    )}
                    {outcomeGroup === "action" && (
                      <s-option value="modified_product">
                        {t("resolveActions.modifiedProduct")}
                      </s-option>
                    )}
                    {outcomeGroup === "different" && (
                      <s-option value="match_not_confirmed">
                        {t("reviewUx.insufficientEvidence")}
                      </s-option>
                    )}
                    {outcomeGroup === "different" && (
                      <s-option value="not_my_product">
                        {t("reviewUx.confirmedDifferent")}
                      </s-option>
                    )}
                  </s-select>
                )}
                <p className="admin-helper" role="status">
                  {isConfirmingMatch ? t("confirmationHelp") : selectedOutcome
                    ? t(`workspace.outcomeHelp.${selectedOutcome}`)
                    : t("workspace.chooseOutcomeHelp")}
                </p>
                <s-text-area
                  label={t(
                    isConfirmingMatch ? "confirmationNote" : selectedOutcome === "other"
                      ? "analysis.reviewLayout.noteRequiredLabel"
                      : "analysis.reviewLayout.noteLabel",
                  )}
                  placeholder={t("analysis.audit.notePlaceholder")}
                  value={auditNote}
                  required={needsNote || undefined}
                  onInput={(event: any) =>
                    setAuditNote(event.currentTarget.value || "")
                  }
                />
                {selectedOutcome === "other" && !auditNote.trim() && (
                  <p className="review-modal__required-note" role="status">
                    {t("analysis.reviewLayout.otherNoteRequired")}
                  </p>
                )}
                <div className="review-modal__decision-footer">
                  {inline && recordButton}
                  <p className="review-modal__decision-note">{t("workspace.resultHelp")}</p>
                </div>
                <details className="advanced-settings-disclosure">
                  <summary>{t("responseGuide.title")}</summary>
                  <p>{t("responseGuide.intro")}</p>
                  <ol>
                    <li>{t("responseGuide.verify")}</li>
                    <li>{t("responseGuide.contain")}</li>
                    <li>{t("responseGuide.contact")}</li>
                    <li>{t("responseGuide.record")}</li>
                  </ol>
                  {safetyUrl && <a href={safetyUrl} target="_blank" rel="noopener noreferrer">{t("responseGuide.source")}</a>}
                </details>
              </section>
            ) : (
              <section className="review-modal__recorded" aria-labelledby={`${modalId}-recorded`}>
                <div className="review-modal__recorded-heading">
                  <h3 id={`${modalId}-recorded`}>
                    {t(
                      recordedType || recordedAt || recordedEvent
                        ? "analysis.decisionRecorded"
                        : "workspace.noMatchAtCheck",
                    )}
                  </h3>
                  <StatusBadge status={alert.status} />
                </div>
                {recordedOutcome && <p className="review-modal__recorded-outcome">{recordedOutcome}</p>}
                {recordedNotes && <p>{recordedNotes}</p>}
                {recordedAt && (
                  <LocalDateTime
                    value={recordedAt}
                    locale={i18n.language}
                    format={(date) => new Intl.DateTimeFormat(i18n.language, {
                      dateStyle: "medium", timeStyle: "short",
                    }).format(date)}
                  />
                )}
              </section>
            )}
            {history.length > 0 && (
              <details className="advanced-settings-disclosure">
                <summary>{t("actions.viewEvidence")}</summary>
                <ol className="review-modal__history">
                  {history.map((event, index) => {
                    const stateKey =
                      event.reviewState === "waiting_for_supplier"
                        ? "resolveActions.contactPending"
                        : event.reviewState === "dismissed"
                          ? "status.dismissed"
                          : event.reviewState === "resolved"
                            ? "status.resolved"
                            : "status.needsReview";
                    const eventOutcome = event.resolutionType
                      ? outcomeLabels[event.resolutionType as ResolutionType] ||
                        event.resolutionType
                      : null;
                    return (
                      <li key={`${event.createdAt}-${index}`}>
                        <s-stack gap="small-100">
                          <s-stack
                            direction="inline"
                            gap="small-100"
                            alignItems="center"
                          >
                            <s-text fontWeight="semibold">{t(stateKey)}</s-text>
                            {eventOutcome && <s-text>{eventOutcome}</s-text>}
                            <s-text tone="subdued" size="small">
                              <LocalDateTime value={event.createdAt} locale={i18n.language} />
                            </s-text>
                          </s-stack>
                          {event.notes && <s-text>{event.notes}</s-text>}
                        </s-stack>
                      </li>
                    );
                  })}
                </ol>
              </details>
            )}
          </div>
          </div>
          {warnings.length > 0 && (
            <details className="review-modal__evidence">
              <summary>
                {t("analysis.reviewLayout.fullEvidence", {
                  count: warnings.length,
                })}
              </summary>
              <div className="review-modal__evidence-content">
                {warnings.map((warning: any, index: number) => (
                  <WarningCard
                    key={`warning-${index}`}
                    warning={warning}
                    index={index}
                    onOpenGallery={openGallery}
                    merchantProduct={alert}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
        {!inline && isActive && recordButton}
        {onReactivate && (alert.status === "dismissed" || alert.status === "resolved") && (
          <s-button
            ref={reactivateBtnRef}
            slot="secondary-actions"
            variant="secondary"
            icon="undo"
            commandFor={inline ? undefined : modalId}
            command={inline ? undefined : "--hide"}
            disabled={isLoading}
            loading={isLoading || undefined}
          >
            {t("actions.reactivate")}
          </s-button>
        )}
        {!inline && <s-button
          id={`${modalId}-close`}
          slot="secondary-actions"
          variant="secondary"
          commandFor={modalId}
          command="--hide"
        >
          {t("common.cancel")}
        </s-button>}
      </ReviewContainer>

      {/* Image Lightbox (top-layer dialog so it always appears above s-modal) */}
      {isHydrated &&
        createPortal(
          <dialog
            ref={lightboxDialogRef}
            className="image-lightbox-dialog"
            aria-label={t("reviewUx.imageDialog", { title: lightbox?.title || "" })}
            onClose={closeLightbox}
            onCancel={(event) => {
              event.preventDefault();
              event.stopPropagation();
              closeLightbox();
            }}
            onKeyDown={(event) => {
              // Polaris also handles Escape on the surrounding review modal.
              // Keep photo navigation and dismissal within the topmost dialog.
              if (["Escape", "ArrowLeft", "ArrowRight"].includes(event.key)) event.stopPropagation();
              if (event.key === "Escape") { event.preventDefault(); closeLightbox(); }
              if (event.key === "ArrowLeft") { event.preventDefault(); moveLightbox(-1); }
              if (event.key === "ArrowRight") { event.preventDefault(); moveLightbox(1); }
            }}
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                closeLightbox();
              }
            }}
          >
            {selectedImage && (
              <div
                className="image-lightbox-content"
                onClick={(e) => e.stopPropagation()}
              >
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
                  alt={lightbox?.title || ""}
                  className="image-lightbox-image"
                />
                {lightbox && lightbox.images.length > 1 && (
                  <GalleryNavigation index={lightbox.index} count={lightbox.images.length} onMove={moveLightbox} />
                )}
              </div>
            )}
          </dialog>,
          document.body,
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
  onOpenGallery,
  merchantProduct,
}: {
  warning: any;
  index: number;
  onOpenGallery: OpenGallery;
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
    typeof warning.overallSimilarity === "number"
      ? warning.overallSimilarity
      : 0;
  const pictures = warningImages(warning);

  // Get correct field names from Safety Gate database (official ec.europa.eu fields with fallbacks)
  const { caseNumber, url: safetyGateUrl } = officialSource(fields);
  const brand = fields.brand || fields.product_brand;
  const category = fields.category || fields.product_category;
  const productName = fields.name || fields.product || fields.product_name;
  const productModel =
    fields.type_numberOfModel ||
    fields.product_model_type ||
    fields.product_model ||
    fields.model;
  const notifyingCountry =
    fields.notifyingCountry || fields.alert_country || fields.notifying_country;
  const originCountry =
    fields.countryOfOrigin ||
    fields.product_country ||
    fields.country_of_origin;
  const alertLevel = fields.level || fields.alert_level || fields.risk_level;
  const alertType = fields.riskType || fields.alert_type;
  const { danger: dangerDescription, measures: measuresDescription } = officialRiskDetails(fields);
  const productDescription = fields.description || fields.product_description;

  // Determine card border color based on similarity
  const borderColor =
    warningOverallSimilarity >= 80
      ? "border-critical"
      : warningOverallSimilarity >= 60
        ? "border-warning"
        : "border";

  // Check matching fields with merchant product details for highlighting
  const merchantTitle = String(
    merchantProduct?.productTitle || "",
  ).toLowerCase();
  const isBrandMatched =
    brand && merchantTitle.includes(brand.trim().toLowerCase());
  const isModelMatched =
    productModel && merchantTitle.includes(productModel.trim().toLowerCase());
  const isCategoryMatched =
    category &&
    merchantProduct?.productType &&
    merchantTitle.includes(category.trim().toLowerCase());

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
        <s-stack
          direction="inline"
          align="space-between"
          blockAlign="center"
          wrap
        >
          <s-stack direction="inline" gap="small" wrap blockAlign="center">
            {alertLevel && (
              <AlertBadge alertLevel={alertLevel} showSeverity={true} />
            )}
            {alertType && (
              <AlertBadge
                alertLevel={alertLevel}
                alertType={alertType}
                riskDescription={
                  dangerDescription || fields.risk_legal_provision
                }
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
            {t("analysis.alertNumber", { number: caseNumber })} •{" "}
            {formattedDate}
          </s-text>
        )}

        {/* Start comparison with the visual evidence and identifying details. */}
        <div className="review-warning-grid">
          {pictures.length > 0 && <ReviewImageGallery images={pictures}
            title={productName || "Safety Gate"} onOpen={onOpenGallery} />}

          <div className="match-detail-list">
            {productName && (
              <DetailItem
                label={t("analysis.fields.productName")}
                value={productName}
              />
            )}
            {brand && (
              <DetailItem
                label={t("analysis.fields.brand")}
                value={brand}
                highlight={Boolean(isBrandMatched)}
              />
            )}
            {productModel && (
              <DetailItem
                label={t("analysis.fields.model")}
                value={productModel}
                highlight={Boolean(isModelMatched)}
              />
            )}
            {category && (
              <DetailItem
                label={t("analysis.fields.category")}
                value={category}
                highlight={Boolean(isCategoryMatched)}
              />
            )}
            {notifyingCountry && (
              <DetailItem
                label={t("analysis.fields.notifyingCountry")}
                value={notifyingCountry}
              />
            )}
            {originCountry && (
              <DetailItem
                label={t("analysis.fields.origin")}
                value={originCountry}
              />
            )}
            <DetailItem
              label={t("analysis.fields.alertDate")}
              value={formattedDate}
            />
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
        </div>

        {
          <s-box
            padding="base"
            borderRadius="base"
            background="bg-surface-info"
          >
            <s-stack gap="small-100">
              <s-text fontWeight="bold" tone="info" size="small">
                {t("analysis.whyThisMatched")}
              </s-text>
              <s-text>{t("workspace.matchNeedsVerification")}</s-text>
            </s-stack>
          </s-box>
        }

        {/* RISK DESCRIPTION (if present) */}
        {dangerDescription && (
          <s-box
            padding="base"
            borderRadius="base"
            background="bg-surface-critical"
          >
            <s-stack gap="small-100">
              <s-text fontWeight="bold" tone="critical" size="small">
                {t("analysis.riskDescription")}
              </s-text>
              <s-text>{dangerDescription}</s-text>
            </s-stack>
          </s-box>
        )}

        {/* Measures (if present) */}
        {measuresDescription && (
          <s-box
            padding="base"
            borderRadius="base"
            background="bg-surface-warning"
          >
            <s-stack gap="small-100">
              <s-text fontWeight="bold" tone="warning" size="small">
                {t("redesign.officialMeasures")}
              </s-text>
              <s-text size="small">{measuresDescription}</s-text>
            </s-stack>
          </s-box>
        )}

        {/* Product Description */}
        {productDescription && (
          <s-box
            padding="base"
            borderRadius="base"
            background="bg-surface-secondary"
          >
            <s-stack gap="small-100">
              <s-text tone="subdued" size="small">
                {t("analysis.fields.productDescription")}
              </s-text>
              <s-text size="small">{productDescription}</s-text>
            </s-stack>
          </s-box>
        )}

        {/* Legal Provision */}
        {fields.risk_legal_provision &&
          fields.risk_legal_provision !== dangerDescription && (
            <s-box
              padding="base"
              borderRadius="base"
              background="bg-surface-warning"
            >
              <s-stack gap="small-100">
                <s-text fontWeight="bold" tone="warning" size="small">
                  {t("analysis.legalProvision")}
                </s-text>
                <s-text size="small">{fields.risk_legal_provision}</s-text>
              </s-stack>
            </s-box>
          )}
      </s-stack>
    </s-box>
  );
}

function DetailItem({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`match-detail-list__item ${highlight ? "match-detail-list__item--highlight" : ""}`}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
