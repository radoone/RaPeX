export const monitoringTimeZone = "Europe/Bratislava";

const zonedClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: monitoringTimeZone,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

function wallClockAsUtc(timestamp: number) {
  const parts = Object.fromEntries(
    zonedClock.formatToParts(timestamp).map(({ type, value }) => [type, Number(value)]),
  );
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

/** The daily merchant scheduler enqueues checks at 03:47 local time. */
export function nextScheduledMonitoringAt(now: number): string {
  const local = new Date(wallClockAsUtc(now));
  const scheduledTime = (daysAhead: number) => {
    const nominal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + daysAhead, 3, 47);
    return nominal - (wallClockAsUtc(nominal) - nominal);
  };
  const today = scheduledTime(0);
  return new Date(today > now ? today : scheduledTime(1)).toISOString();
}

export function plannedMonitoringAt(hasBaseline: boolean, state: string, now: number): string | null {
  return hasBaseline && !["paused", "unverified", "preview"].includes(state)
    ? nextScheduledMonitoringAt(now)
    : null;
}
