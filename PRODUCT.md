# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary:** Shopify merchants selling physical goods in the EU and EEA (toys, baby gear, electronics, cosmetics, fashion, home goods, sporting equipment).
- **Secondary:** E-commerce operators, dropshippers, and wholesale importers who source white-label products from overseas manufacturers and need automated verification against EU safety bans.
- **Compliance & Legal Leads:** Store owners preparing for General Product Safety Regulation (GPSR / Regulation EU 2023/988) compliance audits and national market surveillance inspections (SOI, ČOI, BAuA, DGCCRF, UOKiK).

## Product Purpose

Safety Gate Monitor is an automated compliance and risk protection platform for Shopify. It continuously cross-references a merchant's product catalog against the official European Commission EU Safety Gate (formerly RAPEX) database of dangerous non-food products. It alerts merchants before risky products cause customer injury, customs seizures, mandatory public recalls, or catastrophic regulatory fines (up to €100,000+).

## Positioning

The only multimodal AI-powered Safety Gate monitoring solution embedded directly into the native Shopify Admin. Unlike manual keyword searches or basic title matching, Safety Gate Monitor uses Vertex AI multimodal vector embeddings and Gemini Flash arbitration to catch dangerous products even when suppliers change product titles, translate descriptions, or rebrand white-label goods.

## Operating Context

- **Shopify Admin App (`shopify-client`):** Embedded React Router 7 app utilizing Shopify Polaris Web Components (`s-` custom elements) and Admin UI extensions on product detail pages. Workflow follows: *Review match → Compare product side-by-side → Choose action (Resolve / Dismiss) → Maintain audit trail*.
- **Public Marketing Site (`marketing-site`):** High-converting landing page deployed on Firebase Hosting with interactive product safety scans, lead generation, and regulatory guidance across official EU languages.
- **Automated Lifecycle:** Weekly delta loader syncs official EU XML reports published every Friday; background monitors check merchant catalogs; Brevo triggers immediate alert emails and Monday morning peace-of-mind digest summaries.

## Capabilities and Constraints

- **Capabilities:**
  - Automated weekly 24/7 Safety Gate delta monitoring.
  - On-demand single product and bulk catalog safety checks.
  - Multimodal visual photo & text similarity scoring (`overallSimilarity` + `imageSimilarity`).
  - Native Shopify Admin product page extension widgets.
  - Immutable compliance audit logs & exportable evidence reports.
  - Multilingual support for all 24 official EU languages.
- **Constraints:**
  - Operates under read-only Shopify product scope (`read_products`) to ensure frictionless Shopify App Store review. Does not mutate Shopify live catalog status directly; creates actionable merchant review alerts.
  - Relies on Firestore multi-tenant schema with Vertex AI multimodal vector indexes.
  - Native Shopify billing integration with managed pricing and partner test modes.

## Brand Commitments

- **Name:** Safety Gate Monitor (EU Safety Gate Compliance).
- **Voice & Tone:** Authoritative, reassuring, legally precise, calm, and merchant-protective. Focuses on "Peace of mind" (Pokoj na duši) rather than fear-mongering.
- **Visual Identity:** Professional compliance dark/light navy aesthetic (`#0f172a`, `#1e293b`), emerald green trust accents (`#10b981`), amber warnings (`#f59e0b`), and high-visibility ruby risk badges (`#ef4444`). Native Polaris harmony.

## Evidence on Hand

- Official EU Safety Gate weekly XML feed integration (`ec.europa.eu/safety-gate-alerts`).
- Authoritative regulatory links to EU Regulation 2023/988 (GPSR) and national market inspection authorities (SOI, ČOI, BAuA, DGCCRF).
- Real-world Safety Gate recall case archives with high-res photos, risk descriptions, and batch records.

## Product Principles

1. **Zero False-Alarm Fatigue:** Two-stage retrieval uses Cosine Distance threshold pre-filtering before invoking multimodal LLM arbitration, ensuring merchants only see high-confidence, actionable matches.
2. **Action-Oriented Decision Making:** Highlight the Shopify product alongside the Safety Gate recall with visual similarity breakdown and instant one-click actions (*Review Match*, *Dismiss*, *Resolve*).
3. **100% Native Shopify Feel:** Design strictly with Shopify Polaris design language and web components so it feels like a native part of the Shopify operating system.
4. **Audit-Proof Compliance Trail:** Maintain immutable timestamped records of every check, dismiss, resolution, and notification to protect merchants during official audits.

## Accessibility & Inclusion

- Adhere to WCAG 2.1 AA color contrast for all status badges, comparison cards, and severity chips.
- Semantic HTML and full ARIA labeling for interactive Polaris custom components and comparison dialogues.
- Full i18n support across 24 official EU languages with native language switcher.
