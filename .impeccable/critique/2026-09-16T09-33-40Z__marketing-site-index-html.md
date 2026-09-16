---
target: marketing-site/index.html
total_score: 28
max_score: 32
na_heuristics: 7,10
p0_count: 0
p1_count: 1
target_identity: "file:/Users/radoone/Devel/rapex/marketing-site/index.html"
target_fingerprint: "sha256:546cc014e5ad814a9c266d40bf9d027333fd601fd98ca163a441a82660bfc5e7"
target_path: /Users/radoone/Devel/rapex/marketing-site/index.html
timestamp: 2026-09-16T09-33-40Z
slug: marketing-site-index-html
---
# Design Critique: Safety Gate Monitor Marketing Landing Page
Target: marketing-site/index.html
Surface Mode: Persuade

Method: dual-agent (A: 18bda009-9e81-4004-b4af-f7c1c9a98986 · B: 4673d7f1-74f4-4e82-9611-a376bbdb3a0c)

### Design Health Score

| # | Heuristic | Score | Key Issue / Context |
|---|-----------|:---:|---------------------|
| 1 | Visibility of System Status | 3.5/4 | Hero preview visualizes decision state; language switcher shows active state. |
| 2 | Match System / Real World | 4.0/4 | Flawless alignment with EU compliance (GPSR, SOI, BAuA, recall case numbers, 3-day refunds). |
| 3 | User Control and Freedom | 3.5/4 | Smooth scroll anchors, sticky back-to-top, and URL-synced language switching. |
| 4 | Consistency and Standards | 3.8/4 | Strict semantic color tokens (amber warning, red recall, emerald active/safe). |
| 5 | Error Prevention | 3.2/4 | Native HTML5 required/type constraints on form inputs with helpful placeholders. |
| 6 | Recognition Rather Than Recall | 4.0/4 | Side-by-side scooter comparison demonstrates AI image matching without abstract jargon. |
| 7 | Flexibility and Efficiency | n/a | Landing page is a single-conversion funnel; accelerators not applicable. |
| 8 | Aesthetic and Minimalist Design | 3.5/4 | Sophisticated warm editorial glassmorphism; risk/FAQ cards are slightly text-dense. |
| 9 | Error Recovery | 2.5/4 | Relies on browser default validation tooltips; lacks custom inline error messaging. |
| 10 | Help and Documentation | n/a | Self-contained 7-question FAQ provides exhaustive domain and legal answers. |
| **Total** | | **28.0/32** | **Good (87.5%)** |

### Design Specificity Verdict

- **LLM Assessment:** Exemplary High-Domain Specificity. Custom-crafted for European e-commerce compliance and Shopify merchant operations. The visual identity (warm alabaster cream, carbon ink, terracotta accent, and classical serif display headers) projects authoritative editorial trust.
- **Deterministic Scan:** 33 findings (12 warnings, 21 advisories). Valid actionable findings include sub-11px badge text (`0.65rem` in `.compare-box__media-badge`), inline color overrides, and small secondary touch targets (<38px). False positives filtered: regex misidentifying recall code `#A12/00892/24` as a hex color, and display serif font usage.

### Overall Impression
Safety Gate Monitor's landing page delivers a high-trust, persuasive compliance proposition. It successfully converts an intimidating regulatory requirement (GPSR / €332k fines) into an empowering merchant advantage (*"Sell with complete peace of mind"*).

### What's Working
1. **Unrivaled Domain Grounding:** Cites real regulatory mechanisms (35,000+ EU records, weekly Friday sync, 3-day refund obligations, national inspection authorities).
2. **Visual Proof Over Verbal Claims:** The dark-mode Shopify Admin preview card immediately teaches how visual AI identifies rebranded dangerous items.
3. **Frictionless Lead Magnet:** High-intent "Free Store Safety Scan" with zero commitment creates a compelling conversion funnel.

### Priority Issues

- **[P1] Hero Preview Action Buttons Cause Unexpected Page Jump**
  - *Why it matters:* Clicking *"Review Match"*, *"Dismiss"*, or *"Resolve"* inside the hero mockup abruptly scrolls the user to `#install` at the page bottom, breaking mockup immersion.
  - *Fix:* Convert buttons into interactive preview states with microcopy (e.g., *"Shopify Admin Action Preview"*), or disable navigation jumps while retaining native button styling.
  - *Suggested command:* `/impeccable polish` or `/impeccable clarify`

- **[P2] Undersized Badge Text (<11px) & Secondary Touch Targets**
  - *Why it matters:* Media badges (`0.65rem` / 10.4px) and secondary source chips fall below accessibility thresholds, compromising legibility on mobile.
  - *Fix:* Bump media badges to `0.75rem` (12px) and ensure interactive link chips meet at least 38–44px hit areas.
  - *Suggested command:* `/impeccable typeset` or `/impeccable adapt`

- **[P3] Single Hero CTA Without Direct Domain Input**
  - *Why it matters:* High-intent merchants must scroll to the bottom to enter their domain instead of beginning their scan directly in the hero fold.
  - *Fix:* Add an optional inline domain quick-start input within the hero section that pre-fills and smooth-scrolls or submits directly.
  - *Suggested command:* `/impeccable harden`

### Persona Red Flags

- **Jordan (First-Timer Merchant):** Reassured by simple 3-step workflow, but might worry the app alters live products without permission. (Clarify in hero copy that the monitor is advisory and never mutates live store status).
- **Elena (Slovak/EU Store Owner Anxious About Fines):** Exceptional resonance. Slovak localization and authoritative links to SOI / GPSR EUR-Lex provide complete regulatory trust.
- **Casey (Distracted Mobile User):** The hero comparison card stacks sequentially on narrow mobile screens (<400px), extending scroll height before reaching trust proof badges.

### Minor Observations & Questions
- The marketing site offers EN and SK switchers; expanding top EU languages (DE, FR, CZ, PL) would widen international top-of-funnel reach.
- *What if the hero featured a live 10-second instant check demo on 3 pre-selected sample products?*
- *Could a dynamic 'Weekly Alert Pulse' banner (e.g. "74 new recalls added this Friday") reinforce real-time monitoring?*
