export type EncodedImage = {
  url: string;
  contentType?: string;
};

export type SafetyCheckAnalysis = {
  mode: "text-only" | "with-image";
  scoringMode: "image-first" | "text-only";
  productImagesProvided: number;
  productImagesUsed: number;
  alertImagesUsed: number;
  candidateAlertsConsidered: number;
};

export type NormalizedAlert = {
  id: string;
  meta: {
    recordid: string;
    alert_date: string;
    ingested_at: string;
    record_timestamp?: string;
  };
  fields: {
    product_category: string;
    product_description: string;
    risk_level: string;
    alert_level: string;
    alert_type: string;
    risk_legal_provision: string;
    notifying_country: string;
    product_brand?: string;
    product_model?: string;
    product_image?: string;
    product_other_images?: string;
    pictures?: string[];
  };
  distance?: number;
  source?: "retriever" | "recent";
};

export type AnalysisMatchCandidate = {
  alertId?: string;
  overallSimilarity?: number;
  imageSimilarity?: number;
  textSimilarity?: number;
  scoreBreakdown?: {
    visualWeight?: number;
    textWeight?: number;
    scoringMode?: "image-first" | "text-only";
  };
  riskLevel?: string;
  alertType?: string;
  riskLegalProvision?: string;
  reason?: string;
};
