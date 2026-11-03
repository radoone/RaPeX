// Bound retries within a single 12-candidate analysis. An unavailable analysis
// remains an error at the checker boundary, never a negative match prediction.
export function isPermanentProviderFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { status?: unknown; code?: unknown; message?: unknown; cause?: unknown };
  if (["401", "402", "403", "UNAUTHENTICATED", "PERMISSION_DENIED"].includes(String(value.status)) ||
      ["401", "402", "403"].includes(String(value.code))) return true;
  return /\b(?:401|402|403)\b|prepayment credits are depleted/i.test(String(value.message ?? "")) ||
    (value.cause !== error && isPermanentProviderFailure(value.cause));
}

export async function runAnalysisAttempts<A, T>(
  attempts: readonly A[],
  run: (attempt: A, signal: AbortSignal) => Promise<T>,
  report: (attempt: A, error: unknown) => void,
  limits = { attemptMs: 60_000, totalMs: 150_000 },
): Promise<T | null> {
  const deadline = Date.now() + limits.totalMs;
  for (const attempt of attempts) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error("Safety Gate model attempt timed out");
          controller.abort(error);
          reject(error);
        }, Math.min(limits.attemptMs, remaining));
      });
      return await Promise.race([run(attempt, controller.signal), timeout]);
    } catch (error) {
      report(attempt, error);
      // Text-only or smaller-model retries cannot repair account billing/auth.
      if (isPermanentProviderFailure(error)) break;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
