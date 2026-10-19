/** ZeroRecall transactional emails. Pure renderers: no database or delivery side effects. */
import { URL } from "node:url";
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

function riskLabel(value: string, sk: boolean): string {
  return ({ serious: sk ? "Závažná" : "Serious", high: sk ? "Vysoká" : "High", unknown: sk ? "Neuvedená" : "Not available" } as Record<string, string>)[value.toLowerCase()] || value;
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
  body: string; action: string; url: string; after?: string; settingsUrl?: string;
}): string {
  const sk = options.language === "sk";
  const actionUrl = httpsUrl(options.url);
  if (!actionUrl) throw new Error("Email action must use an absolute HTTPS URL");
  const settings = httpsUrl(options.settingsUrl);
  return `<!doctype html>
<html lang="${sk ? "sk" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeEmailHtml(options.title)}</title>
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
<p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#68726b">${sk ? "Ak tlačidlo nefunguje, otvorte tento odkaz:" : "If the button does not work, open this link:"}<br><a href="${escapeEmailHtml(actionUrl)}" style="color:${GREEN};overflow-wrap:anywhere;word-break:break-all">${escapeEmailHtml(actionUrl)}</a></p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:28px;border-top:1px solid #d9ddd4"><tr><td style="padding-top:20px;font-size:12px;line-height:1.8;color:#68726b">
<strong style="color:#243b2e">ZeroRecall</strong> · ${sk ? "Bezpečnosť produktov pre Shopify" : "Product safety for Shopify"}<br>
${settings ? (sk ? "Dostávate tento e-mail na základe nastavení upozornení vášho obchodu." : "You receive this email based on your store's notification settings.") : (sk ? "Tento e-mail súvisí s vašou žiadosťou o jednorazový sken." : "This email relates to your one-off scan request.")}<br>
${settings ? `<a href="${escapeEmailHtml(settings)}" style="color:${GREEN}">${sk ? "Nastavenia e-mailov" : "Email preferences"}</a> · ` : ""}<a href="mailto:info@zerorecall.online" style="color:${GREEN}">info@zerorecall.online</a> · <a href="${HOME}" style="color:${GREEN}">zerorecall.online</a>
</td></tr></table>
</td></tr></table><!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}

function plainFooter(language: string, settingsUrl?: string): string {
  return `\n\nZeroRecall · ${language === "sk" ? "Bezpečnosť produktov pre Shopify" : "Product safety for Shopify"}\n${settingsUrl ? `${language === "sk" ? "Nastavenia e-mailov" : "Email preferences"}: ${settingsUrl}\n` : ""}info@zerorecall.online\n${HOME}`;
}

export function renderAlertEmail(language: string, details: AlertEmailDetails, shop: string, url: string, settingsUrl: string): EmailContent {
  const sk = language === "sk";
  const title = sk ? "Našli sme možnú zhodu s upozornením v databáze EÚ Safety Gate." : "We found a possible match with an EU Safety Gate alert.";
  const status = sk ? "Produkt potrebuje preverenie" : "Product needs review";
  const similarity = details.overallSimilarity !== null && Number.isFinite(details.overallSimilarity)
    ? `${Math.round(details.overallSimilarity)} %` : (sk ? "Neuvedená" : "Not available");
  const risk = riskLabel(details.riskLevel, sk);
  const rows: Array<[string, string]> = [
    [sk ? "Obchod" : "Store", shop],
    [sk ? "Váš produkt" : "Your product", details.productTitle],
    [sk ? "Produkt Safety Gate" : "Safety Gate product", details.safetyGateProduct],
    [sk ? "Úroveň rizika" : "Risk level", risk],
    [sk ? "Podobnosť" : "Similarity", similarity],
  ];
  if (details.alertReference) rows.push([sk ? "Číslo upozornenia" : "Alert reference", details.alertReference]);
  if (details.model) rows.push([sk ? "Model v upozornení" : "Model in the alert", details.model]);
  if (details.riskType) rows.push([sk ? "Druh rizika" : "Risk type", details.riskType]);
  const image = httpsUrl(details.safetyGateImage);
  const detailTable = facts(rows, /^(Serious|High)$/i.test(details.riskLevel) ? (sk ? "Úroveň rizika" : "Risk level") : undefined);
  const body = image
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td class="stack photo-cell" width="43%" valign="top" style="padding:8px 20px 0 0"><img class="photo" src="${escapeEmailHtml(image)}" alt="${escapeEmailHtml(sk ? "Výrobok zo záznamu Safety Gate" : "Product from the Safety Gate record")}" width="240" style="display:block;width:100%;max-width:240px;height:auto;border-radius:10px"><p style="margin:8px 0;font-size:11px;line-height:1.4;color:#68726b">${sk ? "Fotografia zo záznamu Safety Gate" : "Photo from the Safety Gate record"}</p></td><td class="stack" valign="top">${detailTable}</td></tr></table>`
    : detailTable;
  const why = sk ? "Prečo vznikla zhoda" : "Why this matched";
  const next = sk ? "Čo urobiť ďalej" : "What to do next";
  const instruction = sk ? "Porovnajte model, značku a šaržu s oficiálnym záznamom. Rozhodnutie a poznámku uložte v aplikácii." : "Compare the model, brand and batch with the official record. Save your decision and a note in the app.";
  const caution = sk ? "Možná zhoda nie je potvrdením, že váš produkt je nebezpečný." : "A possible match does not confirm that your product is dangerous.";
  return {
    subject: `ZeroRecall: ${sk ? "Produkt na preverenie" : "Product needs review"} – ${details.productTitle}`,
    htmlContent: shell({ language, title, status, warning: true, preheader: `${details.productTitle} · ${status}`, body: body + note(why, details.reason), action: sk ? "Preveriť možnú zhodu" : "Review possible match", url, settingsUrl,
      after: `<div style="margin-top:24px;padding-top:22px;border-top:1px solid #d9ddd4"><h2 style="margin:0 0 8px;font-size:20px">${next}</h2>${paragraph(instruction)}</div>` + note(sk ? "Pred rozhodnutím overte údaje" : "Verify the details before deciding", caution, true) }),
    textContent: `${title}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}\n\n${why}: ${details.reason}\n\n${next}\n${instruction}\n\n${caution}\n\n${url}${plainFooter(language, settingsUrl)}`,
  };
}

