import { createHash, timingSafeEqual } from "node:crypto";

type HeaderSource = {
  headers?: Record<string, string | string[] | undefined>;
  get?(name: string): string | undefined;
};

type JsonErrorResponse = {
  status(code: number): { json(payload: unknown): void };
};

function readHeader(request: HeaderSource, name: string): string {
  if (typeof request.get === "function") {
    const direct = request.get(name);
    if (typeof direct === "string" && direct.trim()) return direct.trim();
  }
  const headers = request.headers || {};
  const raw = headers[name.toLowerCase()] ?? headers[name];
  if (Array.isArray(raw)) {
    return typeof raw[0] === "string" ? raw[0].trim() : "";
  }
  return typeof raw === "string" ? raw.trim() : "";
}

export function extractApiKey(request: HeaderSource): string {
  const headerKey = readHeader(request, "x-api-key");
  if (headerKey) {
    return headerKey;
  }

  const authHeader = readHeader(request, "authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  return "";
}

/**
 * Constant-time secret comparison using SHA-256 digests so neither key length
 * nor character prefixes leak through timing side channels.
 */
export function constantTimeSecretEquals(provided: string, expected: string): boolean {
  const cleanProvided = provided.trim();
  const cleanExpected = expected.trim();
  if (!cleanProvided || !cleanExpected) {
    return false;
  }
  const providedDigest = createHash("sha256").update(cleanProvided).digest();
  const expectedDigest = createHash("sha256").update(cleanExpected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

export function isAuthorizedApiKey(
  request: HeaderSource,
  envVarName: "SAFETY_GATE_API_KEY" | "SAFETY_GATE_ADMIN_API_KEY" = "SAFETY_GATE_API_KEY",
): boolean {
  const primaryExpected = (process.env[envVarName] ?? "").trim();
  const fallbackExpected = envVarName === "SAFETY_GATE_ADMIN_API_KEY"
    ? (process.env.SAFETY_GATE_API_KEY ?? "").trim()
    : "";
  const expected = primaryExpected || fallbackExpected;
  const provided = extractApiKey(request);
  return constantTimeSecretEquals(provided, expected);
}

export function requireOperationsKey(
  request: HeaderSource,
  response: JsonErrorResponse,
  options?: { allowAdminKey?: boolean },
): boolean {
  const adminKey = options?.allowAdminKey ? (process.env.SAFETY_GATE_ADMIN_API_KEY || "").trim() : "";
  const standardKey = (process.env.SAFETY_GATE_API_KEY || "").trim();
  const expected = adminKey || standardKey;
  const provided = extractApiKey(request);

  if (expected && constantTimeSecretEquals(provided, expected)) {
    return true;
  }

  response
    .status(expected ? 401 : 503)
    .json({ error: expected ? "Unauthorized" : "Operations key is not configured" });
  return false;
}
