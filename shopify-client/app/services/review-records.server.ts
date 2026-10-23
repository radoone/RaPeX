import db from "../merchant-db.server";
import { firestore } from "../firestore.server";
import { withOfficialReferences } from "./review-evidence.server";
import { parseEvidence } from "./review-evidence";
import { toIsoString } from "./monitoring-runs";
import { type ReviewFilters, matchesReviewFilters } from "./review-records";
export { reviewFilters } from "./review-records";
export async function reviewRecords(
  shop: string,
  filters: ReviewFilters,
  previewLimit?: number,
) {
  const alerts: any[] = [];
  for (let skip = 0; ; skip += 500) {
    const batch = await db.safetyAlert.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      skip,
      take: 500,
    });
    alerts.push(...batch);
    if (batch.length < 500) break;
  }
  const selected = alerts.filter((alert) =>
    matchesReviewFilters(alert, filters),
  );
  const visible = await withOfficialReferences(
    previewLimit ? selected.slice(0, previewLimit) : selected,
  );
  const records: any[] = [];
  for (let offset = 0; offset < visible.length; offset += 10) {
    const group = await Promise.all(
      visible.slice(offset, offset + 10).map(async (alert) => {
        const events = await firestore
          .collection("merchants")
          .doc(encodeURIComponent(shop))
          .collection("alerts")
          .doc(alert.id)
          .collection("decision_events")
          .orderBy("createdAt", "desc")
          .get();
        return {
          id: alert.id,
          productId: alert.productId,
          productTitle: alert.productTitle,
          status: alert.status,
          reviewState: alert.reviewState,
          resolutionType: alert.resolutionType || null,
          notes: alert.notes || null,
          createdAt: toIsoString(alert.createdAt),
          updatedAt: toIsoString(alert.updatedAt),
          resolvedAt: toIsoString(alert.resolvedAt),
          dismissedAt: toIsoString(alert.dismissedAt),
          ...parseEvidence(alert.checkResult),
          decisions: events.docs.map((doc) => {
            const event = doc.data();
            return {
              id: doc.id,
              action: event.action,
              reviewState: event.reviewState,
              resolutionType: event.resolutionType || null,
              notes: event.notes || null,
              actorId: event.actorId || "",
              createdAt: toIsoString(event.createdAt),
            };
          }),
        };
      }),
    );
    records.push(...group);
  }
  return {
    records,
    total: selected.length,
    summary: {
      active: selected.filter((alert) => alert.status === "active").length,
      documented: selected.filter((alert) =>
        Boolean(alert.resolutionType || alert.resolvedAt || alert.dismissedAt),
      ).length,
    },
    scope: {
      from: toIsoString(selected.at(-1)?.createdAt),
      to: toIsoString(selected[0]?.createdAt),
    },
    shop,
    filters,
    generatedAt: new Date().toISOString(),
  };
}
