import { useSyncExternalStore, type ReactNode } from "react";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function useHydrated() {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}

/** Hydrate a stable UTC timestamp before applying the browser's locale and time zone. */
export function LocalDateTime({
  value,
  locale,
  format,
  render,
}: {
  value: Date | string | number;
  locale?: string;
  format?: (date: Date) => string;
  render?: (formatted: string) => ReactNode;
}) {
  const hydrated = useHydrated();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return <time>—</time>;
  const iso = date.toISOString();
  const text = hydrated
    ? format
      ? format(date)
      : date.toLocaleString(locale?.split(/[-_]/)[0] === "en" ? "en-GB" : locale)
    : iso.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  return <time dateTime={iso} title={hydrated ? date.toLocaleString(locale) : iso}>{render ? render(text) : text}</time>;
}
