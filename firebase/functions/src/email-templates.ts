/** ZeroRecall transactional emails. Pure renderers: no database or delivery side effects. */
import { URL } from "node:url";
import { emailText, normalizeEmailLanguage } from "./email-localization.js";
export type EmailContent = { subject: string; htmlContent: string; textContent: string };
export type AlertEmailDetails = {
  productTitle: string;
  productHandle?: string;
  riskLevel: string;
  overallSimilarity: number | null;
  safetyGateProduct: string;
  reason: string;
  safetyGateImage?: string;
  alertReference?: string;
  model?: string;
  riskType?: string;
};
export type WeeklyEmailMetrics = {
  products: number;
  checks: number;
  safetyGateRecords: number;
  newFindings: number;
  openFindings: number;
  monitoringComplete: boolean;
  lastSuccessfulRun: Date | null;
  findings?: WeeklyEmailFinding[];
};
export type WeeklyEmailFinding = AlertEmailDetails & {
  url: string;
  reviewState: "needs_review" | "waiting_for_supplier" | "resolved" | "dismissed" | "unknown";
  isNew: boolean;
};
export type ScanEmailMatch = {
  productTitle?: string;
  productUrl?: string;
  result?: { warnings?: Array<{ alertId?: string; overallSimilarity?: number }> };
};

const HOME = "https://zerorecall.online";
const SAFETY_GATE = "https://ec.europa.eu/safety-gate-alerts/";
const FONT = "Arial,Helvetica,sans-serif";
const GREEN = "#315e4b";

export function escapeEmailHtml(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

function riskLabel(value: string, language: string): string {
  return ({ serious: emailText(language, "serious"), high: emailText(language, "high"), unknown: emailText(language, "not_available") } as Record<string, string>)[value.toLowerCase()] || value;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 20px;font-size:16px;line-height:1.6">${escapeEmailHtml(text)}</p>`;
}

function facts(rows: Array<[string, string]>, highlightedLabel?: string): string {
  return `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:15px;line-height:1.5">${rows.map(([label, value]) =>
    `<tr><th scope="row" align="left" valign="top" style="width:43%;padding:12px 12px 12px 0;border-bottom:1px solid #dedfd8;font-weight:400;color:#606a64">${escapeEmailHtml(label)}</th><td valign="top" style="padding:12px 0;border-bottom:1px solid #dedfd8;font-weight:600;color:${label === highlightedLabel ? "#93421f" : "#1c2822"};overflow-wrap:anywhere;word-break:break-word">${escapeEmailHtml(value)}</td></tr>`).join("")}</table>`;
}

function note(title: string, text: string, warning = false): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:24px;background:${warning ? "#fff0e2" : "#edf2ec"};border-radius:10px"><tr><td style="padding:22px 24px"><h2 style="margin:0 0 7px;font-size:19px;line-height:1.3;color:${warning ? "#93421f" : GREEN}">${escapeEmailHtml(title)}</h2><p style="margin:0;font-size:15px;line-height:1.6;color:#46534b">${escapeEmailHtml(text)}</p></td></tr></table>`;
}

