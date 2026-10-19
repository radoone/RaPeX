// Build functions first. This script renders examples only; it never sends email.
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderAlertEmail, renderWeeklyEmail, renderVerificationEmail, renderScanReportEmail } from "../lib/email-templates.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const output = resolve(root, "outputs/email-templates");
await mkdir(output, { recursive: true });
if (process.argv[2]) await copyFile(process.argv[2], resolve(output, "illustrative-product.png"));
const app = "https://admin.shopify.com/store/ukazka/apps/safety-gate-monitor-eu/app";
const shop = "ukazka.myshopify.com";
const previews = [];
for (const language of ["sk", "en"]) {
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
    report: renderScanReportEmail(language, shop, { totalProductsScanned: 100, flaggedProductsCount: 2, matches: [{ productTitle: "Detské odrážadlo Mini", productUrl: `https://${shop}/products/mini`, result: { warnings: [{ alertId: "ILLUSTRATIVE-EXAMPLE" }] } }, { productTitle: "Detská hračka", productUrl: `https://${shop}/products/toy` }] }),
    "report-clear": renderScanReportEmail(language, shop, { totalProductsScanned: 64, flaggedProductsCount: 0 }),
  };
  for (const [kind, content] of Object.entries(examples)) {
    const name = `${kind}-${language}`;
    // Only previews substitute a local sample asset and add the example label.
    const html = content.htmlContent.replace("https://email-preview.invalid/illustrative-product.png", "illustrative-product.png").replace("Fotografia zo záznamu Safety Gate", "Ilustračná fotografia · fiktívny produkt").replace("Photo from the Safety Gate record", "Illustrative photo · fictional product").replace(/(<h1 class="headline")/, `<p style="font:11px Arial,sans-serif;letter-spacing:1px;color:#68726b;margin:0 0 16px">${language === "sk" ? "ILUSTRAČNÁ UKÁŽKA · FIKTÍVNE ÚDAJE" : "ILLUSTRATIVE PREVIEW · FICTIONAL DATA"}</p>$1`);
    await writeFile(resolve(output, `${name}.html`), html);
    await writeFile(resolve(output, `${name}.txt`), `Subject: ${content.subject}\n\n${content.textContent}\n\n--- HTML reference (fictional preview data) ---\n${html}`);
    previews.push({ name, subject: content.subject });
  }
}
const navigation = previews.map(p => `<a href="${p.name}.html" target="preview" style="display:block;padding:9px 0;color:#315e4b">${p.name}</a>`).join("");
await writeFile(resolve(output, "index.html"), `<!doctype html><html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ZeroRecall · Email previews</title></head><body style="margin:0;font:15px Arial,sans-serif;background:#faf9f5;color:#1c2822"><header style="padding:20px 24px;border-bottom:1px solid #ddd"><strong>ZeroRecall · E-mailové šablóny</strong><p>Ilustračné údaje. Náhľady neodosielajú e-maily. Vyberte šablónu a jazyk.</p></header><div style="display:flex;flex-wrap:wrap"><nav aria-label="Email templates" style="padding:16px 24px;min-width:190px">${navigation}</nav><iframe title="Email preview" name="preview" src="alert-sk.html" style="flex:1;min-width:320px;height:1150px;border:0"></iframe></div></body></html>`);
console.log(`Rendered ${previews.length} previews in ${output}`);
