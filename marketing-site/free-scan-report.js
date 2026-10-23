export function csvCell(value) {
  const text = String(value ?? "");
  return `"${(/^[\s\uFEFF]*[=+@-]/u.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
}
function safeUrl(value, domain, official = false) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      (official ? url.hostname === "ec.europa.eu" : url.hostname === domain)
      ? url.href
      : "";
  } catch {
    return "";
  }
}
export function reportCsvRows(page) {
  const rows = [];
  for (const match of page.matches || []) {
    for (const warning of match.result?.warnings?.length
      ? match.result.warnings
      : [{}]) {
      const fields = warning.alertDetails?.fields || {};
      rows.push(
        [
          page.domain,
          page.checkedProducts,
          page.possibleMatches,
          match.productId,
          match.productTitle,
          safeUrl(match.productUrl, page.domain),
          fields.caseNumber || fields.alert_number,
          fields.type_numberOfModel || fields.product_model,
          warning.overallSimilarity,
          warning.reason,
          safeUrl(fields.url || fields.rapex_url, page.domain, true),
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return rows;
}
export async function downloadReportPages(reportToken, fetchPage) {
  const lines = [
    "Store,Products checked,Products with possible matches,Product ID,Product,Product URL,Safety Gate reference,Model,Similarity,Reason,Official source",
  ];
  let cursor;
  const seen = new Set();
  let domain = "";
  do {
    const page = await fetchPage({
      reportToken,
      ...(cursor ? { cursor } : {}),
    });
    if (domain && page.domain !== domain)
      throw new Error("Report store changed");
    domain = page.domain;
    lines.push(...reportCsvRows(page));
    if (!cursor && page.possibleMatches === 0)
      lines.push(
        [page.domain, page.checkedProducts, 0, "", "", "", "", "", "", "", ""]
          .map(csvCell)
          .join(","),
      );
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("Repeated report cursor");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return { csv: "\uFEFF" + lines.join("\r\n") + "\r\n", domain };
}
