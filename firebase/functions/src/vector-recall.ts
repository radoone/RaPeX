/** Expand bounded KNN queries until all candidates inside the distance threshold are exhausted.
 * Never report complete coverage when Firestore's maximum KNN result size is saturated.
 */
export async function recallWithinThreshold<T>(params: {
  initialLimit: number;
  maxDistance: number;
  fetch: (limit: number) => Promise<T[]>;
  distance: (row: T) => unknown;
}): Promise<T[]> {
  let limit = params.initialLimit;
  for (;;) {
    const rows = await params.fetch(limit);
    const lastDistance = rows.length ? params.distance(rows[rows.length - 1]) : undefined;
    if (rows.length < limit || (typeof lastDistance === "number" && lastDistance > params.maxDistance)) {
      return rows.filter((row) => {
        const distance = params.distance(row);
        if (typeof distance !== "number" || !Number.isFinite(distance)) throw new Error("Missing vector search distance");
        return distance <= params.maxDistance;
      });
    }
    if (limit >= 1000) throw new Error("Vector recall saturated; coverage is incomplete and requires partitioned retrieval");
    limit = Math.min(limit * 4, 1000);
  }
}