function shell(options: {
  language: string; title: string; preheader: string; status: string; warning?: boolean;
  body: string; action: string; url: string; after?: string; settingsUrl?: string; footerText?: string;
}): string {
  const language = normalizeEmailLanguage(options.language);
  const actionUrl = httpsUrl(options.url);
  if (!actionUrl) throw new Error("Email action must use an absolute HTTPS URL");
  const settings = httpsUrl(options.settingsUrl);
  return `<!doctype html>
<html lang="${normalizeEmailLanguage(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeEmailHtml(options.title)}</title>
<style>body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}table{mso-table-lspace:0pt;mso-table-rspace:0pt}img{border:0;outline:none;text-decoration:none}a:focus{outline:2px solid #315e4b;outline-offset:3px}@media only screen and (max-width:600px){.outer{padding:24px 18px!important}.headline{font-size:32px!important}.stack{display:block!important;width:100%!important;box-sizing:border-box!important}.photo{max-width:100%!important;width:100%!important}.photo-cell{padding:0 0 18px!important}.button{display:block!important}}</style></head>
<body style="margin:0;padding:0;background:#faf9f5;color:#1c2822;font-family:${FONT}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escapeEmailHtml(options.preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#faf9f5"><tr><td class="outer" align="center" style="padding:40px 28px">
<!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px"><tr><td>
<p style="margin:0 0 38px"><a href="${HOME}" style="font-family:${FONT};font-size:23px;letter-spacing:-1px;font-weight:700;color:#1c2822;text-decoration:none">ZeroRecall</a></p>
<p style="margin:0 0 24px"><span style="display:inline-block;border-radius:24px;padding:10px 16px;background:${options.warning ? "#fff0df" : "#e8efe7"};color:${options.warning ? "#93421f" : GREEN};font-size:13px;font-weight:700;line-height:1.4">${escapeEmailHtml(options.status)}</span></p>
<h1 class="headline" style="margin:0 0 26px;font-size:44px;letter-spacing:-1.5px;line-height:1.12;font-weight:700;color:#15251d">${escapeEmailHtml(options.title)}</h1>
${options.body}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:24px"><tr><td bgcolor="${GREEN}" align="center" style="border-radius:8px;mso-padding-alt:18px 24px"><a class="button" href="${escapeEmailHtml(actionUrl)}" style="display:block;padding:18px 24px;font-family:${FONT};font-size:16px;line-height:1.4;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">${escapeEmailHtml(options.action)}</a></td></tr></table>
${options.after || ""}
<p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#68726b">${emailText(language, "if_the_button_does_not_work_open_this_link")}<br><a href="${escapeEmailHtml(actionUrl)}" style="color:${GREEN};overflow-wrap:anywhere;word-break:break-all">${escapeEmailHtml(actionUrl)}</a></p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:28px;border-top:1px solid #d9ddd4"><tr><td style="padding-top:20px;font-size:12px;line-height:1.8;color:#68726b">
<strong style="color:#243b2e">ZeroRecall</strong> · ${emailText(language, "product_safety_for_shopify")}<br>
${options.footerText ? escapeEmailHtml(options.footerText) : settings ? emailText(language, "you_receive_this_email_based_on_your_store_s_notification_sett") : emailText(language, "this_email_relates_to_your_one_off_scan_request")}<br>
${settings ? `<a href="${escapeEmailHtml(settings)}" style="color:${GREEN}">${emailText(language, "email_preferences")}</a> · ` : ""}<a href="mailto:info@zerorecall.online" style="color:${GREEN}">info@zerorecall.online</a> · <a href="${HOME}" style="color:${GREEN}">zerorecall.online</a>
</td></tr></table>
</td></tr></table><!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}

function plainFooter(language: string, settingsUrl?: string): string {
  return `\n\nZeroRecall · ${emailText(language, "product_safety_for_shopify")}\n${settingsUrl ? `${emailText(language, "email_preferences")}: ${settingsUrl}\n` : ""}info@zerorecall.online\n${HOME}`;
}

export function renderAlertEmail(language: string, details: AlertEmailDetails, shop: string, url: string, settingsUrl: string): EmailContent {
  language = normalizeEmailLanguage(language);
  const title = emailText(language, "we_found_a_possible_match_with_an_eu_safety_gate_alert");
  const status = emailText(language, "product_needs_review");
  const similarity = details.overallSimilarity !== null && Number.isFinite(details.overallSimilarity)
    ? `${Math.round(details.overallSimilarity)} %` : (emailText(language, "not_available"));
  const risk = riskLabel(details.riskLevel, language);
  const rows: Array<[string, string]> = [
    [emailText(language, "store"), shop],
    [emailText(language, "your_product"), details.productTitle],
    [emailText(language, "safety_gate_product"), details.safetyGateProduct],
    [emailText(language, "risk_level"), risk],
    [emailText(language, "similarity"), similarity],
  ];
  if (details.alertReference) rows.push([emailText(language, "alert_reference"), details.alertReference]);
  if (details.model) rows.push([emailText(language, "model_in_the_alert"), details.model]);
  if (details.riskType) rows.push([emailText(language, "risk_type"), details.riskType]);
  const image = httpsUrl(details.safetyGateImage);
  const detailTable = facts(rows, /^(Serious|High)$/i.test(details.riskLevel) ? (emailText(language, "risk_level")) : undefined);
  const body = image
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td class="stack photo-cell" width="43%" valign="top" style="padding:8px 20px 0 0"><img class="photo" src="${escapeEmailHtml(image)}" alt="${escapeEmailHtml(emailText(language, "product_from_the_safety_gate_record"))}" width="240" style="display:block;width:100%;max-width:240px;height:auto;border-radius:10px"><p style="margin:8px 0;font-size:11px;line-height:1.4;color:#68726b">${emailText(language, "photo_from_the_safety_gate_record")}</p></td><td class="stack" valign="top">${detailTable}</td></tr></table>`
    : detailTable;
  const why = emailText(language, "why_this_matched");
  const next = emailText(language, "what_to_do_next");
  const instruction = emailText(language, "compare_the_model_brand_and_batch_with_the_official_record_sav");
  const caution = emailText(language, "a_possible_match_does_not_confirm_that_your_product_is_dangero");
  return {
    subject: `ZeroRecall: ${emailText(language, "product_needs_review")} – ${details.productTitle}`,
    htmlContent: shell({ language, title, status, warning: true, preheader: `${details.productTitle} · ${status}`, body: body + note(why, details.reason), action: emailText(language, "review_possible_match"), url, settingsUrl,
      after: `<div style="margin-top:24px;padding-top:22px;border-top:1px solid #d9ddd4"><h2 style="margin:0 0 8px;font-size:20px">${next}</h2>${paragraph(instruction)}</div>` + note(emailText(language, "verify_the_details_before_deciding"), caution, true) }),
    textContent: `${title}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}\n\n${why}: ${details.reason}\n\n${next}\n${instruction}\n\n${caution}\n\n${url}${plainFooter(language, settingsUrl)}`,
  };
}

