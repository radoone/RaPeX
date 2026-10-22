/** Display identifier equality conservatively; a partial model is not a match. */
export function compareProductIdentifiers(left: unknown, right: unknown): "match" | "mismatch" | "unspecified" {
  const normalize = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
  const first = normalize(left);
  const second = normalize(right);
  if (!first || !second) return "unspecified";
  return first === second ? "match" : "mismatch";
}
