export function officialSource(fields: Record<string, any>) {
  const value = fields.caseNumber || fields.alert_number;
  const caseNumber =
    typeof value === "string" &&
    /^(?:[A-Z][A-Z\d]*\/)?\d{3,}\/\d{2,4}$/i.test(value.trim())
      ? value.trim()
      : null;
  let url: string | null = null;
  for (const candidate of [fields.url, fields.rapex_url, fields.reference]) {
    try {
      const parsed = new URL(candidate);
      if (
        parsed.protocol === "https:" &&
        !parsed.username &&
        !parsed.password &&
        !parsed.port &&
        (parsed.hostname === "ec.europa.eu" ||
          parsed.hostname.endsWith(".ec.europa.eu"))
      ) {
        url = parsed.href;
        break;
      }
    } catch {
      /* Missing or non-URL legacy reference. */
    }
  }
  return { caseNumber, url };
}
export function parseEvidence(checkResult?: string | null) {
  try {
    const parsed = checkResult ? JSON.parse(checkResult) : {};
    const warning = parsed.warnings?.[0] || {};
    const fields = warning.alertDetails?.fields || {};
    return {
      ...officialSource(fields),
      reason: warning.reason || "",
      sourceRisk: fields.danger || fields.alert_description || fields.risk_legal_provision || "",
      riskLevel:
        fields.level ||
        fields.alert_level ||
        fields.risk_level ||
        warning.riskLevel ||
        "",
      overallSimilarity: warning.overallSimilarity ?? "",
      alertType:
        warning.alertType || fields.riskType || fields.alert_type || "",
      recommendation: parsed.recommendation || "",
    };
  } catch {
    return {
      caseNumber: null,
      url: null,
      reason: "",
      sourceRisk: "",
      riskLevel: "",
      overallSimilarity: "",
      alertType: "",
      recommendation: "",
    };
  }
}
export function isWaitingForSupplier(record: {
  reviewState?: string;
  resolutionType?: string | null;
  status?: string;
}) {
  return (
    record.status === "active" &&
    (record.reviewState === "waiting_for_supplier" ||
      record.reviewState === "contacted_supplier" ||
      record.resolutionType === "contacted_supplier")
  );
}
export function decisionKey(type?: string | null) {
  const keys: Record<string, string> = {
    verified_safe: "resolveActions.verifiedSafe",
    match_not_confirmed: "workspace.matchNotConfirmed",
    removed_from_sale: "resolveActions.removedFromSale",
    modified_product: "resolveActions.modifiedProduct",
    contacted_supplier: "resolveActions.contactedSupplier",
    false_positive: "resolveActions.falsePositive",
    not_my_product: "resolveActions.notMyProduct",
    other: "resolveActions.other",
  };
  return type && Object.hasOwn(keys, type)
    ? keys[type]
    : "workspace.notRecorded";
}
