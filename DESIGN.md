---
name: Safety Gate Monitor Design System
description: Cohesive visual design language bridging native Shopify Polaris Admin ergonomics with trusted EU compliance editorial authority
colors:
  primary: "#008060"
  primary-hover: "#006e52"
  primary-surface: "#f0f8f5"
  critical: "#d82c0d"
  critical-surface: "#fdf3f2"
  warning: "#c68400"
  warning-surface: "#fcf8eb"
  editorial-accent: "#b84c28"
  editorial-strong: "#8c2d0f"
  surface: "#ffffff"
  surface-subdued: "#f6f6f7"
  surface-hover: "#f1f2f3"
  border: "#e1e3e5"
  border-subdued: "#ebebeb"
  text: "#202223"
  text-subdued: "#6d7175"
  warm-bg: "#f4efe4"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'San Francisco', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: "1.25"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'San Francisco', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "1.3"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'San Francisco', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "1.35"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'San Francisco', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "1.5"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'San Francisco', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "1.35"
    letterSpacing: "0.04em"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "24px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-critical:
    backgroundColor: "{colors.critical}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
---

# Design System: Safety Gate Monitor

## Overview

**Creative North Star: "The Vigilant Guardian & Native Shopify Cockpit"**

Safety Gate Monitor's design system unifies high-stakes EU regulatory protection with effortless, zero-friction merchant workflow. Inside the Shopify Admin, the interface feels 100% native: calm, restrained, and structured around Shopify Polaris design tokens and web components (`s-` custom elements). It minimizes anxiety while elevating immediate operational clarity.

On customer-facing surfaces, the system projects trustworthy regulatory authority with warm editorial precision. Every element—from high-contrast risk badges to side-by-side product comparison cards—is engineered to guide merchant decisions quickly and auditably without alert fatigue.

**Key Characteristics:**
- **Polaris Native Ergonomics:** Strict adherence to Shopify Admin layout density, typography, and interactive component tokens.
- **Triage-First Hierarchy:** Critical and high-risk alerts visually lead with high-contrast ruby accents, amber warnings for moderate similarities, and calming emerald for verified safe products.
- **Side-by-Side Clarity:** Dedicated comparison structures juxtaposing merchant catalog products against official EU Safety Gate recall documents.
- **Audit-Proof Record:** Clean table rows, status chips, and timestamped activity logs built for regulatory proof.

## Colors

The palette balances Shopify's trusted merchant emerald, high-visibility risk indicators, and calm neutral surfaces.

