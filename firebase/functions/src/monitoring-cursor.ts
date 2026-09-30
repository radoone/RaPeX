export type MonitoringCursorValues = readonly [Date, string, string];

/**
 * Build an inclusive-safe Firestore cursor. A timestamp-only legacy checkpoint
 * has no stable tie-breaker, so the caller must omit startAfter and replay the
 * date boundary idempotently until it can persist this complete tuple.
 */
export function buildMonitoringCursorValues(
  checkpointDate: Date,
  checkpointRecordTimestamp?: string | null,
  checkpointDocId?: string | null,
): MonitoringCursorValues | null {
  if (!checkpointRecordTimestamp || !checkpointDocId) return null;
  return [checkpointDate, checkpointRecordTimestamp, checkpointDocId];
}
