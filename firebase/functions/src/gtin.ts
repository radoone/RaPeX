/** Canonicalise a complete GTIN-8, UPC-A, EAN-13 or GTIN-14 after check-digit validation. */
export function canonicalGtin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!/^\d+$/.test(input) || ![8, 12, 13, 14].includes(input.length)) return null;
  const digits = [...input].map(Number);
  const check = digits.pop()!;
  let sum = 0;
  for (let i = digits.length - 1, position = 0; i >= 0; i--, position++) {
    sum += digits[i] * (position % 2 === 0 ? 3 : 1);
  }
  if ((10 - sum % 10) % 10 !== check || /^0+$/.test(input)) return null;
  return input.padStart(14, "0");
}

/** Extract standalone complete digit sequences from a Safety Gate barcode field. */
export function extractGtins(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const numbers = value.match(/(?<!\d)\d{8,14}(?!\d)/g) || [];
  return [...new Set(numbers.map(canonicalGtin).filter((gtin): gtin is string => gtin !== null))];
}