### Primary
- **Polaris Emerald** (#008060): Primary merchant actions, confirmed safe statuses, active monitoring badges, and brand trust anchors.
- **Deep Emerald Hover** (#006e52): Interactive hover state for primary buttons.
- **Mint Surface** (#f0f8f5): Subtle background tint for success cards, verified-safe rows, and positive audit milestones.

### Secondary
- **Critical Ruby** (#d82c0d): Immediate danger signals, serious/high-risk recall alerts, destructive modal confirmations, and un-dismissed critical items.
- **Critical Tint** (#fdf3f2): Soft red background tint for urgent alert cards and warning banners.

### Tertiary
- **Warning Amber** (#c68400): Moderate similarity matches, items awaiting merchant review, and warning disclosures.
- **Warning Tint** (#fcf8eb): Soft yellow-gold background tint for pending review queues.
- **Editorial Terracotta** (#b84c28): Marketing accent color representing European regulatory vigilance.

### Neutral
- **Ink Charcoal** (#202223): Primary text, headings, and high-contrast labels.
- **Muted Slate** (#6d7175): Secondary helper text, subtitles, timestamp metadata, and table column headers.
- **Card Surface** (#ffffff): Base elevated card background.
- **Canvas Subdued** (#f6f6f7): Background canvas for the admin shell, table zebra rows, and nested fact boxes.
- **Border Neutral** (#e1e3e5): Standard card and panel dividing lines.
- **Border Subdued** (#ebebeb): Inner nested borders and stat dividers.

### Named Rules
**The Triage Hierarchy Rule.** Red (#d82c0d) is strictly reserved for actionable, serious safety hazards. Informational stats and passive states must use neutral slate or emerald trust tones to prevent alarm fatigue.
**The Native Surface Rule.** In Shopify Admin routes, all container backgrounds must inherit either `--surface` (#ffffff) or `--surface-subdued` (#f6f6f7) to guarantee visual unity with the host admin OS.

## Typography

**Display & Body Font:** `-apple-system, BlinkMacSystemFont, "San Francisco", "Segoe UI", Roboto, "Helvetica Neue", sans-serif`  
**Marketing Display Font:** `"Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif`

**Character:** Clean, highly legible, modern administrative typography optimized for dense product tables, legal recall case numbers, and rapid scanning.

### Hierarchy
- **Display** (Bold 700, 24px, line-height 1.25): Dashboard hero titles, status panel headlines, major milestone headers.
- **Headline** (Semi-bold 600, 20px, line-height 1.3): Admin card titles, section headings, modal topbars.
- **Title** (Semi-bold 600, 16px, line-height 1.35): Product names, card subtitles, drawer headers, review queue titles.
- **Body** (Regular 400, 14px, line-height 1.5): Main body paragraphs, product descriptions, risk summaries (max line length 65–75ch).
- **Label / Eyebrow** (Semi-bold 600, 12px, line-height 1.35, letter-spacing 0.04em, uppercase): Section eyebrows, metric labels, table headers, chip captions.

### Named Rules
**The Eyebrow-Title Rule.** Major admin cards lead with an uppercase 12px muted eyebrow before the 20px headline to immediately establish category context.

## Layout

The spatial model uses a strict 4px/8px incremental grid with consistent vertical rhythm.
- **Page Shell:** 12px vertical stack gap with a max responsive width of 1200px.
- **Admin Card Padding:** 18px 20px standard internal padding.
- **Split Panels:** Two-column grid (e.g., `minmax(300px, 1.05fr) minmax(420px, 1.45fr)`) with 18px–20px gap for side-by-side product comparisons.
- **Facts Grid:** Multi-column stat grid (`repeat(2, 1fr)` to `repeat(4, 1fr)`) with 10px spacing for dense summary metrics.
- **Responsive Breakpoints:** 640px (single column stack on mobile), 960px (tablet), 1200px (full desktop cockpit).

## Elevation & Depth

Surfaces rely primarily on tonal layering and crisp 1px borders rather than heavy ambient drop shadows. Depth is functional and subtle.

### Shadow Vocabulary
- **Card Rest** (`box-shadow: 0 1px 0 rgba(22, 29, 37, 0.05)`): Default resting elevation for admin cards and panels.
- **Elevated Hover / Popover** (`box-shadow: 0 1px 0 rgba(22, 29, 37, 0.05), 0 2px 6px rgba(22, 29, 37, 0.08)`): Used for hovered action cards, popovers, and dropdown menus.
- **Focus Ring** (`box-shadow: 0 0 0 3px rgba(0, 128, 96, 0.35)`): High-accessibility keyboard and focus indicator.

### Named Rules
**The Crisp-Border Rule.** Every surface has an explicit 1px border (`--border` or `--border-subdued`). Shadows never float unbordered in administrative screens.

## Shapes

- **Base Radius** (8px / `var(--radius)`): Used for nested buttons, inputs, fact tiles, and individual list rows.
- **Container Radius** (12px / `var(--radius-lg)`): Used for main administrative cards, modals, and major status panels.
- **Marketing Radius** (24px to 32px): Used on public landing hero cards and value panels.
- **Pill Radius** (999px / `var(--radius-full)`): Used for status badges, risk level chips, and language switcher buttons.

## Components

### Buttons
- **Shape:** Gently rounded (8px radius)
- **Primary:** Background `#008060`, text `#ffffff`, padding `8px 16px`, font-weight 600. Hover `#006e52`.
- **Critical:** Background `#d82c0d`, text `#ffffff`, padding `8px 16px`, font-weight 600.
- **Ghost / Tertiary:** Background `transparent`, border `1px solid var(--border)`, text `var(--text)`, padding `8px 16px`. Hover background `var(--surface-hover)`.

### Status Badges & Chips
- **High Risk:** Background `rgba(216, 44, 13, 0.08)`, border `1px solid rgba(216, 44, 13, 0.22)`, text `#d82c0d`, pill radius (999px), font-size 12px, font-weight 600.
- **Needs Review:** Background `rgba(198, 132, 0, 0.08)`, border `1px solid rgba(198, 132, 0, 0.28)`, text `#c68400`.
- **Verified Safe:** Background `rgba(0, 128, 96, 0.08)`, border `1px solid rgba(0, 128, 96, 0.25)`, text `#008060`.

### Cards & Comparison Panels
- **Corner Style:** 12px radius.
- **Background:** Flat `#ffffff` with optional 4% tint overlay for critical status cards.
- **Border:** 1px solid `var(--border)`.
- **Internal Padding:** 18px 20px.

### Alert List Rows
- **Layout:** 3-column grid (`48px minmax(0, 1fr) auto`), 12px gap, 12px 14px padding.
- **Thumbnail:** 48x48px with 10px corner radius and 1px subdued border.
- **Action Group:** Right-aligned quick action buttons (*Review Match*, *Dismiss*, *Resolve*).

## Do's and Don'ts

### Do:
- **Do** use Polaris Web Components with `s-` prefix for all interactive Shopify Admin primitives.
- **Do** provide side-by-side visual comparisons between the Shopify product and the Safety Gate recall alert.
- **Do** use explicit percentage indicators (`overallSimilarity` & `imageSimilarity`) alongside merchant recommendations.
- **Do** maintain full keyboard accessibility and WCAG 2.1 AA color contrast across all severity chips.
- **Do** localize all merchant-facing text through the 24 EU locale files.

### Don't:
- **Don't** use alarmist, panic-inducing copy; focus on proactive peace of mind, clear risk facts, and definitive next steps.
- **Don't** use raw unformatted JSON or technical model debug scores in merchant-facing views.
- **Don't** mutate Shopify product catalog status directly without merchant review action.
- **Don't** mix non-Polaris UI component libraries into the embedded Shopify admin shell.