function formatDate(date: Date, language: string): string {
  return new Intl.DateTimeFormat(normalizeEmailLanguage(language), { dateStyle: "medium", timeZone: "Europe/Bratislava" }).format(date);
}

export function renderWeeklyEmail(language: string, shop: string, start: Date, end: Date, metrics: WeeklyEmailMetrics, url: string, settingsUrl: string): EmailContent {
  language = normalizeEmailLanguage(language);
  const title = metrics.monitoringComplete ? (emailText(language, "your_week_in_review")) : (emailText(language, "monitoring_was_incomplete"));
  const status = !metrics.monitoringComplete ? (emailText(language, "attention_needed")) : metrics.newFindings ? (emailText(language, "new_findings")) : (emailText(language, "no_new_findings"));
  const summary = !metrics.monitoringComplete
    ? (emailText(language, "a_completed_monitoring_run_could_not_be_confirmed_for_this_per"))
    : metrics.newFindings ? (emailText(language, "value_new_findings_were_created_during_this_period_check_the_a", { value0: metrics.newFindings }))
      : (emailText(language, "no_new_finding_was_created_during_this_period"));
  const period = `${formatDate(start, language)} – ${formatDate(end, language)}`;
  const rows: Array<[string, string]> = [
    [emailText(language, "monitored_products"), String(metrics.products)],
    [emailText(language, "checks_completed"), String(metrics.checks)],
    [emailText(language, "new_safety_gate_records"), String(metrics.safetyGateRecords)],
    [emailText(language, "new_findings"), String(metrics.newFindings)],
    [emailText(language, "open_findings"), String(metrics.openFindings)],
    [emailText(language, "last_successful_run"), metrics.lastSuccessfulRun ? formatDate(metrics.lastSuccessfulRun, language) : (emailText(language, "not_confirmed"))],
  ];
  const caveat = emailText(language, "catalog_products_and_completed_checks_are_different_measures_z");
  const findings = (metrics.findings || []).slice(0, 5);
  const stateLabels = { needs_review: emailText(language, "state_needs_review"), waiting_for_supplier: emailText(language, "state_waiting_for_supplier"), resolved: emailText(language, "state_resolved"), dismissed: emailText(language, "state_dismissed"), unknown: emailText(language, "state_unknown") };
  const findingList = findings.length ? `<h2 style="margin:30px 0 8px;font-size:23px">${emailText(language, "selected_findings")}</h2>${findings.map(finding => {
    const image = httpsUrl(finding.safetyGateImage);
    const link = httpsUrl(finding.url);
    const state = stateLabels[finding.reviewState] || stateLabels.unknown;
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-bottom:1px solid #d9ddd4"><tr>${image ? `<td width="120" valign="top" class="stack photo-cell" style="padding:22px 18px 22px 0"><img src="${escapeEmailHtml(image)}" alt="${escapeEmailHtml(emailText(language, "product_from_the_safety_gate_record"))}" width="120" style="display:block;width:120px;max-width:100%;height:auto;border-radius:8px"><p style="font-size:11px;line-height:1.4;color:#68726b;margin:7px 0 0">${emailText(language, "photo_from_the_safety_gate_record")}</p></td>` : ""}<td valign="top" class="stack" style="padding:22px 0;overflow-wrap:anywhere;word-break:break-word"><p style="margin:0 0 8px;font-size:12px;color:#68726b">${finding.isNew ? (emailText(language, "new_this_period")) : (emailText(language, "older_open_finding"))} · ${escapeEmailHtml(state)}</p><h3 style="font-size:18px;line-height:1.4;margin:0 0 8px">${escapeEmailHtml(finding.productTitle)}</h3><p style="font-size:14px;line-height:1.6;margin:0 0 8px">Safety Gate: ${escapeEmailHtml(finding.safetyGateProduct)}<br>${emailText(language, "risk")}: ${escapeEmailHtml(riskLabel(finding.riskLevel, language))}${finding.overallSimilarity !== null && Number.isFinite(finding.overallSimilarity) ? ` · ${emailText(language, "similarity")}: ${Math.round(finding.overallSimilarity)} %` : ""}</p><p style="font-size:14px;line-height:1.6;margin:0 0 12px">${escapeEmailHtml(finding.reason.slice(0, 300))}${finding.reason.length > 300 ? "…" : ""}</p>${link ? `<a href="${escapeEmailHtml(link)}" style="font-size:14px;font-weight:700;color:${GREEN}">${emailText(language, "open_match_details")}</a>` : ""}</td></tr></table>`;
  }).join("")}${paragraph(emailText(language, "this_email_shows_up_to_five_findings_prioritising_new_ones_fin"))}` : "";
  const findingText = findings.map(finding => `${finding.productTitle}\nSafety Gate: ${finding.safetyGateProduct}\n${emailText(language, "risk")}: ${riskLabel(finding.riskLevel, language)}\n${stateLabels[finding.reviewState] || stateLabels.unknown}\n${finding.reason.slice(0, 300)}\n${httpsUrl(finding.url) || ""}`).join("\n\n");
  return {
    subject: `ZeroRecall: ${metrics.monitoringComplete ? (emailText(language, "weekly_monitoring_summary")) : title} – ${shop}`,
    htmlContent: shell({ language, title, status, warning: !metrics.monitoringComplete || metrics.newFindings > 0, preheader: `${shop} · ${status}`, body: paragraph(`${shop} · ${period}`) + paragraph(summary) + facts(rows) + findingList, action: emailText(language, "open_dashboard"), url, settingsUrl, after: note(emailText(language, "how_to_read_this_summary"), caveat) }),
    textContent: `${title}\n${shop}\n${summary}\n${period}\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}${findingText ? `\n\n${emailText(language, "selected_findings_up_to_5")}\n${findingText}` : ""}\n\n${caveat}\n\n${url}${plainFooter(language, settingsUrl)}`,
  };
}

export function renderVerificationEmail(language: string, domain: string, url: string): EmailContent {
  language = normalizeEmailLanguage(language);
  const title = emailText(language, "one_more_click_then_we_can_begin");
  const intro = emailText(language, "you_requested_a_free_scan_of_a_public_shopify_catalog_confirm_");
  const rows: Array<[string, string]> = [[emailText(language, "store"), domain], [emailText(language, "scan_scope"), emailText(language, "entire_public_catalog")], [emailText(language, "link_expires"), emailText(language, "30_minutes_single_use")]];
  const next = emailText(language, "after_confirmation_and_start_we_will_check_the_available_publi");
  const ignore = emailText(language, "if_you_did_not_request_this_scan_ignore_this_email_the_scan_wi");
  return {
    subject: `ZeroRecall: ${emailText(language, "confirm_the_scan_for")} ${domain}`,
    htmlContent: shell({ language, title, status: emailText(language, "email_confirmation"), preheader: emailText(language, "confirm_the_scan_for_value_link_expires_in_30_minutes", { value0: domain }), body: paragraph(intro) + facts(rows), action: emailText(language, "confirm_email_and_continue"), url, after: note(emailText(language, "what_happens_next"), next) + `<div style="margin-top:24px">${paragraph(ignore)}</div>` }),
    textContent: `${title}\n\n${intro}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}\n\n${url}\n\n${next}\n\n${ignore}${plainFooter(language)}`,
  };
}

export function renderScanReportEmail(language: string, domain: string, lead: { totalProductsScanned: number; flaggedProductsCount: number; matches?: ScanEmailMatch[] }, homeUrl = HOME): EmailContent {
  language = normalizeEmailLanguage(language);
  const title = emailText(language, "your_scan_results_are_ready");
  const status = lead.flaggedProductsCount > 0 ? (emailText(language, "possible_matches_to_review")) : (emailText(language, "no_matches_found"));
  const rows: Array<[string, string]> = [[emailText(language, "store"), domain], [emailText(language, "products_checked"), String(lead.totalProductsScanned)], [emailText(language, "scan_scope"), emailText(language, "entire_public_catalog")], [emailText(language, "potential_matches_to_review"), String(lead.flaggedProductsCount)]];
  const caveat = emailText(language, "these_are_indicative_results_check_any_potential_match_against");
  const intro = emailText(language, "we_completed_a_one_off_comparison_of_available_public_products");
  const matches = (lead.matches || []).slice(0, 5).map(match => {
    const parsed = httpsUrl(match.productUrl);
    const productUrl = parsed && new URL(parsed).hostname === domain ? parsed : null;
    return { title: match.productTitle || (emailText(language, "product")), url: productUrl, reference: match.result?.warnings?.[0]?.alertId };
  });
  const matchesHtml = matches.length ? `<h2 style="margin:28px 0 8px;font-size:21px">${emailText(language, "products_to_review")}</h2>${matches.map(match => `<div style="padding:14px 0;border-bottom:1px solid #d9ddd4"><p style="margin:0;font-size:16px;font-weight:700;line-height:1.5">${match.url ? `<a href="${escapeEmailHtml(match.url)}" style="color:${GREEN}">${escapeEmailHtml(match.title)}</a>` : escapeEmailHtml(match.title)}</p>${match.reference ? `<p style="margin:6px 0 0;font-size:13px;line-height:1.5;color:#68726b">${emailText(language, "safety_gate_record")}: ${escapeEmailHtml(match.reference)}</p>` : ""}</div>`).join("")}${lead.flaggedProductsCount > 5 ? paragraph(emailText(language, "this_email_shows_up_to_five_products")) : ""}` : "";
  const next = emailText(language, "this_scan_is_a_one_off_ongoing_monitoring_and_decision_history");
  const official = `<p style="margin:22px 0 0;font-size:14px;line-height:1.5"><a href="${SAFETY_GATE}" style="color:${GREEN}">${emailText(language, "open_the_official_safety_gate_portal")}</a></p>`;
  const home = httpsUrl(homeUrl) || HOME;
  return {
    subject: `ZeroRecall: ${emailText(language, "catalog_scan_result")} – ${domain}`,
    htmlContent: shell({ language, title, status, warning: lead.flaggedProductsCount > 0, preheader: `${domain} · ${lead.totalProductsScanned} ${emailText(language, "products_checked_2")} · ${status}`, body: paragraph(intro) + facts(rows) + matchesHtml + note(emailText(language, "how_to_interpret_the_result"), caveat, lead.flaggedProductsCount > 0) + official, action: emailText(language, "explore_ongoing_monitoring"), url: `${home.replace(/\/$/, "")}/?lang=${normalizeEmailLanguage(language)}#how-it-works`, after: note(emailText(language, "what_comes_next"), next) }),
    textContent: `${title}\n\n${intro}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}\n\n${matches.map(match => `${match.title}${match.url ? `\n${match.url}` : ""}${match.reference ? `\nSafety Gate: ${match.reference}` : ""}`).join("\n\n")}\n\n${caveat}\n\n${SAFETY_GATE}\n\n${next}\n${home}${plainFooter(language)}`,
  };
}


