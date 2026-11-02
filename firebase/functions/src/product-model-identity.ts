import type { ProductInput } from "./safety-gate-checker.schemas.js";
import type { NormalizedAlert } from "./safety-gate-checker.types.js";

function models(value: unknown): string[] {
  return String(value || "").split(/[,;\n|]+/).map(part => part.trim())
    .filter(part => !/^(?:unknown|unbranded|not specified|unspecified|n\/?a|none|-)$/i.test(part))
    .map(part => part.normalize("NFKC").toUpperCase().replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(part => part.length >= 2);
}

/** Only explicit model fields/labels are identifiers; never guess from a category or title. */
export function explicitProductModel(product: ProductInput): string {
  if (models(product.model).length) return product.model!;
  return product.description.match(/\bmodel\s*:\s*([^\n.]{1,250})/i)?.[1]?.trim() || "";
}

export function compareExplicitModels(product: ProductInput, alert: NormalizedAlert): "equal" | "different" | "variant" | "unknown" {
  const left = models(explicitProductModel(product));
  const fields = alert.fields;
  const right = models(fields.type_numberOfModel || fields.product_model_type || fields.product_model);
  if (!left.length || !right.length) return "unknown";
  if (left.some(a => right.includes(a))) return "equal";
  // A shared model prefix can denote another batch/submodel. Keep it uncertain,
  // rather than declaring either exact identity or a confirmed different product.
  if (left.some(a => right.some(b => Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))))) return "variant";
  return "different";
}
