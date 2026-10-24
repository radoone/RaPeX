/** Preserve input order while bounding simultaneous model or network work. */
export async function mapBounded<T, R>(items: T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError("Invalid concurrency");
  const results: R[] = [];
  for (let offset = 0; offset < items.length; offset += concurrency) {
    results.push(...await Promise.all(items.slice(offset, offset + concurrency).map(work)));
  }
  return results;
}

/** Keep the same first successful media in source order, without serial downloads. */
export async function loadFirstSuccessful<T, R>(items: T[], maximum: number, concurrency: number, load: (item: T) => Promise<R | null>): Promise<Array<{item: T; value: R}>> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError("Invalid concurrency");
  const results: Array<{item: T; value: R}> = [];
  for (let offset = 0; offset < items.length && results.length < maximum; offset += concurrency) {
    const window = items.slice(offset, offset + concurrency);
    const values = await mapBounded(window, concurrency, load);
    for (let index = 0; index < values.length && results.length < maximum; index++) {
      const value = values[index];
      if (value !== null) results.push({item: window[index], value});
    }
  }
  return results;
}

/** Request-scoped promise sharing; bound retained image bytes and never share across checks. */
export function memoizeBounded<T>(load: (url: string) => Promise<T>, maximum = 16): (url: string) => Promise<T> {
  const pending = new Map<string, Promise<T>>();
  return (url) => {
    const existing = pending.get(url);
    if (existing) return existing;
    const result = load(url);
    if (pending.size < maximum) pending.set(url, result);
    return result;
  };
}
