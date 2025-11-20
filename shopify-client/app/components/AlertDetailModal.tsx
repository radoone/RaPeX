import {
  Modal,
  BlockStack,
  InlineStack,
  Text,
  Card,
  Badge,
  Banner,
  Button,
  InlineGrid,
  Divider,
  Icon,
  Thumbnail,
} from "@shopify/polaris";
import { useState } from "react";
import { AlertBadge } from "./AlertBadge";
import { StatusBadge } from "./StatusBadge";
import {
  AlertDiamondIcon,
  CheckCircleIcon,
  ClipboardChecklistIcon,
  ClockIcon,
  HideIcon,
  RefreshIcon,
} from "@shopify/polaris-icons";

interface AlertDetailModalProps {
  alert: any;
  open: boolean;
  onClose: () => void;
  onDismiss?: (alertId: string) => void;
  onResolve?: (alertId: string) => void;
  onReactivate?: (alertId: string) => void;
  isLoading?: boolean;
}

export function AlertDetailModal({
  alert,
  open,
  onClose,
  onDismiss,
  onResolve,
  onReactivate,
  isLoading = false
}: AlertDetailModalProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  if (!alert) return null;

  let checkResult: any = null;
  let parseError: string | null = null;

  try {
    checkResult = alert.checkResult ? JSON.parse(alert.checkResult) : null;
  } catch (error) {
    parseError = error instanceof Error ? error.message : 'Unable to read safety check results.';
  }

  const warnings: any[] = Array.isArray(checkResult?.warnings) ? checkResult.warnings : [];
  const recommendation = checkResult?.recommendation ?? 'Review this product before continuing to sell it.';
  const checkedAt = checkResult?.checkedAt ? new Date(checkResult.checkedAt) : null;
  const isSafe = checkResult?.isSafe === true;
  const warningsCount = warnings.length || alert.warningsCount || 0;

  const headerBadges = (
    <InlineStack gap="200" wrap>
      <AlertBadge
        alertLevel={alert.riskLevel}
        alertType={alert.alertType}
        riskDescription={alert.riskDescription}
      />
      <StatusBadge status={alert.status} />
      <Badge tone={warningsCount > 0 ? 'critical' : 'success'}>
        {`${warningsCount} ${warningsCount === 1 ? 'match' : 'matches'}`}
      </Badge>
    </InlineStack>
  );

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`Safety Alert: ${alert.productTitle}`}
        size="large"
        primaryAction={alert.status === 'active' && onResolve ? {
          content: 'Resolve',
          icon: CheckCircleIcon,
          onAction: () => onResolve(alert.id),
          loading: isLoading
        } : undefined}
        secondaryActions={[
          ...(alert.status === 'active' && onDismiss ? [{
            content: 'Dismiss',
            icon: HideIcon,
            onAction: () => onDismiss(alert.id),
            loading: isLoading,
            destructive: true
          }] : []),
          ...((alert.status === 'dismissed' || alert.status === 'resolved') && onReactivate ? [{
            content: 'Reactivate',
            icon: RefreshIcon,
            onAction: () => onReactivate(alert.id),
            loading: isLoading
          }] : [])
        ]}
      >
        <Modal.Section>
          <BlockStack gap="500">
            <Card background="bg-surface-secondary" padding="400" roundedAbove="sm">
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="400" blockAlign="center">
                    {alert.productImage && (
                      <div onClick={() => setSelectedImage(alert.productImage)} style={{ cursor: 'pointer' }}>
                        <Thumbnail
                          source={alert.productImage}
                          alt={alert.productTitle}
                          size="large"
                        />
                      </div>
                    )}
                    <BlockStack gap="200">
                      <Text as="h2" variant="headingMd">
                        {alert.productTitle}
                      </Text>
                      {headerBadges}
                    </BlockStack>
                  </InlineStack>
                  {checkedAt && (
                    <InlineStack gap="100" blockAlign="center">
                      <Icon source={ClockIcon} tone="subdued" />
                      <Text as="span" variant="bodySm" tone="subdued">
                        Checked {checkedAt.toLocaleString('en-GB')}
                      </Text>
                    </InlineStack>
                  )}
                </InlineStack>

                {alert.notes && (
                  <Card background="bg-surface-info">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="bold">
                        Internal notes
                      </Text>
                      <Text as="p" variant="bodySm">{alert.notes}</Text>
                    </BlockStack>
                  </Card>
                )}
              </BlockStack>
            </Card>

            {parseError ? (
              <Banner tone="critical" title="Unable to display safety results">
                <p>{parseError}</p>
              </Banner>
            ) : (
              <BlockStack gap="400">
                <Banner
                  tone={isSafe ? 'success' : 'critical'}
                  icon={isSafe ? CheckCircleIcon : AlertDiamondIcon}
                  title={isSafe ? 'No issues found' : 'Potential safety risk detected'}
                >
                  <p>{recommendation}</p>
                  {checkedAt && (
                    <p>Checked at: {checkedAt.toLocaleString('en-GB')}</p>
                  )}
                </Banner>

                {warnings.length > 0 ? (
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">
                      Safety Gate matches
                    </Text>
                    {warnings.map((warning: any, index: number) => {
                      const fields = warning.alertDetails?.fields || {};
                      const meta = warning.alertDetails?.meta || {};
                      const alertDate = fields.alert_date || meta.alert_date;
                      const formattedDate = alertDate ? new Date(alertDate).toLocaleDateString('en-GB') : 'N/A';
                      const similarity = warning.similarity ?? 0;
                      const alertIdentifier = warning.alertId || `#${index + 1}`;

                      // Pictures are now normalized by the API into an array of strings
                      let pictures = Array.isArray(fields.pictures) ? fields.pictures : [];

                      // Fallback: If pictures array is empty, try to use legacy product_image and product_other_images fields
                      if (pictures.length === 0) {
                        if (fields.product_image) {
                          pictures.push(fields.product_image);
                        }
                        if (fields.product_other_images && typeof fields.product_other_images === 'string') {
                          const otherImages = fields.product_other_images.split(',').map((s: string) => s.trim()).filter(Boolean);
                          pictures.push(...otherImages);
                        }
                      }

                      return (
                        <Card key={`${alertIdentifier}-${index}`} padding="400" background="bg-surface-critical">
                          <BlockStack gap="300">
                            <InlineStack align="space-between" blockAlign="start">
                              <BlockStack gap="100">
                                <InlineStack gap="200" blockAlign="center">
                                  <Icon source={AlertDiamondIcon} tone="critical" />
                                  <Text as="h4" variant="headingMd">
                                    Alert {alertIdentifier}
                                  </Text>
                                </InlineStack>
                                <InlineStack gap="200" wrap>
                                  <AlertBadge
                                    alertLevel={fields.alert_level}
                                    alertType={fields.alert_type}
                                    riskDescription={warning.riskLegalProvision}
                                  />
                                  <Badge tone="info">{`${similarity}% similarity`}</Badge>
                                </InlineStack>
                              </BlockStack>
                              {fields.rapex_url && (
                                <Button
                                  variant="secondary"
                                  size="slim"
                                  onClick={() => {
                                    window.open(
                                      fields.rapex_url,
                                      'SafetyGatePortal',
                                      'width=1200,height=800,left=100,top=100,resizable=yes,scrollbars=yes'
                                    );
                                  }}
                                  icon={ClipboardChecklistIcon}
                                >
                                  Open Safety Gate
                                </Button>
                              )}
                            </InlineStack>

                            <Divider />

                            <InlineGrid columns={['twoThirds', 'oneThird']} gap="400">
                              <BlockStack gap="200">
                                <Text as="p" variant="bodyMd">
                                  <strong>Reason:</strong> {warning.reason || 'Not specified'}
                                </Text>

                                <InlineGrid columns={{ xs: 1, md: 2 }} gap="200">
                                  {[{
                                    label: 'Alert level',
                                    value: fields.alert_level || 'N/A',
                                  }, {
                                    label: 'Alert type',
                                    value: fields.alert_type || 'N/A',
                                  }, {
                                    label: 'Category',
                                    value: fields.product_category || 'N/A',
                                  }, {
                                    label: 'Brand',
                                    value: fields.product_brand || 'N/A',
                                  }, {
                                    label: 'Country',
                                    value: fields.notifying_country || 'N/A',
                                  }, {
                                    label: 'Alert date',
                                    value: formattedDate,
                                  }].map(({ label, value }) => (
                                    <BlockStack key={`${alertIdentifier}-${label}`} gap="100">
                                      <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
                                      <Text as="p" variant="bodyMd" fontWeight="semibold">{value}</Text>
                                    </BlockStack>
                                  ))}
                                </InlineGrid>

                                {fields.risk_legal_provision && (
                                  <Card background="bg-surface-secondary">
                                    <BlockStack gap="100">
                                      <Text as="p" variant="bodySm" fontWeight="bold">
                                        Risk legal provision
                                      </Text>
                                      <Text as="p" variant="bodySm">{fields.risk_legal_provision}</Text>
                                    </BlockStack>
                                  </Card>
                                )}

                                {fields.product_description && (
                                  <BlockStack gap="100">
                                    <Text as="p" variant="bodySm" fontWeight="bold">Description</Text>
                                    <Text as="p" variant="bodySm">{fields.product_description}</Text>
                                  </BlockStack>
                                )}

                                {fields.alert_number && (
                                  <Text as="p" variant="bodySm" fontWeight="bold">
                                    Alert number: <Text as="span" variant="bodySm">{fields.alert_number}</Text>
                                  </Text>
                                )}
                              </BlockStack>

                              {/* Alert Images */}
                              <BlockStack gap="200">
                                <Text as="h5" variant="headingSm">Alert Images</Text>
                                {pictures.length > 0 ? (
                                  <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))',
                                    gap: '8px'
                                  }}>
                                    {pictures.slice(0, 4).map((pic: any, i: number) => {
                                      const src = typeof pic === 'string' ? pic : (pic.url || pic.src);
                                      if (!src) return null;

                                      return (
                                        <div key={i}
                                          onClick={() => setSelectedImage(src)}
                                          style={{
                                            aspectRatio: '1',
                                            overflow: 'hidden',
                                            borderRadius: '4px',
                                            border: '1px solid var(--p-color-border)',
                                            cursor: 'pointer'
                                          }}>
                                          <img
                                            src={src}
                                            alt={`Alert image ${i + 1}`}
                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                          />
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div style={{
                                    background: 'var(--p-color-bg-surface-tertiary)',
                                    borderRadius: '4px',
                                    padding: '16px',
                                    textAlign: 'center'
                                  }}>
                                    <Text as="p" tone="subdued" variant="bodySm">No images available</Text>
                                  </div>
                                )}
                              </BlockStack>
                            </InlineGrid>
                          </BlockStack>
                        </Card>
                      );
                    })}
                  </BlockStack>
                ) : (
                  <Card padding="400" background="bg-surface-success">
                    <BlockStack gap="200">
                      <InlineStack gap="200" blockAlign="center">
                        <Icon source={CheckCircleIcon} tone="success" />
                        <Text as="p" variant="bodyMd">
                          No Safety Gate matches were found for this alert.
                        </Text>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                )}
              </BlockStack>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Image Lightbox Modal */}
      {selectedImage && (
        <Modal
          open={!!selectedImage}
          onClose={() => setSelectedImage(null)}
          title="Image Preview"
          size="large"
        >
          <Modal.Section>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '300px' }}>
              <img
                src={selectedImage}
                alt="Full size preview"
                style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }}
              />
            </div>
          </Modal.Section>
        </Modal>
      )}
    </>
  );
}