function formatDate(date: Date, language: string): string {
  return new Intl.DateTimeFormat(language === "sk" ? "sk-SK" : "en-GB", { dateStyle: "medium", timeZone: "Europe/Bratislava" }).format(date);
}

export function renderWeeklyEmail(language: string, shop: string, start: Date, end: Date, metrics: WeeklyEmailMetrics, url: string, settingsUrl: string): EmailContent {
  const sk = language === "sk";
  const title = metrics.monitoringComplete ? (sk ? "Váš týždeň pod dohľadom." : "Your week in review.") : (sk ? "Monitoring nebol celý dokončený" : "Monitoring was incomplete");
  const status = !metrics.monitoringComplete ? (sk ? "Vyžaduje pozornosť" : "Attention needed") : metrics.newFindings ? (sk ? "Nové nálezy" : "New findings") : (sk ? "Bez nových nálezov" : "No new findings");
  const summary = !metrics.monitoringComplete
    ? (sk ? "Za toto obdobie nevieme potvrdiť úspešný dokončený monitoring. Otvorte aplikáciu a skontrolujte stav monitoringu." : "A completed monitoring run could not be confirmed for this period. Open the app to check the monitoring status.")
    : metrics.newFindings ? (sk ? `Počas obdobia vzniklo ${metrics.newFindings} nových nálezov. Aktuálny stav rozhodnutí nájdete v aplikácii.` : `${metrics.newFindings} new findings were created during this period. Check the app for their current review status.`)
      : (sk ? "Počas obdobia nevznikol nový nález." : "No new finding was created during this period.");
  const period = `${formatDate(start, language)} – ${formatDate(end, language)}`;
  const rows: Array<[string, string]> = [
    [sk ? "Monitorované produkty" : "Monitored products", String(metrics.products)],
    [sk ? "Vykonané kontroly" : "Checks completed", String(metrics.checks)],
    [sk ? "Nové záznamy Safety Gate" : "New Safety Gate records", String(metrics.safetyGateRecords)],
    [sk ? "Nové nálezy" : "New findings", String(metrics.newFindings)],
    [sk ? "Otvorené nálezy" : "Open findings", String(metrics.openFindings)],
    [sk ? "Posledný úspešný beh" : "Last successful run", metrics.lastSuccessfulRun ? formatDate(metrics.lastSuccessfulRun, language) : (sk ? "Nepotvrdený" : "Not confirmed")],
  ];
  const caveat = sk ? "Produkty v katalógu a počet vykonaných kontrol sú odlišné údaje. Nulový počet nových nálezov nepotvrdzuje bezpečnosť celého katalógu ani neuzatvára staršie otvorené nálezy." : "Catalog products and completed checks are different measures. Zero new findings does not certify the safety of your entire catalog or close older open findings.";
  const findings = (metrics.findings || []).slice(0, 5);
  const stateLabels = sk
    ? { needs_review: "Vyžaduje preverenie", waiting_for_supplier: "Čaká sa na dodávateľa", resolved: "Vyriešené", dismissed: "Zamietnuté", unknown: "Aktuálny stav nájdete v aplikácii" }
    : { needs_review: "Needs review", waiting_for_supplier: "Waiting for supplier", resolved: "Resolved", dismissed: "Dismissed", unknown: "Check the app for the current status" };
  const findingList = findings.length ? `<h2 style="margin:30px 0 8px;font-size:23px">${sk ? "Vybrané nálezy" : "Selected findings"}</h2>${findings.map(finding => {
    const image = httpsUrl(finding.safetyGateImage);
    const link = httpsUrl(finding.url);
    const state = stateLabels[finding.reviewState] || stateLabels.unknown;
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-bottom:1px solid #d9ddd4"><tr>${image ? `<td width="120" valign="top" class="stack photo-cell" style="padding:22px 18px 22px 0"><img src="${escapeEmailHtml(image)}" alt="${escapeEmailHtml(sk ? "Výrobok zo záznamu Safety Gate" : "Product from the Safety Gate record")}" width="120" style="display:block;width:120px;max-width:100%;height:auto;border-radius:8px"><p style="font-size:11px;line-height:1.4;color:#68726b;margin:7px 0 0">${sk ? "Fotografia zo záznamu Safety Gate" : "Photo from the Safety Gate record"}</p></td>` : ""}<td valign="top" class="stack" style="padding:22px 0;overflow-wrap:anywhere;word-break:break-word"><p style="margin:0 0 8px;font-size:12px;color:#68726b">${finding.isNew ? (sk ? "NOVÉ V TOMTO OBDOBÍ" : "NEW THIS PERIOD") : (sk ? "STARŠÍ OTVORENÝ NÁLEZ" : "OLDER OPEN FINDING")} · ${escapeEmailHtml(state)}</p><h3 style="font-size:18px;line-height:1.4;margin:0 0 8px">${escapeEmailHtml(finding.productTitle)}</h3><p style="font-size:14px;line-height:1.6;margin:0 0 8px">Safety Gate: ${escapeEmailHtml(finding.safetyGateProduct)}<br>${sk ? "Riziko" : "Risk"}: ${escapeEmailHtml(riskLabel(finding.riskLevel, sk))}${finding.overallSimilarity !== null && Number.isFinite(finding.overallSimilarity) ? ` · ${sk ? "Podobnosť" : "Similarity"}: ${Math.round(finding.overallSimilarity)} %` : ""}</p><p style="font-size:14px;line-height:1.6;margin:0 0 12px">${escapeEmailHtml(finding.reason.slice(0, 300))}${finding.reason.length > 300 ? "…" : ""}</p>${link ? `<a href="${escapeEmailHtml(link)}" style="font-size:14px;font-weight:700;color:${GREEN}">${sk ? "Otvoriť detail zhody" : "Open match details"}</a>` : ""}</td></tr></table>`;
  }).join("")}${paragraph(sk ? "V e-maile uvádzame najviac päť nálezov, prednostne nové. Všetky nálezy a aktuálny stav nájdete v aplikácii." : "This email shows up to five findings, prioritising new ones. Find all findings and their current status in the app.")}` : "";
  const findingText = findings.map(finding => `${finding.productTitle}\nSafety Gate: ${finding.safetyGateProduct}\n${sk ? "Riziko" : "Risk"}: ${riskLabel(finding.riskLevel, sk)}\n${stateLabels[finding.reviewState] || stateLabels.unknown}\n${finding.reason.slice(0, 300)}\n${httpsUrl(finding.url) || ""}`).join("\n\n");
  return {
    subject: `ZeroRecall: ${metrics.monitoringComplete ? (sk ? "Týždenný prehľad" : "Weekly monitoring summary") : title} – ${shop}`,
    htmlContent: shell({ language, title, status, warning: !metrics.monitoringComplete || metrics.newFindings > 0, preheader: `${shop} · ${status}`, body: paragraph(`${shop} · ${period}`) + paragraph(summary) + facts(rows) + findingList, action: sk ? "Otvoriť prehľad" : "Open dashboard", url, settingsUrl, after: note(sk ? "Ako čítať tento prehľad" : "How to read this summary", caveat) }),
    textContent: `${title}\n${shop}\n${summary}\n${period}\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}${findingText ? `\n\n${sk ? "Vybrané nálezy (najviac 5)" : "Selected findings (up to 5)"}\n${findingText}` : ""}\n\n${caveat}\n\n${url}${plainFooter(language, settingsUrl)}`,
  };
}

export function renderVerificationEmail(language: string, domain: string, url: string, maxProducts = 100): EmailContent {
  const sk = language === "sk";
  const title = sk ? "Ešte jedno kliknutie. Potom začneme." : "One more click. Then we can begin.";
  const intro = sk ? "Požiadali ste o bezplatný sken verejného Shopify katalógu. Potvrďte e-mail a pokračujte na stránke k spusteniu skenu." : "You requested a free scan of a public Shopify catalog. Confirm your email and continue to the page to start the scan.";
  const rows: Array<[string, string]> = [[sk ? "Obchod" : "Store", domain], [sk ? "Rozsah skenu" : "Scan scope", sk ? `Najviac ${maxProducts} verejných produktov` : `Up to ${maxProducts} public products`], [sk ? "Platnosť odkazu" : "Link expires", sk ? "30 minút · jednorazový odkaz" : "30 minutes · single use"]];
  const next = sk ? "Po potvrdení a spustení skontrolujeme dostupný verejný katalóg. Po dokončení skenu vám výsledok pošleme e-mailom." : "After confirmation and start, we will check the available public catalog. We will email the result when the scan finishes.";
  const ignore = sk ? "Ak ste o sken nežiadali, tento e-mail ignorujte. Bez potvrdenia sa sken nespustí." : "If you did not request this scan, ignore this email. The scan will not start without confirmation.";
  return {
    subject: `ZeroRecall: ${sk ? "Potvrďte sken obchodu" : "Confirm the scan for"} ${domain}`,
    htmlContent: shell({ language, title, status: sk ? "Potvrdenie e-mailu" : "Email confirmation", preheader: sk ? `Potvrďte sken ${domain}. Odkaz platí 30 minút.` : `Confirm the scan for ${domain}. Link expires in 30 minutes.`, body: paragraph(intro) + facts(rows), action: sk ? "Potvrdiť e-mail a pokračovať" : "Confirm email and continue", url, after: note(sk ? "Čo bude nasledovať" : "What happens next", next) + `<div style="margin-top:24px">${paragraph(ignore)}</div>` }),
    textContent: `${title}\n\n${intro}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}\n\n${url}\n\n${next}\n\n${ignore}${plainFooter(language)}`,
  };
}

export function renderScanReportEmail(language: string, domain: string, lead: { totalProductsScanned: number; flaggedProductsCount: number; matches?: ScanEmailMatch[] }, homeUrl = HOME, maxProducts = 100): EmailContent {
  const sk = language === "sk";
  const title = sk ? "Výsledok vášho skenu je pripravený." : "Your scan results are ready.";
  const status = lead.flaggedProductsCount > 0 ? (sk ? "Možné zhody na preverenie" : "Possible matches to review") : (sk ? "Bez zistených zhôd" : "No matches found");
  const rows: Array<[string, string]> = [[sk ? "Obchod" : "Store", domain], [sk ? "Preverené produkty" : "Products checked", String(lead.totalProductsScanned)], [sk ? "Limit jednorazového skenu" : "One-off scan limit", String(maxProducts)], [sk ? "Možné zhody na kontrolu" : "Potential matches to review", String(lead.flaggedProductsCount)]];
  const caveat = sk ? "Výsledky sú orientačné. Možnú zhodu overte podľa modelu, fotografie, šarže a oficiálneho záznamu Safety Gate. Nulový počet zhôd nie je potvrdením bezpečnosti celého katalógu." : "These are indicative results. Check any potential match against the model, photo, batch and official Safety Gate record. Zero matches does not certify the safety of your entire catalog.";
  const intro = sk ? "Dokončili sme jednorazové porovnanie dostupných verejných produktov s databázou EÚ Safety Gate." : "We completed a one-off comparison of available public products against the EU Safety Gate database.";
  const matches = (lead.matches || []).slice(0, 5).map(match => {
    const parsed = httpsUrl(match.productUrl);
    const productUrl = parsed && new URL(parsed).hostname === domain ? parsed : null;
    return { title: match.productTitle || (sk ? "Produkt" : "Product"), url: productUrl, reference: match.result?.warnings?.[0]?.alertId };
  });
  const matchesHtml = matches.length ? `<h2 style="margin:28px 0 8px;font-size:21px">${sk ? "Produkty na preverenie" : "Products to review"}</h2>${matches.map(match => `<div style="padding:14px 0;border-bottom:1px solid #d9ddd4"><p style="margin:0;font-size:16px;font-weight:700;line-height:1.5">${match.url ? `<a href="${escapeEmailHtml(match.url)}" style="color:${GREEN}">${escapeEmailHtml(match.title)}</a>` : escapeEmailHtml(match.title)}</p>${match.reference ? `<p style="margin:6px 0 0;font-size:13px;line-height:1.5;color:#68726b">${sk ? "Safety Gate záznam" : "Safety Gate record"}: ${escapeEmailHtml(match.reference)}</p>` : ""}</div>`).join("")}${lead.flaggedProductsCount > 5 ? paragraph(sk ? "V e-maile zobrazujeme najviac päť produktov." : "This email shows up to five products.") : ""}` : "";
  const next = sk ? "Tento sken je jednorazový. Priebežný monitoring a história rozhodnutí sú dostupné po inštalácii aplikácie a aktivácii plánu." : "This scan is a one-off. Ongoing monitoring and decision history are available after installing the app and activating a plan.";
  const official = `<p style="margin:22px 0 0;font-size:14px;line-height:1.5"><a href="${SAFETY_GATE}" style="color:${GREEN}">${sk ? "Otvoriť oficiálny portál Safety Gate" : "Open the official Safety Gate portal"}</a></p>`;
  const home = httpsUrl(homeUrl) || HOME;
  return {
    subject: `ZeroRecall: ${sk ? "Výsledok kontroly katalógu" : "Catalog scan result"} – ${domain}`,
    htmlContent: shell({ language, title, status, warning: lead.flaggedProductsCount > 0, preheader: `${domain} · ${lead.totalProductsScanned} ${sk ? "preverených produktov" : "products checked"} · ${status}`, body: paragraph(intro) + facts(rows) + matchesHtml + note(sk ? "Ako vyhodnotiť výsledok" : "How to interpret the result", caveat, lead.flaggedProductsCount > 0) + official, action: sk ? "Spoznať priebežný monitoring" : "Explore ongoing monitoring", url: `${home.replace(/\/$/, "")}/?lang=${sk ? "sk" : "en"}#how-it-works`, after: note(sk ? "Čo ďalej" : "What comes next", next) }),
    textContent: `${title}\n\n${intro}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}\n\n${matches.map(match => `${match.title}${match.url ? `\n${match.url}` : ""}${match.reference ? `\nSafety Gate: ${match.reference}` : ""}`).join("\n\n")}\n\n${caveat}\n\n${SAFETY_GATE}\n\n${next}\n${home}${plainFooter(language)}`,
  };
}
