// Build functions first. This script renders examples only; it never sends email.
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderAlertEmail, renderWeeklyEmail, renderVerificationEmail, renderScanReportEmail, renderFreeScanOwnerEmail } from "../lib/email-templates.js";
import { EMAIL_LANGUAGES, emailText } from "../lib/email-localization.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const output = resolve(root, "outputs/email-templates");
await mkdir(output, { recursive: true });
if (process.argv[2]) await copyFile(process.argv[2], resolve(output, "illustrative-product.png"));
const app = "https://admin.shopify.com/store/ukazka/apps/safety-gate-monitor-eu/app";
const shop = "ukazka.myshopify.com";
const previews = [];
for (const language of EMAIL_LANGUAGES) {
  const exampleCopy = JSON.parse(await readFile(resolve(root, `localization/catalogs/${language}.json`), "utf8")).web;
  const metrics = { products: 124, checks: 38, safetyGateRecords: 17, newFindings: 0, openFindings: 2, monitoringComplete: true, lastSuccessfulRun: new Date("2026-10-19T06:00:00Z") };
  const week = (m) => renderWeeklyEmail(language, shop, new Date("2026-10-12T06:00:00Z"), new Date("2026-10-19T06:00:00Z"), m, app, `${app}/settings`);
  const examples = {
    alert: renderAlertEmail(language, { productTitle: "Detské odrážadlo Mini", safetyGateProduct: "Detské odrážadlo", riskLevel: "High", overallSimilarity: 92, reason: language === "sk" ? "Podobný názov a model. Pred rozhodnutím porovnajte identifikátory produktu a údaje v upozornení." : "Similar name and model. Compare product identifiers and the alert details before deciding.", safetyGateImage: "https://email-preview.invalid/illustrative-product.png" }, shop, `${app}/alerts?open=illustrative-example`, `${app}/settings`),
    weekly: week(metrics),
    "weekly-findings": week({ ...metrics, newFindings: 3, findings: [
      { productTitle: "Detské odrážadlo Mini", safetyGateProduct: "Detské odrážadlo", riskLevel: "High", overallSimilarity: 92, reason: language === "sk" ? "Podobný názov a model. Porovnajte model a šaržu." : "Similar name and model. Compare the model and batch.", safetyGateImage: "https://email-preview.invalid/illustrative-product.png", url: `${app}/alerts?open=illustrative-example`, reviewState: "needs_review", isNew: true },
      { productTitle: "Detská hračka", safetyGateProduct: "Hračka", riskLevel: "Serious", overallSimilarity: 88, reason: language === "sk" ? "Podobné označenie modelu. Fotografia v zázname chýba." : "Similar model identifier. No photo is available in the record.", url: `${app}/alerts?open=illustrative-no-image`, reviewState: "resolved", isNew: true },
    ] }),
    "weekly-incomplete": week({ ...metrics, monitoringComplete: false }),
    verification: renderVerificationEmail(language, shop, `https://zerorecall.online/index.html?lang=${language}#verify=ILLUSTRATIVE_ONLY.NOT_A_REAL_TOKEN`),
    report: renderScanReportEmail(language, shop, { totalProductsScanned: 100, flaggedProductsCount: 2, matches: [{ productTitle: "Detské odrážadlo Mini", productUrl: `https://${shop}/products/mini`, result: { warnings: [{ alertId: "ILLUSTRATIVE-EXAMPLE", reason: language === "sk" ? "Podobné označenie modelu. Pred rozhodnutím overte model a šaržu." : "Similar model identifier. Verify the model and batch before deciding.", alertDetails: { fields: { caseNumber: "ILLUSTRATIVE-ONLY", type_numberOfModel: "Mini 100 (example)", url: "https://ec.europa.eu/safety-gate-alerts/screen/webReport/alertDetail/ILLUSTRATIVE_ONLY" } } }] } }, { productTitle: "Detská hračka", productUrl: `https://${shop}/products/toy` }] }),
    "report-clear": renderScanReportEmail(language, shop, { totalProductsScanned: 64, flaggedProductsCount: 0 }),
  };
  for (const [kind, content] of Object.entries(examples)) {
    const name = `${kind}-${language}`;
    // Only previews substitute a local sample asset and add the example label.
    const html = content.htmlContent.replace("https://email-preview.invalid/illustrative-product.png", "illustrative-product.png").replaceAll(emailText(language, "photo_from_the_safety_gate_record"), exampleCopy.hero.visualCaption).replace(/(<h1 class="headline")/, `<p style="font:11px Arial,sans-serif;letter-spacing:1px;color:#68726b;margin:0 0 16px">${exampleCopy.hero.mockDemo} · ${exampleCopy.showcase.intro}</p>$1`);
    await writeFile(resolve(output, `${name}.html`), html);
    await writeFile(resolve(output, `${name}.txt`), `Subject: ${content.subject}\n\n${content.textContent}\n\n--- HTML reference (fictional preview data) ---\n${html}`);
    previews.push({ name, subject: content.subject });
  }
}
const owner = renderFreeScanOwnerEmail({ domain: shop, email: "owner@example.com", requestedAt: new Date("2026-10-23T08:00:00Z") });
await writeFile(resolve(output, "owner-sk.html"), owner.htmlContent.replace('<h1 class="headline"', '<p style="font:11px Arial,sans-serif;color:#68726b">ILUSTRAČNÉ ÚDAJE · Interné upozornenie pre prevádzkovateľa.</p><h1 class="headline"'));
await writeFile(resolve(output, "owner-sk.txt"), `Subject: ${owner.subject}\n\n${owner.textContent}`);
const languageOptions = EMAIL_LANGUAGES.map(code => `<option value="${code}"${code === "sk" ? " selected" : ""}>${new Intl.DisplayNames([code], { type: "language" }).of(code)}</option>`).join("");
const types = { alert: "Okamžitý nález", weekly: "Týždenný prehľad", "weekly-findings": "Týždenný prehľad s nálezmi", "weekly-incomplete": "Nedokončený monitoring", verification: "Potvrdenie skenu", report: "Výsledok skenu", "report-clear": "Sken bez zhôd", owner: "Interná žiadosť (SK)" };
const typeOptions = Object.entries(types).map(([value,label]) => `<option value="${value}">${label}</option>`).join("");
await writeFile(resolve(output, "index.html"), `<!doctype html><html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZeroRecall · Email previews</title></head><body style="margin:0;font:15px Arial,sans-serif;background:#faf9f5;color:#1c2822"><header style="padding:20px 24px;border-bottom:1px solid #ddd"><strong>ZeroRecall · E-mailové šablóny</strong><p>Ilustračné údaje. Náhľady neodosielajú e-maily. Vyberte šablónu a jazyk.</p><label for="preview-language">Jazyk </label><select id="preview-language" style="padding:8px;margin:6px 16px 6px 0">${languageOptions}</select><label for="preview-type">Šablóna </label><select id="preview-type" style="padding:8px;margin:6px 0">${typeOptions}</select></header><iframe title="Email preview" name="preview" src="alert-sk.html" style="width:100%;height:1800px;border:0"></iframe><script>const language=document.getElementById('preview-language'),type=document.getElementById('preview-type');function show(){language.disabled=type.value==='owner';document.querySelector('iframe').src=type.value+'-'+(type.value==='owner'?'sk':language.value)+'.html'}language.addEventListener('change',show);type.addEventListener('change',show);</script></body></html>`);
console.log(`Rendered ${previews.length + 1} previews in ${output}`);