/** Internal owner notification: request receipt, never a confirmation token or a scan result. */
export function renderFreeScanOwnerEmail(data: { domain: string; email: string; requestedAt: Date }): EmailContent {
  const title = "Nová žiadosť o bezplatný sken";
  const rows: Array<[string, string]> = [
    ["Obchod", data.domain], ["E-mail žiadateľa", data.email],
    ["Prijaté", new Intl.DateTimeFormat("sk", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Bratislava" }).format(data.requestedAt)],
    ["Rozsah", "Celý dostupný verejný katalóg"],
  ];
  const explanation = "Na webe pribudla nová žiadosť. Sken sa spustí až po potvrdení e-mailu žiadateľom. Toto upozornenie nepotvrdzuje dokončenie skenu ani doručenie jeho reportu.";
  const url = `https://${data.domain}/`;
  return {
    subject: `ZeroRecall: nová žiadosť o sken – ${data.domain}`,
    htmlContent: shell({ language: "sk", title, preheader: `${data.domain} · nová žiadosť`, status: "Žiadosť prijatá", body: paragraph(explanation) + facts(rows), action: "Otvoriť obchod", url, footerText: "Interné upozornenie pre prevádzkovateľa ZeroRecall." }),
    textContent: `${title}\n\n${explanation}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}\n\n${url}${plainFooter("sk")}`,
  };
}
