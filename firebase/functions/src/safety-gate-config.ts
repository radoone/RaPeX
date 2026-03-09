const ODS_FACETS = [
  "alert_level",
  "alert_group",
  "alert_country",
  "product_country",
  "product_counterfeit",
  "alert_type",
  "product_type",
  "product_brand",
  "product_category",
  "oecd_portal_category",
  "technical_defect",
  "alert_other_countries",
  "measures_country",
] as const;

export const SAFETY_GATE_CONFIG = {
  dataset: "healthref-europe-rapex-en",
  baseUrl: "https://public.opendatasoft.com/api/records/1.0/search",
  defaultSort: "-alert_date,-record_timestamp",
  facets: [...ODS_FACETS],
  rowsPerPage: parseInt(process.env.ROWS_PER_PAGE || "500", 10),
  maxPages: parseInt(process.env.MAX_PAGES || "20", 10),
  bootstrapDays: 30,
  filterRiskLevel: process.env.SAFETY_GATE_FILTER_RISK_LEVEL,
  textEmbedder: "googleai/text-embedding-004",
  imageEmbedder: "googleai/multimodalembedding@001",
  imageFetchTimeoutMs: 10000,
  requestTimeoutMs: 30000,
  testRequestTimeoutMs: 15000,
} as const;

export const FIRESTORE_COLLECTIONS = {
  alerts: "rapex_alerts",
  meta: "rapex_meta",
  loaderStateDoc: "loader_state",
} as const;

export const SAFETY_GATE_HEADERS = {
  accept: "application/json",
  loaderUserAgent: "Safety-Gate-Loader/1.0",
  testUserAgent: "Safety-Gate-API-Test/1.0",
} as const;

export const SCHEDULER_CONFIG = {
  schedule: "13 3 * * *",
  timeZone: "Europe/Bratislava",
  region: "europe-west1",
} as const;

export const PRODUCT_SAFETY_API_USAGE = {
  GET: "/checkProductSafetyAPI?name=Product&category=toys&description=Description",
  POST: "/checkProductSafetyAPI with JSON body: {name, category, description, imageUrl?, brand?, model?}",
} as const;
