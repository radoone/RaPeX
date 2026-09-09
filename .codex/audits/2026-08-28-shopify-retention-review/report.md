# Safety Gate Monitor — Shopify UX and retention audit

Date: 2026-08-28

## Scope

Live local Shopify Admin review of the dashboard, Review Queue, alert detail, decision menu, Catalog Coverage, Monitoring Settings, Audit Trail, audit-report entry point, and narrow-viewport reflow.

Merchant goal: understand whether the catalog is protected, review likely Safety Gate matches, record a defensible decision, and see enough recurring value to keep the subscription active.

## Overall verdict

The core product idea is strong and the alert-review detail is already commercially credible. The product is not ready for Shopify App Store submission yet because the audit-report action opens a blank page, coverage numbers disagree across primary screens, and the live run exposed hydration and accessibility errors. These issues weaken the exact trust promise the product is selling.

## Flow steps

1. **Dashboard — good concept, trust issues.** Clear recurring value through daily monitoring, catalog coverage, closed decisions, and audit history. The app name is still the internal slug, the hero copy is overly subscription-focused, and the 8/22 coverage value conflicts with Catalog Coverage.
2. **Review Queue — healthy.** The active-risk banner, status filters, compact table, and direct Review decision action make the next task obvious.
3. **Alert detail — strongest screen.** Product images, match explanation, confidence, recommended review steps, supplier follow-up, and Safety Gate evidence create a convincing decision workflow.
4. **Decision menu — healthy.** Outcomes are merchant-readable and cover action taken and false-positive cases. Risk severity and risk type still need separate labels.
5. **Catalog Coverage — useful but inconsistent.** The refresh explanation is honest about unchanged products, and search/check actions are clear. It shows 7/22 and 32% while the dashboard shows 8/22 and 36%.
6. **Monitoring Settings — good but too defensive.** Balanced/Broad/Strict presets are understandable. The subscription-value panel should become measured monthly proof instead of explaining why a merchant should keep paying.
7. **Audit report — broken.** Both the dashboard Export proof path and the top Download audit report action opened an empty embedded page.
8. **Audit Trail — valuable, with semantic problems.** Search and filtering work, but some resolved records show the decision as Needs review and use internal language such as delta RAPEX monitoring run. Test-looking product names are also visible in this dev-store evidence.
9. **Narrow viewport — poor.** The multi-column audit table compresses into very narrow columns and becomes hard to scan. A stacked card layout or intentional horizontal table treatment is needed.

## Priority changes

### P0 — before App Store submission

1. Fix `/app/audit-report` so both report CTAs render a usable report or download. Add a visible loading state and retryable error instead of a blank iframe.
2. Establish one coverage definition and one shared calculation. Dashboard, Catalog Coverage, and exported reports must return the same numerator, denominator, and percentage.
3. Fix the `AlertDetailModal` hydration mismatch. The current run replaced server HTML with client content and can create intermittent blank or unstable states.
4. Resolve live Polaris accessibility warnings: missing table header rows, missing accessibility labels on icon-only decision buttons, and invalid modal secondary-action variants.
5. Replace the internal app title `safety-gate-monitor-eu` with a customer-facing brand such as `Safety Gate Monitor` everywhere the merchant sees it.

### P1 — conversion and retention

1. Change the dashboard hero from “Keep ... active” to an outcome: “Your catalog is monitored against new EU Safety Gate alerts every day.” Keep the subscription argument in supporting proof, not the headline.
2. Add a compact activation checklist for new stores: catalog connected, initial coverage complete, first monitoring run complete, review workflow understood, sample audit report available.
3. Turn the settings-side subscription panel into measured proof for the current billing period: products monitored, new Safety Gate updates processed, decisions recorded, and last successful automatic run. Only show real measured values.
4. Separate `Severity: Serious` from `Risk type: Chemical`. Do not label Chemical as the risk level.
5. Use unambiguous localized dates such as `9 Jul 2026`; the current UI mixes `7/9/2026` and `09/07/2026`.
6. Replace internal audit language such as `delta RAPEX monitoring run` with merchant outcomes and prevent resolved rows from displaying `Needs review` as the decision.
7. Make the Review Queue and Catalog Coverage visible as explicit app navigation destinations; the current navigation exposes Review Queue and Settings but makes catalog coverage behave like the app home.

### P2 — polish

1. Use stacked audit-history cards below the desktop breakpoint, or preserve readable columns with a clearly scrollable table and sticky product/status columns.
2. Shorten repeated dashboard sections. Current protection, Monitoring status, and Coverage action repeat the same 8/22 story before the merchant reaches the urgent alert.
3. Keep the strong alert detail, but place the product and first Safety Gate image in a more explicit side-by-side comparison at the top.

## Accessibility risks observed

- Live Polaris warning: the catalog table is missing a header row.
- Live Polaris warnings: several icon-only decision buttons do not have accessibility labels.
- Live Polaris warning: modal secondary actions use unsupported button variants.
- The narrow layout makes evidence text extremely compressed and difficult to read.
- Focus order, keyboard completion of a decision, screen-reader announcements, contrast ratios, and 200% zoom were not fully verified in this screenshot-led pass.

## Evidence

- `01-dashboard.png`
- `02-review-queue.png`
- `03-alert-detail.png`
- `04-decision-options.png`
- `05-catalog-coverage.png`
- `06-settings.png`
- `07-audit-report-blank.png`
- `08-decision-history.png`
- `09-mobile-history.png`

## Limits

The store already contained products and historical decisions, so the first-install flow, empty state, trial/pricing redirect, app listing, permissions approval screen, uninstall/reinstall behavior, and notification delivery were not validated. The narrow-viewport check reflects responsive reflow in Shopify Admin, not a complete native Shopify mobile-app test.
