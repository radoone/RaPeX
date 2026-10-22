/** Quote CSV fields and keep merchant-controlled text from becoming formulas. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && (/^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text))) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}
